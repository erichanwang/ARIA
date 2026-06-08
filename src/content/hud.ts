/**
 * Floating HUD panel: shows the live status, the last transcript, and the last
 * command. Lives in the overlay shadow root. Auto-hides after a few seconds of
 * inactivity so it doesn't clutter the page.
 */
import { getOverlayRoot } from './overlay';
import type { CursorState } from '@shared/types';

const STATUS_TEXT: Record<CursorState, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  thinking: 'Thinking…',
  acting: 'Acting…',
  error: 'Trouble',
};

export class Hud {
  private el: HTMLDivElement;
  private statusEl: HTMLElement;
  private transcriptEl: HTMLElement;
  private commandEl: HTMLElement;
  private hideTimer: number | null = null;

  constructor() {
    const root = getOverlayRoot();
    const existing = root.getElementById('aria-hud') as HTMLDivElement | null;
    this.el = existing ?? document.createElement('div');
    if (!existing) {
      this.el.id = 'aria-hud';
      this.el.setAttribute('role', 'region');
      this.el.setAttribute('aria-label', 'ARIA agent status');
      this.el.innerHTML = `
        <div class="aria-hud-status">
          <span class="aria-hud-dot" aria-hidden="true"></span>
          <span class="aria-hud-status-text" role="status" aria-live="polite" aria-atomic="true">Ready</span>
        </div>
        <div class="aria-hud-transcript" aria-live="assertive" aria-atomic="false"></div>
        <div class="aria-hud-command" aria-live="polite" aria-atomic="true"></div>`;
      root.appendChild(this.el);
    }
    this.statusEl = this.el.querySelector('.aria-hud-status-text')!;
    this.transcriptEl = this.el.querySelector('.aria-hud-transcript')!;
    this.commandEl = this.el.querySelector('.aria-hud-command')!;

    this.restorePosition();
    this.makeDraggable();
  }

  /** Load a previously saved HUD position and apply it. */
  private restorePosition(): void {
    void chrome.storage.local.get('aria.hudPos').then((raw) => {
      const pos = raw['aria.hudPos'] as { x: number; y: number } | undefined;
      if (!pos) return;
      this.el.style.setProperty('--hud-x', `${pos.x}px`);
      this.el.style.setProperty('--hud-y', `${pos.y}px`);
    });
  }

  /** Allow dragging the HUD by its status bar. Saves position on drop. */
  private makeDraggable(): void {
    const handle = this.el.querySelector('.aria-hud-status') as HTMLElement | null;
    if (!handle) return;
    handle.style.cursor = 'grab';

    let dragging = false;
    let ox = 0; // cursor offset from HUD top-left
    let oy = 0;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = this.el.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      handle.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(window.innerWidth - 200, e.clientX - ox));
      const y = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - oy));
      this.el.style.setProperty('--hud-x', `${x}px`);
      this.el.style.setProperty('--hud-y', `${y}px`);
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = 'grab';
      // Read back the CSS var to persist.
      const style = getComputedStyle(this.el);
      const x = parseFloat(style.getPropertyValue('--hud-x')) || 0;
      const y = parseFloat(style.getPropertyValue('--hud-y')) || 0;
      void chrome.storage.local.set({ 'aria.hudPos': { x, y } });
    });
  }

  setState(state: CursorState): void {
    this.statusEl.textContent = STATUS_TEXT[state];
    const dot = this.el.querySelector<HTMLElement>('.aria-hud-dot');
    if (dot) dot.style.background = STATE_COLOR[state];
    this.show();
    if (state === 'idle') this.scheduleHide(2500);
  }

  /**
   * Show a low-confidence prompt bar inside the HUD.
   * The confirm/cancel callbacks relay to the background via the caller.
   */
  showConfidencePrompt(
    confidence: number,
    actionSummary: string,
    onConfirm: () => void,
    onCancel: () => void,
    autoConfirmMs = 5000,
  ): void {
    this.dismissConfidencePrompt();

    const bar = document.createElement('div');
    bar.className = 'aria-hud-confidence';

    const pct = Math.round(confidence * 100);
    const timerEl = document.createElement('span');
    timerEl.className = 'aria-hud-conf-timer';
    timerEl.textContent = '5';

    bar.innerHTML = `
      <span class="aria-hud-conf-icon">⚠</span>
      <span class="aria-hud-conf-text">Not sure (${pct}%) — trying <em>${actionSummary}</em></span>`;
    bar.appendChild(timerEl);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'aria-hud-conf-btns';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Proceed';
    confirmBtn.className = 'aria-hud-conf-btn ok';
    confirmBtn.addEventListener('click', () => { cleanup(); onConfirm(); });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'aria-hud-conf-btn';
    cancelBtn.addEventListener('click', () => { cleanup(); onCancel(); });

    btnGroup.setAttribute('role', 'group');
    btnGroup.setAttribute('aria-label', 'Confidence prompt');
    btnGroup.append(confirmBtn, cancelBtn);
    bar.setAttribute('role', 'alert');
    bar.appendChild(btnGroup);
    this.el.appendChild(bar);
    this.show();
    confirmBtn.focus();

    let secs = Math.round(autoConfirmMs / 1000);
    const interval = window.setInterval(() => {
      secs--;
      timerEl.textContent = String(secs);
      if (secs <= 0) { cleanup(); onConfirm(); }
    }, 1000);

    const cleanup = () => {
      clearInterval(interval);
      bar.remove();
    };

    (this.el as unknown as { _confCleanup?: () => void })._confCleanup = cleanup;
  }

  dismissConfidencePrompt(): void {
    const prev = this.el.querySelector('.aria-hud-confidence');
    if (prev) prev.remove();
    const cleanup = (this.el as unknown as { _confCleanup?: () => void })._confCleanup;
    cleanup?.();
  }

  /** The interim/final transcript of what the user said. */
  setTranscript(text: string): void {
    this.transcriptEl.textContent = text;
    this.show();
  }

  /** A secondary line (e.g. the command being executed or a status note). */
  setCommand(text: string): void {
    this.commandEl.textContent = text;
    this.show();
  }

  show(): void {
    this.el.setAttribute('data-visible', 'true');
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  hide(): void {
    this.el.setAttribute('data-visible', 'false');
  }

  /** Show which input modes are currently active (for combined modes). */
  setActiveModes(modes: string[]): void {
    let modeEl = this.el.querySelector<HTMLElement>('.aria-hud-modes');
    if (modes.length === 0) {
      modeEl?.remove();
      return;
    }
    if (!modeEl) {
      modeEl = document.createElement('div');
      modeEl.className = 'aria-hud-modes';
      this.el.appendChild(modeEl);
    }
    modeEl.innerHTML = modes
      .map((m) => `<span class="aria-hud-mode-chip">${m}</span>`)
      .join('');
  }

  private scheduleHide(ms: number): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), ms);
  }
}

const STATE_COLOR: Record<CursorState, string> = {
  idle: '#ff2b2b',
  listening: '#2b7fff',
  thinking: '#9b6bff',
  acting: '#ffffff',
  error: '#ff8c00',
};
