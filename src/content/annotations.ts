/**
 * Page annotations: persistent sticky notes anchored to elements.
 * Stored in chrome.storage.local keyed by URL + CSS path.
 * Say "annotate [note text]" to add a note at the current cursor position.
 */

const KEY_PREFIX = 'aria.ann.';

// KI-13: annotations accumulated indefinitely with no cleanup. Cap how many
// are kept per hostname and drop ones older than the TTL.
const MAX_PER_HOSTNAME = 50;
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface Annotation {
  url: string;
  path: string;
  note: string;
  x: number;
  y: number;
  createdAt: number;
}

/** Drop expired annotations and cap the list to the most recent MAX_PER_HOSTNAME. */
export function pruneAnnotations(anns: Annotation[], now: number): Annotation[] {
  const fresh = anns.filter((a) => now - a.createdAt < TTL_MS);
  return fresh.length > MAX_PER_HOSTNAME ? fresh.slice(-MAX_PER_HOSTNAME) : fresh;
}

/** Save an annotation at (x, y) viewport coordinates and return its id. */
export async function saveAnnotation(x: number, y: number, note: string): Promise<void> {
  const el = document.elementFromPoint(x, y);
  const path = el ? cssPath(el) : 'body';
  const ann: Annotation = { url: location.href, path, note, x, y, createdAt: Date.now() };
  const key = KEY_PREFIX + location.hostname;
  const raw = await chrome.storage.local.get(key);
  const anns: Annotation[] = (raw[key] as Annotation[] | undefined) ?? [];
  anns.push(ann);
  await chrome.storage.local.set({ [key]: pruneAnnotations(anns, Date.now()) });
  renderAnnotation(ann);
}

/** Load and render all annotations for the current page. */
export async function loadPageAnnotations(): Promise<void> {
  const key = KEY_PREFIX + location.hostname;
  const raw = await chrome.storage.local.get(key);
  const stored: Annotation[] = (raw[key] as Annotation[] | undefined) ?? [];
  const anns = pruneAnnotations(stored, Date.now());
  if (anns.length !== stored.length) await chrome.storage.local.set({ [key]: anns });
  for (const ann of anns) {
    if (ann.url === location.href) renderAnnotation(ann);
  }
}

function renderAnnotation(ann: Annotation): void {
  const note = document.createElement('div');
  note.className = 'aria-annotation';
  note.style.cssText = [
    'position:fixed', `left:${ann.x}px`, `top:${ann.y}px`,
    'z-index:2147483644', 'max-width:200px',
    'background:rgba(255,213,79,0.92)', 'color:#1a1200',
    'padding:6px 10px', 'border-radius:6px',
    'font-family:ui-sans-serif,system-ui,sans-serif', 'font-size:12px', 'line-height:1.4',
    'box-shadow:0 4px 12px rgba(0,0,0,0.35)', 'cursor:move',
    'pointer-events:auto',
  ].join(';');
  note.textContent = ann.note;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'float:right;background:none;border:none;cursor:pointer;font-size:10px;padding:0 0 2px 4px;color:#5a4200';
  closeBtn.addEventListener('click', async () => {
    note.remove();
    const key = KEY_PREFIX + location.hostname;
    const raw = await chrome.storage.local.get(key);
    const anns: Annotation[] = (raw[key] as Annotation[] | undefined) ?? [];
    const updated = anns.filter((a) => a.createdAt !== ann.createdAt);
    await chrome.storage.local.set({ [key]: updated });
  });
  note.prepend(closeBtn);
  document.documentElement.appendChild(note);
}

/** Generate a short, stable CSS selector path for an element. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) { selector += `#${current.id}`; parts.unshift(selector); break; }
    const parent = current.parentElement;
    if (parent) {
      const idx = Array.from(parent.children).indexOf(current) + 1;
      selector += `:nth-child(${idx})`;
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.slice(-4).join(' > ');
}
