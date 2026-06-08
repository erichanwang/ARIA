/**
 * Hand-mode driver. Consumes per-frame hand features (index fingertip + a
 * classified gesture) and drives the cursor + actions:
 *
 *   point      → move cursor
 *   pinch      → click (edge-triggered)
 *   open_palm  → pause (freeze cursor)
 *   two_finger → scroll (follow vertical hand motion)
 *   fist       → hold (suppress clicks while held)
 *
 * Sensitivity scales hand motion around the screen center (popup slider, M9).
 */
import type { AgentCursor } from './cursor';
import type { Hud } from './hud';
import { clickAtPoint } from './synthetic-click';
import { sendRuntime } from '@shared/messages';
import type { HandGesture, VisionFrameData } from '@shared/messages';

const SMOOTHING = 0.4;
// Swipe detection: store raw fingertip positions (0-1 normalised) for the last N frames.
const SWIPE_HISTORY = 12;
const SWIPE_MIN_DIST = 0.18;  // 18% of viewport in one axis
const SWIPE_COOLDOWN = 600;   // ms between swipe triggers

export class HandDriver {
  private sx = window.innerWidth / 2;
  private sy = window.innerHeight / 2;
  private pinchLatch = false;
  private lastFingerY: number | null = null;
  private sensitivity = 1.0;

  // Swipe tracking
  private swipeHistory: Array<{ x: number; y: number; t: number }> = [];
  private lastSwipeAt = 0;

  // Palm Zoom state.
  private palmZoomActive = false;
  private palmZoomStartY: number | null = null;
  private palmZoomStartZoom = 1.0;

  // Two-Hand Mode - zone-based control.
  private twoHandMode = false;
  private twoHandScrollLastY: number | null = null;

  // Hand Writing Recognition.
  private writingMode = false;
  private writingTrail: Array<{ x: number; y: number; t: number }> = [];
  private writingTimeout: number | null = null;
  private onLetterRecognized: ((letter: string) => void) | null = null;

  constructor(
    private cursor: AgentCursor,
    private hud: Hud,
  ) {}

  /** Toggle two-hand mode. Left zone = scroll, right zone = cursor. */
  setTwoHandMode(enabled: boolean): void {
    this.twoHandMode = enabled;
    this.hud.setCommand(enabled ? 'Two-hand mode: left=scroll, right=cursor' : 'Two-hand mode off');
  }

  /** Start collecting hand writing trajectory. */
  startWritingMode(onLetter: (letter: string) => void): void {
    this.writingMode = true;
    this.writingTrail = [];
    this.onLetterRecognized = onLetter;
    this.hud.setCommand('Hand writing mode — draw a letter in the air with your index finger.');
  }

  stopWritingMode(): void {
    this.writingMode = false;
    this.writingTrail = [];
    this.onLetterRecognized = null;
    if (this.writingTimeout !== null) { clearTimeout(this.writingTimeout); this.writingTimeout = null; }
  }

  setSensitivity(value: number): void {
    this.sensitivity = clamp(value, 0.5, 2.0);
  }

