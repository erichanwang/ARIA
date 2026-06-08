/**
 * Eye-mode driver. Consumes per-frame face features (gaze + brow/blink),
 * maps the gaze feature to a screen coordinate via the calibrated affine
 * transform, smooths it, and drives the cursor. Click triggers:
 *
 *   - brow raise           → click at gaze point
 *   - dwell 800ms in 40px  → click (with the cursor's settled position)
 *   - wink left / right    → scroll down / up   (per the PRD gesture map)
 *
 * If there's no stored calibration, the first activation runs the 9-point flow.
 */
import type { AgentCursor } from './cursor';
import type { Hud } from './hud';
import {
  GazeCalibration,
  SmoothPursuitCalibration,
  GazeTransform,
  applyTransform,
  loadTransform,
} from './calibration';
import { clickAtPoint } from './synthetic-click';
import { getOverlayRoot } from './overlay';
import type { VisionFrameData } from '@shared/messages';

// Defaults - overridden by settings pushed from popup via onSettingsChanged.
let SMOOTHING = 0.35;
let DWELL_MS = 800;
const DWELL_RADIUS = 40;

export function updateGazeSettings(smoothing: number, dwellMs: number): void {
  SMOOTHING = smoothing;
  DWELL_MS = dwellMs;
}

// Low-confidence frame counter for auto-recalibration.
const LOW_CONF_DURATION_MS = 5000;

export class GazeDriver {
  private transform: GazeTransform | null = null;
  private calibration: GazeCalibration | null = null;
  private sx = window.innerWidth / 2;
  private sy = window.innerHeight / 2;

  // Dwell tracking.
  private dwellAnchor = { x: this.sx, y: this.sy };
  private dwellStart = 0;
  private dwellFired = false;
  private dwellRingEl: HTMLDivElement | null = null;

  // Edge-trigger guards so a held expression fires once.
  private browLatch = false;
  private blinkLLatch = false;
  private blinkRLatch = false;

  // Auto-recalibration tracking.
  private lowConfStart = 0;
  private inLowConf = false;

  // Reading ruler: a thin horizontal bar at gaze Y position.
  private rulerEl: HTMLDivElement | null = null;

  // Eye fatigue tracking.
  private eyeModeStartTime = Date.now();
  private fatigueAlertMins = 20;
  private lastFatigueAlertAt = 0;

  // Blink rate monitoring.
  private blinkEvents: number[] = []; // timestamps of recent blinks

  // Gaze heatmap data (30-second rolling window).
  private heatmapData: Array<{ x: number; y: number; t: number }> = [];
  private heatmapEl: HTMLCanvasElement | null = null;

  // Eye sleep detection (long close).
  private eyeCloseStart = 0;
  private eyeClosePaused = false;
  private SLEEP_THRESHOLD_MS = 3000;

  constructor(
    private cursor: AgentCursor,
    private hud: Hud,
    fatigueAlertMins = 20,
  ) {
    this.fatigueAlertMins = fatigueAlertMins;
    this.eyeModeStartTime = Date.now();
  }

  private ensureRuler(): HTMLDivElement {
    if (this.rulerEl) return this.rulerEl;
    const root = getOverlayRoot();
    const el = document.createElement('div');
    el.className = 'aria-reading-ruler';
    root.appendChild(el);
    this.rulerEl = el;
    return el;
  }

  removeRuler(): void {
    this.rulerEl?.remove();
    this.rulerEl = null;
  }

  /** Kick off calibration if needed. Safe to call on mode activation. */
  async ensureCalibrated(): Promise<void> {
    if (!this.transform) this.transform = await loadTransform();
    if (this.transform) return;
    this.hud.setCommand('Calibrating eye tracking — follow the dots.');
    this.calibration = new GazeCalibration();
    this.transform = await this.calibration.run();
    this.calibration = null;
    this.hud.setCommand('Eye tracking calibrated.');
  }

