/**
 * Floating Transcript
 * Persistent panel showing the full session conversation.
 * Scrollable, copyable, exportable to .txt.
 */

const PANEL_ID = 'aria-float-transcript';

interface TranscriptEntry {
  role: 'user' | 'aria';
  text: string;
  timestamp: number;
}

const sessionEntries: TranscriptEntry[] = [];

export function addTranscriptEntry(role: 'user' | 'aria', text: string): void {
  sessionEntries.push({ role, text, timestamp: Date.now() });
  const panel = document.getElementById(PANEL_ID);
  if (panel) appendEntry(panel.querySelector('.aria-ft-body')!, { role, text, timestamp: Date.now() });
}

export function toggleFloatingTranscript(): void {
  const existing = document.getElementById(PANEL_ID);
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed', 'bottom:20px', 'left:20px',
    'width:340px', 'max-height:420px',
    'background:rgba(14,14,20,0.96)',
    'border:1px solid rgba(255,255,255,0.12)',
    'border-radius:12px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.6)',
    'backdrop-filter:blur(10px)',
    'z-index:2147483645',
    'display:flex', 'flex-direction:column',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:13px', 'color:#f3f3f7',
    'overflow:hidden',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex', 'justify-content:space-between', 'align-items:center',
    'padding:10px 14px', 'border-bottom:1px solid rgba(255,255,255,0.08)',
    'font-size:11px', 'text-transform:uppercase', 'letter-spacing:0.6px', 'color:#9aa0aa',
    'cursor:grab',
  ].join(';');
  header.innerHTML = '<span>Session Transcript</span>';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.style.cssText = btnStyle();
  copyBtn.addEventListener('click', () => {
    const text = sessionEntries.map((e) => `[${e.role.toUpperCase()}] ${e.text}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  });

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export';
  exportBtn.style.cssText = btnStyle();
  exportBtn.addEventListener('click', () => {
    const text = sessionEntries
      .map((e) => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.role.toUpperCase()}: ${e.text}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aria-transcript.txt';
    a.click();
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = btnStyle();
  closeBtn.addEventListener('click', () => panel.remove());

  btnRow.append(copyBtn, exportBtn, closeBtn);
  header.appendChild(btnRow);

  const body = document.createElement('div');
  body.className = 'aria-ft-body';
  body.style.cssText = 'overflow-y:auto;flex:1;padding:10px 14px;display:flex;flex-direction:column;gap:8px';

  sessionEntries.forEach((e) => appendEntry(body, e));

  panel.append(header, body);
  document.documentElement.appendChild(panel);
  body.scrollTop = body.scrollHeight;

  makeDraggable(panel, header);
}

function appendEntry(container: Element, entry: TranscriptEntry): void {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:column;gap:2px';

  const label = document.createElement('span');
  label.style.cssText = `font-size:10px;font-weight:700;text-transform:uppercase;color:${entry.role === 'user' ? '#2b7fff' : '#9b6bff'}`;
  label.textContent = entry.role === 'user' ? 'You' : 'ARIA';

  const text = document.createElement('span');
  text.style.cssText = 'color:#f3f3f7;line-height:1.4';
  text.textContent = entry.text;

  row.append(label, text);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function btnStyle(): string {
  return 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:#9aa0aa;border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer';
}

function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  let dragging = false, ox = 0, oy = 0;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    const r = panel.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panel.style.left = `${e.clientX - ox}px`;
    panel.style.top = `${e.clientY - oy}px`;
    panel.style.bottom = 'unset';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}
