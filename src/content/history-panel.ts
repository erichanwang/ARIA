/**
 * Floating command history panel. Shows the last 10 commands with status
 * badges and a redo button. Slides in from the right edge of the screen.
 * Toggled by Ctrl+Shift+H or the toggle button on the panel itself.
 *
 * Lives in the overlay shadow root. Each redo dispatches a REDO_COMMAND
 * message to the background.
 */
import { getOverlayRoot } from './overlay';
import { sendRuntime } from '@shared/messages';
import type { HistoryEntry } from '@shared/types';

export class HistoryPanel {
  private el: HTMLDivElement;
  private listEl: HTMLOListElement;
  private open = false;

  constructor() {
    const root = getOverlayRoot();
    this.el = document.createElement('div');
    this.el.id = 'aria-history-panel';
    this.el.setAttribute('data-open', 'false');
    this.el.innerHTML = `
      <div class="aria-hp-header">
        <span class="aria-hp-title">History</span>
        <button class="aria-hp-close" title="Close (Ctrl+Shift+H)">✕</button>
      </div>
      <ol class="aria-hp-list" id="aria-hp-list"></ol>`;
    root.appendChild(this.el);

    this.listEl = this.el.querySelector('#aria-hp-list') as HTMLOListElement;

    this.el.querySelector('.aria-hp-close')!.addEventListener('click', () => this.toggle());

    injectPanelStyle(root);
  }

  toggle(): void {
    this.open = !this.open;
    this.el.setAttribute('data-open', String(this.open));
  }

  show(): void {
    this.open = true;
    this.el.setAttribute('data-open', 'true');
  }

  hide(): void {
    this.open = false;
    this.el.setAttribute('data-open', 'false');
  }

  update(entries: HistoryEntry[]): void {
    this.listEl.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'aria-hp-empty';
      empty.textContent = 'No commands yet.';
      this.listEl.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      this.listEl.appendChild(this.renderEntry(entry));
    }
  }

  private renderEntry(entry: HistoryEntry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'aria-hp-entry';

    const badge = document.createElement('span');
    badge.className = `aria-hp-badge ${entry.success ? 'ok' : 'fail'}`;
    badge.textContent = entry.success ? '✓' : '✗';

    const text = document.createElement('div');
    text.className = 'aria-hp-text';

    const cmd = document.createElement('span');
    cmd.className = 'aria-hp-cmd';
    cmd.textContent = entry.command;

    const meta = document.createElement('span');
    meta.className = 'aria-hp-meta';
    const conf = Math.round(entry.confidence * 100);
    meta.textContent = `${entry.action} · ${conf}% · ${relativeTime(entry.timestamp)}`;

    text.append(cmd, meta);

    const redo = document.createElement('button');
    redo.className = 'aria-hp-redo';
    redo.title = 'Redo this command';
    redo.textContent = '↺';
    redo.addEventListener('click', () => {
      sendRuntime({ type: 'REDO_COMMAND', target: 'background', entryId: entry.id });
    });

    li.append(badge, text, redo);
    return li;
  }
}

function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function injectPanelStyle(root: ShadowRoot): void {
  const existing = root.getElementById('aria-hp-style');
  if (existing) return;
  const style = document.createElement('style');
  style.id = 'aria-hp-style';
  style.textContent = `
    #aria-history-panel {
      position: fixed;
      top: 60px;
      right: -340px;
      width: 320px;
      max-height: calc(100vh - 120px);
      background: rgba(14, 14, 20, 0.96);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px 0 0 12px;
      box-shadow: -4px 0 24px rgba(0,0,0,0.5);
      color: #f3f3f7;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      transition: right 0.25s cubic-bezier(0.4,0,0.2,1);
      pointer-events: all;
      z-index: 1;
      overflow: hidden;
    }
    #aria-history-panel[data-open="true"] { right: 0; }

    .aria-hp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
    }
    .aria-hp-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #9aa0aa;
    }
    .aria-hp-close {
      background: none;
      border: none;
      color: #9aa0aa;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 2px 4px;
    }
    .aria-hp-close:hover { color: #f3f3f7; }

    .aria-hp-list {
      list-style: none;
      margin: 0;
      padding: 6px 0;
      overflow-y: auto;
      flex: 1;
    }
    .aria-hp-empty {
      padding: 20px 14px;
      color: #9aa0aa;
      text-align: center;
    }
    .aria-hp-entry {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .aria-hp-entry:hover { background: rgba(255,255,255,0.04); }

    .aria-hp-badge {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
    }
    .aria-hp-badge.ok  { background: rgba(34,197,94,0.2);  color: #4ade80; }
    .aria-hp-badge.fail{ background: rgba(239,68,68,0.2);   color: #f87171; }

    .aria-hp-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .aria-hp-cmd {
      font-weight: 500;
      color: #f3f3f7;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .aria-hp-meta {
      font-size: 11px;
      color: #9aa0aa;
    }

    .aria-hp-redo {
      flex-shrink: 0;
      background: none;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 6px;
      color: #9aa0aa;
      cursor: pointer;
      font-size: 15px;
      padding: 2px 7px;
      transition: color 0.15s, border-color 0.15s;
    }
    .aria-hp-redo:hover { color: #f3f3f7; border-color: rgba(255,255,255,0.3); }
  `;
  root.appendChild(style);
}