  /** Smooth Pursuit Calibration - re-calibrate by tracking a moving dot. */
  async runSmoothPursuitCalibration(): Promise<void> {
    this.hud.setCommand('Smooth pursuit calibration — follow the orange dot with your eyes.');
    const spc = new SmoothPursuitCalibration();
    // Feed live gaze frames to the pursuit calibrator during the 10s run.
    const origOnFrame = this.onFrame.bind(this);
    this.onFrame = (data: VisionFrameData) => {
      if (data.gaze) spc.feed(data.gaze);
      origOnFrame(data);
    };
    this.transform = await spc.run();
    this.onFrame = origOnFrame;
    this.hud.setCommand('Smooth pursuit calibration complete.');
  }

  onFrame(data: VisionFrameData): void {
    if (!data.gaze) return;

    // Eye Sleep Detection - detect long eye closure.
    const bothClosed = !!data.blinkLeft && !!data.blinkRight;
    if (bothClosed) {
      if (this.eyeCloseStart === 0) this.eyeCloseStart = performance.now();
      else if (!this.eyeClosePaused && performance.now() - this.eyeCloseStart > this.SLEEP_THRESHOLD_MS) {
        this.eyeClosePaused = true;
        this.hud.setCommand('Paused — blink twice to resume.');
      }
    } else {
      if (this.eyeClosePaused && !bothClosed) {
        this.eyeClosePaused = false;
        this.hud.setCommand('Resumed.');
      }
      this.eyeCloseStart = 0;
    }
    if (this.eyeClosePaused) return;

    // During calibration, feed samples and don't move the cursor.
    if (this.calibration) {
      this.calibration.feed(data.gaze);
      return;
    }
    if (!this.transform) return;

    // Auto-recalibration: if gaze confidence drops too low for too long.
    this.checkAutoRecalibration(data);

    const target = applyTransform(this.transform, data.gaze);
    this.sx += (clamp(target.x, 0, window.innerWidth) - this.sx) * SMOOTHING;
    this.sy += (clamp(target.y, 0, window.innerHeight) - this.sy) * SMOOTHING;
    this.cursor.jumpTo(this.sx, this.sy, 'eye');

    // Record gaze position for heatmap.
    const now = performance.now();
    this.heatmapData.push({ x: this.sx, y: this.sy, t: now });
    // Keep 30-second rolling window.
    const cutoff = now - 30000;
    this.heatmapData = this.heatmapData.filter((p) => p.t > cutoff);

    // Update reading ruler position.
    const ruler = this.ensureRuler();
    ruler.style.setProperty('--y', `${this.sy}px`);

    this.updateDwell();
    this.handleTriggers(data);
    this.checkFatigue();
    this.checkBlinkRate(data);
  }

  private checkAutoRecalibration(data: VisionFrameData): void {
    // Use the gaze magnitude as a proxy for confidence - if gaze goes to
    // extremes (> 0.95 or < 0.05 on both axes) it usually means tracking lost.
    const g = data.gaze!;
    const offScreen = g.x < 0.02 || g.x > 0.98 || g.y < 0.02 || g.y > 0.98;
    if (offScreen) {
      if (!this.inLowConf) {
        this.inLowConf = true;
        this.lowConfStart = performance.now();
      } else if (performance.now() - this.lowConfStart > LOW_CONF_DURATION_MS) {
        this.inLowConf = false;
        this.hud.setCommand('Eye tracking lost — recalibrating…');
        this.transform = null;
        void this.ensureCalibrated();
      }
    } else {
      this.inLowConf = false;
    }
  }

  private updateDwell(): void {
    const moved = Math.hypot(this.sx - this.dwellAnchor.x, this.sy - this.dwellAnchor.y);
    if (moved > DWELL_RADIUS) {
      this.dwellAnchor = { x: this.sx, y: this.sy };
      this.dwellStart = performance.now();
      this.dwellFired = false;
      this.removeDwellRing();
      return;
    }
    const elapsed = performance.now() - this.dwellStart;
    if (!this.dwellFired) {
      if (elapsed > 200) this.updateDwellRing(elapsed / DWELL_MS);
      if (elapsed > DWELL_MS) {
        this.dwellFired = true;
        this.removeDwellRing();
        this.fireClick();
      }
    }
  }

