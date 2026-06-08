/**
 * 9-point gaze calibration. Shows a 3×3 grid of pulsing dots; the user dwells
 * on each for 1.5s while we average the incoming gaze feature. We then solve a
 * least-squares AFFINE map from the 2D gaze feature to screen pixels:
 *
 *   screenX = ax·gx + bx·gy + cx
 *   screenY = ay·gx + by·gy + cy
 *
 * Affine (not just scale+offset) absorbs head tilt and the natural shear
 * between eye-socket coordinates and the screen plane.
 */
import { getOverlayRoot } from './overlay';

export interface GazeTransform {
  ax: number; bx: number; cx: number;
  ay: number; by: number; cy: number;
}

const STORAGE_KEY = 'aria.gazeCalibration';
const DWELL_MS = 1500;
const GRID = [0.1, 0.5, 0.9];

interface Sample {
  gx: number; gy: number;
  sx: number; sy: number;
}

export class GazeCalibration {
  private dot: HTMLDivElement | null = null;
  private samples: Sample[] = [];
  private collecting: { gx: number; gy: number; n: number } | null = null;

  /** Run the full 9-point flow. Resolves with the solved transform. */
  async run(): Promise<GazeTransform> {
    const points: Array<[number, number]> = [];
    for (const fy of GRID) for (const fx of GRID) points.push([fx, fy]);

    this.mountDot();
    for (const [fx, fy] of points) {
      await this.capturePoint(fx, fy);
    }
    this.unmountDot();

    const transform = solveAffine(this.samples);
    await saveTransform(transform);
    return transform;
  }

  /** Feed a live gaze frame (called by the vision driver during calibration). */
  feed(gaze: { x: number; y: number }): void {
    if (!this.collecting) return;
    this.collecting.gx += gaze.x;
    this.collecting.gy += gaze.y;
    this.collecting.n += 1;
  }

  private capturePoint(fx: number, fy: number): Promise<void> {
    return new Promise((resolve) => {
      const sx = fx * window.innerWidth;
      const sy = fy * window.innerHeight;
      this.positionDot(sx, sy);
      this.collecting = { gx: 0, gy: 0, n: 0 };
      window.setTimeout(() => {
        const c = this.collecting!;
        this.collecting = null;
        if (c.n > 0) {
          this.samples.push({ gx: c.gx / c.n, gy: c.gy / c.n, sx, sy });
        }
        resolve();
      }, DWELL_MS);
    });
  }

  private mountDot(): void {
    const root = getOverlayRoot();
    const dot = document.createElement('div');
    dot.style.cssText = [
      'position:fixed',
      'width:26px',
      'height:26px',
      'margin-left:-13px',
      'margin-top:-13px',
      'border-radius:50%',
      'background:#19e3b1',
      'box-shadow:0 0 0 6px rgba(25,227,177,0.25),0 0 18px 4px rgba(25,227,177,0.7)',
      'animation:aria-cal-pulse 0.75s ease-in-out infinite',
      'pointer-events:none',
    ].join(';');
    // Inject the pulse keyframe once.
    const style = document.createElement('style');
    style.textContent =
      '@keyframes aria-cal-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.5)}}';
    root.appendChild(style);
    root.appendChild(dot);
    this.dot = dot;
  }

  private positionDot(x: number, y: number): void {
    if (!this.dot) return;
    this.dot.style.left = `${x}px`;
    this.dot.style.top = `${y}px`;
  }

  private unmountDot(): void {
    this.dot?.remove();
    this.dot = null;
  }
}

/**
 * Smooth Pursuit Calibration.
 * Moves the dot along a figure-8 path for 10 seconds; the user tracks it with
 * their eyes. We sample (gaze, screen) pairs at each frame and solve the affine
 * fit, giving a richer calibration than the static 9-point grid.
 */
export class SmoothPursuitCalibration {
  private dot: HTMLDivElement | null = null;
  private samples: Sample[] = [];
  private active = false;
  private feedData: { x: number; y: number } | null = null;