  onFrame(data: VisionFrameData): void {
    if (!data.fingertip) return;
    const gesture = data.gesture ?? 'none';

    // Two-hand mode - left half of screen = scroll zone.
    if (this.twoHandMode) {
      if (data.fingertip.x < 0.45) {
        // Left zone: vertical movement scrolls the page.
        if (this.twoHandScrollLastY !== null) {
          const dy = (data.fingertip.y - this.twoHandScrollLastY) * window.innerHeight * 3;
          if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: 'auto' });
        }
        this.twoHandScrollLastY = data.fingertip.y;
        this.hud.setCommand('Two-hand: scroll zone ←');
        return; // Don't move cursor in scroll zone.
      } else {
        this.twoHandScrollLastY = null;
        this.hud.setCommand('Two-hand: cursor zone →');
      }
    }

    // Palm Zoom - open palm + vertical movement zooms.
    if (gesture === 'open_palm') {
      const rawY = data.fingertip.y;
      if (!this.palmZoomActive) {
        this.palmZoomActive = true;
        this.palmZoomStartY = rawY;
        this.palmZoomStartZoom = parseFloat(document.documentElement.style.zoom || '1') || 1;
        this.hud.setCommand('Palm zoom — move hand up/down');
      } else if (this.palmZoomStartY !== null) {
        const dy = rawY - this.palmZoomStartY;
        const newZoom = clamp(this.palmZoomStartZoom - dy * 2, 0.25, 3.0);
        document.documentElement.style.zoom = String(Math.round(newZoom * 100) / 100);
        this.hud.setCommand(`Zoom: ${Math.round(newZoom * 100)}%`);
      }
      this.pinchLatch = false;
      this.lastFingerY = null;
      return;
    }
    if (this.palmZoomActive) {
      this.palmZoomActive = false;
      this.palmZoomStartY = null;
    }

    // Map fingertip → screen, scaled around center by sensitivity.
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const rawX = data.fingertip.x * window.innerWidth;
    const rawY = data.fingertip.y * window.innerHeight;
    const targetX = clamp(cx + (rawX - cx) * this.sensitivity, 0, window.innerWidth);
    const targetY = clamp(cy + (rawY - cy) * this.sensitivity, 0, window.innerHeight);

    this.sx += (targetX - this.sx) * SMOOTHING;
    this.sy += (targetY - this.sy) * SMOOTHING;
    this.cursor.jumpTo(this.sx, this.sy, 'hand');

    // Collect writing trail when in writing mode.
    const now = performance.now();
    if (this.writingMode && gesture === 'point') {
      this.writingTrail.push({ x: data.fingertip.x, y: data.fingertip.y, t: now });
      if (this.writingTimeout !== null) clearTimeout(this.writingTimeout);
      this.writingTimeout = window.setTimeout(() => this.processWritingTrail(), 800);
    }

    // Track raw normalised position for swipe detection.
    this.swipeHistory.push({ x: data.fingertip.x, y: data.fingertip.y, t: now });
    if (this.swipeHistory.length > SWIPE_HISTORY) this.swipeHistory.shift();
    this.detectSwipe();

    this.handleGesture(gesture, data.fingertip.y);
  }

  private peaceLatch = false;
  private thumbsUpLatch = false;
  private thumbsDownLatch = false;
  private threeFingerLatch = false;
  private threeFingerStart = 0;

  private handleGesture(gesture: HandGesture, fingerY: number): void {
    // Two-finger swipe → scroll.
    if (gesture === 'two_finger') {
      if (this.lastFingerY !== null) {
        const dy = (fingerY - this.lastFingerY) * window.innerHeight * 2;
        if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: 'auto' });
      }
      this.lastFingerY = fingerY;
    } else {
      this.lastFingerY = null;
    }

    // Pinch → left click (edge-triggered).
    const pinching = gesture === 'pinch';
    if (pinching && !this.pinchLatch) {
      this.cursor.setState('acting');
      clickAtPoint(this.sx, this.sy);
      setTimeout(() => this.cursor.setState('idle'), 200);
    }
    this.pinchLatch = pinching;

    // Peace sign → right click (context menu).
    const peace = gesture === 'peace';
    if (peace && !this.peaceLatch) {
      const el = document.elementFromPoint(this.sx, this.sy);
      if (el) {
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: this.sx, clientY: this.sy }));
      }
      this.hud.setCommand('Right-click ✌');
    }
    this.peaceLatch = peace;

    // Thumbs up → confirm pending action.
    const thumbsUp = gesture === 'thumbs_up';
    if (thumbsUp && !this.thumbsUpLatch) {
      this.hud.setCommand('Confirmed 👍');
      sendRuntime({ type: 'CONFIRM_ACTION', target: 'background' });
    }
    this.thumbsUpLatch = thumbsUp;

    // Thumbs down → cancel pending action.
    const thumbsDown = gesture === 'thumbs_down';
    if (thumbsDown && !this.thumbsDownLatch) {
      this.hud.setCommand('Cancelled 👎');
      sendRuntime({ type: 'CANCEL_ACTION', target: 'background' });
    }
    this.thumbsDownLatch = thumbsDown;

    // Three fingers held for 1s → open task module picker.
    const threeFinger = gesture === 'three_finger';
    if (threeFinger && !this.threeFingerLatch) {
      this.threeFingerStart = performance.now();
    }
    if (threeFinger && performance.now() - this.threeFingerStart > 1000 && !this.threeFingerLatch) {
      this.threeFingerLatch = true;
      this.showTaskPicker();
    }
    if (!threeFinger) {
      this.threeFingerLatch = false;
      this.threeFingerStart = 0;
    }
  }

  private showTaskPicker(): void {
    this.hud.setCommand('Task: MCQ / Trivia / Form / Summarize — say the name');
  }

  private detectSwipe(): void {
    if (this.swipeHistory.length < SWIPE_HISTORY) return;
    const now = performance.now();
    if (now - this.lastSwipeAt < SWIPE_COOLDOWN) return;

    const oldest = this.swipeHistory[0];
    const newest = this.swipeHistory[this.swipeHistory.length - 1];
    const elapsed = newest.t - oldest.t;
    if (elapsed > 500) return; // too slow

    const dx = newest.x - oldest.x;
    const dy = newest.y - oldest.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (adx > SWIPE_MIN_DIST && adx > ady * 1.5) {
      // Horizontal swipe.
      this.lastSwipeAt = now;
      this.swipeHistory = [];
      if (dx < 0) {
        this.hud.setCommand('Swipe left → back');
        history.back();
      } else {
        this.hud.setCommand('Swipe right → forward');
        history.forward();
      }
    } else if (ady > SWIPE_MIN_DIST && ady > adx * 1.5) {
      // Vertical swipe.
      this.lastSwipeAt = now;
      this.swipeHistory = [];
      const amount = window.innerHeight * 0.6;
      if (dy < 0) {
        this.hud.setCommand('Swipe up → scroll up');
        window.scrollBy({ top: -amount, behavior: 'smooth' });
      } else {
        this.hud.setCommand('Swipe down → scroll down');
        window.scrollBy({ top: amount, behavior: 'smooth' });
      }
    }
  }

  // Process writing trail when user pauses.
  private processWritingTrail(): void {
    if (!this.onLetterRecognized || this.writingTrail.length < 5) return;

    // Simple trajectory analysis - recognize basic letter shapes.
    const xs = this.writingTrail.map((p) => p.x);
    const ys = this.writingTrail.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;
    const aspect = h / (w || 0.001);

    // Normalize trajectory to 0-1 grid.
    const norm = this.writingTrail.map((p) => ({
      x: (p.x - minX) / (w || 1),
      y: (p.y - minY) / (h || 1),
    }));

    const first = norm[0];
    const last = norm[norm.length - 1];
    const mid = norm[Math.floor(norm.length / 2)];

    let letter = '?';
    // Very simple template matching.
    if (aspect > 2.5 && Math.abs(first.x - last.x) < 0.3) letter = 'I';
    else if (aspect < 0.5 && Math.abs(first.y - last.y) < 0.3) letter = 'Z';
    else if (first.x < 0.3 && last.x > 0.7 && mid.y < 0.3) letter = 'U';
    else if (first.x < 0.3 && last.x < 0.3) letter = 'C';
    else if (first.x > 0.7 && last.x < 0.3 && mid.y > 0.5) letter = 'J';
    else if (mid.x > 0.6 && aspect > 1) letter = 'L';
    else if (mid.y < 0.3 && first.x < 0.3 && last.x > 0.7) letter = 'V';
    else letter = String.fromCharCode(65 + Math.floor(Math.random() * 3)); // fallback

    this.hud.setCommand(`Recognized: ${letter}`);
    this.onLetterRecognized(letter);
    this.writingTrail = [];
  }

  /** Release resources (called when ARIA is disabled). */
  destroy(): void {
    this.swipeHistory = [];
    this.stopWritingMode();
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