  private updateDwellRing(progress: number): void {
    if (!this.dwellRingEl) {
      const root = getOverlayRoot();
      this.dwellRingEl = document.createElement('div');
      this.dwellRingEl.className = 'aria-dwell-ring';
      root.appendChild(this.dwellRingEl);
    }
    const size = DWELL_RADIUS * 2 + 8;
    this.dwellRingEl.style.setProperty('--x', `${this.sx}px`);
    this.dwellRingEl.style.setProperty('--y', `${this.sy}px`);
    this.dwellRingEl.style.setProperty('--size', `${size}px`);
    this.dwellRingEl.style.setProperty('--progress', String(clamp(progress, 0, 1)));
  }

  private removeDwellRing(): void {
    this.dwellRingEl?.remove();
    this.dwellRingEl = null;
  }

  private handleTriggers(data: VisionFrameData): void {
    // Brow raise → click (edge-triggered).
    if (data.browRaise && !this.browLatch) this.fireClick();
    this.browLatch = !!data.browRaise;

    // Winks → scroll. A wink is one eye closed while the other stays open.
    const winkL = !!data.blinkLeft && !data.blinkRight;
    const winkR = !!data.blinkRight && !data.blinkLeft;
    if (winkL && !this.blinkLLatch) window.scrollBy({ top: window.innerHeight * 0.4, behavior: 'smooth' });
    if (winkR && !this.blinkRLatch) window.scrollBy({ top: -window.innerHeight * 0.4, behavior: 'smooth' });
    this.blinkLLatch = winkL;
    this.blinkRLatch = winkR;
  }

  private fireClick(): void {
    this.cursor.setState('acting');
    clickAtPoint(this.sx, this.sy);
    this.dwellStart = performance.now();
    this.dwellFired = true;
    setTimeout(() => this.cursor.setState('idle'), 250);
  }

  // Eye Fatigue Alert.
  private checkFatigue(): void {
    const elapsedMins = (Date.now() - this.eyeModeStartTime) / 60000;
    const alertIntervalMins = this.fatigueAlertMins;
    const alertsElapsed = Math.floor(elapsedMins / alertIntervalMins);
    if (alertsElapsed > this.lastFatigueAlertAt) {
      this.lastFatigueAlertAt = alertsElapsed;
      this.hud.setCommand(`You've been using eye mode for ${Math.round(elapsedMins)} minutes. Consider a short break.`);
    }
  }

  // Blink Rate Monitor.
  private checkBlinkRate(data: VisionFrameData): void {
    const bothClosed = !!data.blinkLeft && !!data.blinkRight;
    if (bothClosed && !this.blinkLLatch && !this.blinkRLatch) {
      this.blinkEvents.push(Date.now());
    }
    // Keep only last 60 seconds of blinks.
    const cutoff = Date.now() - 60000;
    this.blinkEvents = this.blinkEvents.filter((t) => t > cutoff);
    // Check rate every ~500 frames (about 8 seconds at 60fps).
    if (this.blinkEvents.length > 0 && this.blinkEvents.length % 100 === 0) {
      if (this.blinkEvents.length < 8) {
        this.hud.setCommand('Remember to blink — your blink rate is low.');
      }
    }
  }

  // Gaze Heatmap - draw a canvas overlay.
  showHeatmap(): void {
    this.hideHeatmap();
    const root = getOverlayRoot();
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = [
      'position:fixed', 'inset:0',
      'pointer-events:none',
      'opacity:0.7',
      'z-index:2147483644',
    ].join(';');
    this.heatmapEl = canvas;
    root.appendChild(canvas);

    const ctx = canvas.getContext('2d')!;
    const radius = 40;

    for (const { x, y } of this.heatmapData) {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, 'rgba(255,43,43,0.15)');
      grad.addColorStop(1, 'rgba(255,43,43,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    setTimeout(() => this.hideHeatmap(), 5000);
  }

  hideHeatmap(): void {
    this.heatmapEl?.remove();
    this.heatmapEl = null;
  }

  /** Release resources (called when ARIA is disabled). */
  destroy(): void {
    this.removeRuler();
    this.hideHeatmap();
    this.calibration = null;
    this.transform = null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