  /** Run the smooth-pursuit flow. Resolves with the solved transform. */
  async run(): Promise<GazeTransform> {
    this.mountDot();
    this.active = true;
    const DURATION_MS = 10000;
    const startTime = Date.now();

    await new Promise<void>((resolve) => {
      const animate = (): void => {
        const elapsed = Date.now() - startTime;
        if (!this.active || elapsed >= DURATION_MS) { resolve(); return; }

        const t = (elapsed / DURATION_MS) * Math.PI * 4; // 2 full loops
        const cx = window.innerWidth * 0.5;
        const cy = window.innerHeight * 0.5;
        const rx = window.innerWidth * 0.35;
        const ry = window.innerHeight * 0.3;
        // Lissajous figure-8.
        const sx = cx + rx * Math.sin(t);
        const sy = cy + ry * Math.sin(t * 2);

        this.positionDot(sx, sy);
        if (this.feedData) {
          this.samples.push({ gx: this.feedData.x, gy: this.feedData.y, sx, sy });
        }
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    });

    this.active = false;
    this.unmountDot();

    const transform = solveAffine(this.samples);
    await saveTransform(transform);
    return transform;
  }

  feed(gaze: { x: number; y: number }): void {
    this.feedData = gaze;
  }

  private mountDot(): void {
    const root = getOverlayRoot();
    const dot = document.createElement('div');
    dot.id = 'aria-pursuit-dot';
    dot.style.cssText = [
      'position:fixed', 'width:22px', 'height:22px',
      'margin-left:-11px', 'margin-top:-11px',
      'border-radius:50%', 'background:#f3a821',
      'box-shadow:0 0 0 5px rgba(243,168,33,0.3),0 0 16px 4px rgba(243,168,33,0.6)',
      'pointer-events:none', 'transition:none',
    ].join(';');
    root.appendChild(dot);
    this.dot = dot;
  }

  private positionDot(x: number, y: number): void {
    if (!this.dot) return;
    this.dot.style.left = `${x}px`;
    this.dot.style.top = `${y}px`;
  }

  private unmountDot(): void {
    this.dot?.remove();
    this.dot = null;
  }
}

/** Apply a solved transform to a gaze feature → screen pixel coordinate. */
export function applyTransform(t: GazeTransform, gaze: { x: number; y: number }): { x: number; y: number } {
  return {
    x: t.ax * gaze.x + t.bx * gaze.y + t.cx,
    y: t.ay * gaze.x + t.by * gaze.y + t.cy,
  };
}

/**
 * Calibration is stored in chrome.storage.local (not localStorage): it's
 * per-extension and survives both Chrome restarts and content-script teardown
 * on navigation, whereas localStorage is scoped per-page-origin and is wiped
 * whenever the content script for a given site is torn down. (KI-04)
 */
export async function loadTransform(): Promise<GazeTransform | null> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const stored = raw[STORAGE_KEY];
  if (!stored) return null;
  try {
    return JSON.parse(stored as string) as GazeTransform;
  } catch {
    return null;
  }
}

async function saveTransform(transform: GazeTransform): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(transform) });
}

/**
 * Least-squares affine fit via the normal equations. For each output axis we
 * solve a 3×3 system (A^T A) p = A^T s, where each row of A is [gx, gy, 1].
 */
function solveAffine(samples: Sample[]): GazeTransform {
  // Accumulate the symmetric 3×3 normal matrix and the two RHS vectors.
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0;
  let tx0 = 0, tx1 = 0, tx2 = 0; // A^T · screenX
  let ty0 = 0, ty1 = 0, ty2 = 0; // A^T · screenY
  for (const s of samples) {
    sxx += s.gx * s.gx;
    sxy += s.gx * s.gy;
    sx += s.gx;
    syy += s.gy * s.gy;
    sy += s.gy;
    n += 1;
    tx0 += s.gx * s.sx; tx1 += s.gy * s.sx; tx2 += s.sx;
    ty0 += s.gx * s.sy; ty1 += s.gy * s.sy; ty2 += s.sy;
  }
  const M: Matrix3 = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const [ax, bx, cx] = solve3(M, [tx0, tx1, tx2]);
  const [ay, by, cy] = solve3(M, [ty0, ty1, ty2]);
  return { ax, bx, cx, ay, by, cy };
}

type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];

/** Solve 3×3 linear system via Cramer's rule. Falls back to identity-ish if singular. */
function solve3(M: Matrix3, v: [number, number, number]): [number, number, number] {
  const det = det3(M);
  if (Math.abs(det) < 1e-9) return [window.innerWidth, 0, 0];
  const dx = det3(replaceCol(M, 0, v));
  const dy = det3(replaceCol(M, 1, v));
  const dz = det3(replaceCol(M, 2, v));
  return [dx / det, dy / det, dz / det];
}

function det3(m: Matrix3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function replaceCol(m: Matrix3, col: number, v: [number, number, number]): Matrix3 {
  const out: Matrix3 = [[...m[0]], [...m[1]], [...m[2]]] as Matrix3;
  out[0][col] = v[0];
  out[1][col] = v[1];
  out[2][col] = v[2];
  return out;
}
