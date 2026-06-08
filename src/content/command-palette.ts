/**
 * Inline command palette - lets the user type commands directly without voice.
 * Renders a floating input bar in the page DOM. Submitting routes the text
 * through the same background message path as a final voice transcript.
 * Opened via Ctrl+Shift+P.
 */
import { sendRuntime } from '@shared/messages';
import type { HistoryEntry } from '@shared/types';

let palette: HTMLDivElement | null = null;

export async function openCommandPalette(): Promise<void> {
  if (palette) {
    closePalette();
    return;
  }

  // Load recent command history + all-time frequency data for ranked suggestions.
  const [histRaw, freqRaw] = await Promise.all([
    chrome.storage.local.get('aria.history'),
    chrome.storage.local.get('aria.cmdfreq'),
  ]);
  const entries = (histRaw['aria.history'] as HistoryEntry[] | undefined) ?? [];
  const freq: Record<string, number> = (freqRaw['aria.cmdfreq'] as Record<string, number>) ?? {};

  // Merge recency with frequency: recent commands always appear first; then
  // top-frequency commands that haven't appeared in recent history.
  const recent = [...new Set(entries.slice(-20).map((e) => e.command))];
  const topFreq = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([cmd]) => cmd)
    .filter((c) => !recent.some((r) => r.toLowerCase() === c));
  const recentCmds = [...recent, ...topFreq].slice(0, 8);

  palette = document.createElement('div');
  palette.id = 'aria-cmd-palette';
  palette.style.cssText = [
    'position:fixed', 'top:48px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:2147483647', 'width:520px', 'max-width:90vw',
    'background:rgba(18,18,24,0.97)', 'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:12px', 'overflow:hidden',
    'box-shadow:0 16px 48px rgba(0,0,0,0.7)',
    'backdrop-filter:blur(12px)',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'animation:aria-palette-in 0.15s ease',
  ].join(';');

  injectStyle();

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Tell ARIA what to do…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.cssText = [
    'width:100%', 'box-sizing:border-box',
    'padding:12px 14px', 'border:none', 'outline:none',
    'background:transparent', 'color:#f3f3f7',
    'font-size:15px', 'line-height:1.4',
  ].join(';');

  const suggestions = document.createElement('div');
  suggestions.id = 'aria-palette-suggestions';

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:6px 14px 8px;font-size:11px;color:#6a737d;border-top:1px solid rgba(255,255,255,0.06)';
  hint.textContent = 'Enter to send · ↑↓ for history · Escape to close';

  palette.append(input, suggestions, hint);
  document.documentElement.appendChild(palette);
  input.focus();

  let selectedIdx = -1;

  const renderSuggestions = (filter: string) => {
    const filtered = filter
      ? recentCmds.filter((c) => c.toLowerCase().includes(filter.toLowerCase()))
      : recentCmds;
    suggestions.innerHTML = '';
    selectedIdx = -1;
    if (filtered.length === 0) return;
    filtered.forEach((cmd, i) => {
      const item = document.createElement('div');
      item.style.cssText = [
        'padding:7px 14px', 'font-size:13px', 'color:#c0c8d4', 'cursor:pointer',
        'border-top:1px solid rgba(255,255,255,0.04)',
      ].join(';');
      item.textContent = cmd;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = cmd;
        submitCommand();
      });
      item.addEventListener('mouseover', () => { selectedIdx = i; highlightSelected(filtered); });
      suggestions.appendChild(item);
    });
  };

  const highlightSelected = (cmds: string[]) => {
    const items = suggestions.querySelectorAll<HTMLDivElement>('div');
    items.forEach((el, i) => {
      el.style.background = i === selectedIdx ? 'rgba(255,255,255,0.07)' : 'transparent';
      el.style.color = i === selectedIdx ? '#f3f3f7' : '#c0c8d4';
    });
    if (selectedIdx >= 0 && selectedIdx < cmds.length) {
      input.value = cmds[selectedIdx];
    }
  };

  const submitCommand = () => {
    const command = input.value.trim();
    if (command) {
      sendRuntime({ type: 'MANUAL_COMMAND', target: 'background', command });
      closePalette();
    }
  };

  renderSuggestions('');

  input.addEventListener('input', () => renderSuggestions(input.value));

  input.addEventListener('keydown', (e) => {
    const items = suggestions.querySelectorAll<HTMLDivElement>('div');
    const cmds = Array.from(items).map((el) => el.textContent ?? '');

    if (e.key === 'Escape') { e.stopPropagation(); closePalette(); return; }
    if (e.key === 'Enter') { e.preventDefault(); submitCommand(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(cmds.length - 1, selectedIdx + 1);
      highlightSelected(cmds);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectedIdx <= 0) { selectedIdx = -1; return; }
      selectedIdx--;
      highlightSelected(cmds);
    }
  });

  const outsideClick = (e: MouseEvent) => {
    if (!palette?.contains(e.target as Node)) {
      closePalette();
      document.removeEventListener('mousedown', outsideClick);
    }
  };
  document.addEventListener('mousedown', outsideClick);
}

function closePalette(): void {
  palette?.remove();
  palette = null;
}

function injectStyle(): void {
  if (document.getElementById('aria-palette-style')) return;
  const s = document.createElement('style');
  s.id = 'aria-palette-style';
  s.textContent = `
    @keyframes aria-palette-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    #aria-cmd-palette input::placeholder { color: #6a737d; }
  `;
  document.head.appendChild(s);
}
