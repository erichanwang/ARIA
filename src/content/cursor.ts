/**
 * The agent cursor: a glowing dot + "AGENT" label that lives in the overlay
 * shadow root. Owns its own state machine and a 60fps lerp loop so that when
 * the agent moves to a target (e.g. a button before clicking) the motion is
 * smooth and intentional-looking rather than teleporting.
 */
import { getOverlayRoot } from './overlay';
import { updateLinkPreview } from './link-preview';
import { setCursorPosition } from './page-context';
import type { CursorState, InputMode } from '@shared/types';

export class AgentCursor {
  private el: HTMLDivElement;
  private state: CursorState = 'idle';

  // Current rendered position and the target we're lerping toward (px).
  private x: number;
  private y: number;
  private targetX: number;
  private targetY: number;

  private rafId: number | null = null;
  private moveResolve: (() => void) | null = null;
  // Pending rAF for jumpTo - batches same-frame updates so DOM writes cap at 60fps.
  private jumpRafId: number | null = null;

  // Lerp smoothing factor per frame. Higher = snappier. Tuned in MILESTONE 7.
  private readonly ease = 0.18;

  // Mode arbitration: last source to move significantly holds ownership for 250ms.
  private moveOwner: string | null = null;
  private moveOwnerExpiry = 0;

  constructor(scale = 1) {
    const root = getOverlayRoot();
    const existing = root.getElementById('aria-cursor') as HTMLDivElement | null;
    this.el = existing ?? document.createElement('div');
    if (!existing) {
      this.el.id = 'aria-cursor';
      this.el.innerHTML = `<span class="aria-arc"></span><span class="aria-label">AGENT</span>`;
      root.appendChild(this.el);
    }

    // Start parked at viewport center.
    this.x = this.targetX = window.innerWidth / 2;
    this.y = this.targetY = window.innerHeight / 2;
    this.el.style.setProperty('--scale', String(scale));
    this.setState('idle');
    this.render();
  }

  /** Drive the visual state. CSS reacts via the [data-state] attribute. */
  setState(state: CursorState): void {
    this.state = state;
    this.el.setAttribute('data-state', state);
    // Re-trigger one-shot animations (acting flash / error shake) by reflow.
    if (state === 'acting' || state === 'error') {
      void this.el.offsetWidth; // force reflow so the keyframe restarts
    }
  }

  getState(): CursorState {
    return this.state;
  }

  /** Tint the cursor for the active input modality. */
  setMode(mode: InputMode): void {
    this.el.setAttribute('data-mode', mode);
  }

  setScale(scale: number): void {
    this.el.style.setProperty('--scale', String(scale));
  }

  /**
   * Instantly jump (used by eye/hand drivers that update every frame).
   * Optional `source` enables arbitration: the source that last produced a
   * significant move holds a 250ms ownership window; other sources are ignored
   * during that window so eye and hand don't fight each other.
   */
  jumpTo(x: number, y: number, source?: string): void {
    if (source) {
      const now = Date.now();
      const dist = Math.hypot(x - this.x, y - this.y);
      // Claim ownership if no current owner, this source already owns it, or it
      // has expired, AND the move is non-trivial (> 4px).
      if (dist > 4) {
        if (!this.moveOwner || this.moveOwner === source || now > this.moveOwnerExpiry) {
          this.moveOwner = source;
          this.moveOwnerExpiry = now + 250;
        }
      }
      // Reject moves from a non-owning source while the window is active.
      if (this.moveOwner && this.moveOwner !== source && now < this.moveOwnerExpiry) return;
    }
    this.x = this.targetX = x;
    this.y = this.targetY = y;
    if (this.jumpRafId === null) {
      this.jumpRafId = requestAnimationFrame(() => {
        this.jumpRafId = null;
        this.render();
        updateLinkPreview(this.x, this.y);
      });
    }
  }

  /**
   * Smoothly animate to (x, y). Resolves when the cursor settles within ~1px.
   * Used before a click so the user can see the agent reach for the element.
   */
  moveTo(x: number, y: number): Promise<void> {
    this.targetX = x;
    this.targetY = y;
    // Cancel any in-flight move promise (latest target wins).
    this.moveResolve?.();
    return new Promise((resolve) => {
      this.moveResolve = resolve;
      this.ensureLoop();
    });
  }

  /** Move to an element's center, accounting for scroll position. */
  async moveToElement(el: Element): Promise<void> {
    const r = el.getBoundingClientRect();
    await this.moveTo(r.left + r.width / 2, r.top + r.height / 2);
  }

  /** Current viewport coordinate of the cursor. */
  position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  // Action Replay - record positions during moveTo for replay overlay.
  private replayPositions: Array<{ x: number; y: number }> = [];
  private recordingReplay = false;

  startReplayRecording(): void {
    this.replayPositions = [];
    this.recordingReplay = true;
  }

  stopReplayRecording(): void {
    this.recordingReplay = false;
    const positions = [...this.replayPositions];
    if (positions.length < 2) return;
    setTimeout(() => this.showReplayTrail(positions), 100);
  }

  private showReplayTrail(positions: Array<{ x: number; y: number }>): void {
    const root = this.el.parentNode as ShadowRoot | null;
    if (!root) return;
    positions.forEach((pos, i) => {
      const dot = document.createElement('div');
      dot.className = 'aria-replay-dot';
      dot.style.cssText = [
        'position:fixed', 'top:0', 'left:0',
        'width:6px', 'height:6px',
        'margin-left:-3px', 'margin-top:-3px',
        'border-radius:50%',
        `background:rgba(155,107,255,${0.8 - (i / positions.length) * 0.6})`,
        'pointer-events:none',
        `transform:translate(${pos.x}px,${pos.y}px)`,
        `animation:aria-trail-fade 2s ease-out ${i * 0.02}s forwards`,
      ].join(';');
      root.appendChild(dot);
      setTimeout(() => dot.remove(), 2500 + i * 20);
    });
  }

  /** Emit a fading trail crumb at the current position (called during moveTo). */
  private emitTrail(): void {
    const root = this.el.parentNode as ShadowRoot | null;
    if (!root) return;
    const dot = document.createElement('div');
    dot.className = 'aria-trail';
    if (this.moveOwner) dot.dataset.source = this.moveOwner;
    dot.style.setProperty('--x', `${this.x}px`);
    dot.style.setProperty('--y', `${this.y}px`);
    root.appendChild(dot);
    // CSS handles the fade; remove after animation completes.
    setTimeout(() => dot.remove(), 600);
    // Record position for replay.
    if (this.recordingReplay) this.replayPositions.push({ x: this.x, y: this.y });
  }

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.jumpRafId !== null) cancelAnimationFrame(this.jumpRafId);
    this.el.remove();
  }

  /* ------------------------------ internals ------------------------------- */

  private trailCounter = 0;

  private ensureLoop(): void {
    if (this.rafId !== null) return;
    const step = () => {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 1) {
        this.x = this.targetX;
        this.y = this.targetY;
        this.render();
        this.rafId = null;
        const r = this.moveResolve;
        this.moveResolve = null;
        r?.();
        return;
      }

      this.x += dx * this.ease;
      this.y += dy * this.ease;
      this.render();

      // Emit a trail crumb every ~4 frames while moving significantly.
      this.trailCounter++;
      if (this.trailCounter % 4 === 0 && dist > 8) this.emitTrail();

      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private render(): void {
    this.el.style.setProperty('--x', `${this.x}px`);
    this.el.style.setProperty('--y', `${this.y}px`);
    setCursorPosition(this.x, this.y);
  }
}
