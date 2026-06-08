/**
 * Extracts the context handed to Claude with every command: URL, title,
 * the user's selected text, and a readable excerpt of the main content.
 * Also loads any per-domain site profile hints.
 */
import type { PageContext } from '@shared/types';
import { loadSiteProfile } from '@shared/site-profiles';

const EXCERPT_LIMIT = 1500;

// Patterns that could be adversarial prompt injections embedded in page content.
// Redact rather than strip so Claude still gets text at the same length.
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions?/gi,
  /disregard\s+(?:your\s+)?(?:previous|prior|above|earlier)\s+instructions?/gi,
  /forget\s+(?:your\s+)?(?:previous|prior|above|earlier)\s+instructions?/gi,
  /you\s+are\s+now\s+(?:a\s+)?(?:an?\s+)?/gi,
  /new\s+(?:system\s+)?instructions?:/gi,
  /\[(?:INST|SYS|SYSTEM|ASSISTANT|USER)\]/gi,
  /<<SYS>>[\s\S]*?<<\/SYS>>/gi,
  /<\|(?:system|im_start|im_end)\|>/gi,
  /<\/?untrusted_page_text>/gi,
];

export function sanitizeForPrompt(text: string): string {
  let out = text;
  for (const pat of INJECTION_PATTERNS) {
    out = out.replace(pat, '[…]');
  }
  return out;
}

let siteHints = '';
let cursorX = window.innerWidth / 2;
let cursorY = window.innerHeight / 2;
// Last gaze position (normalized 0-1).
let gazePos: { x: number; y: number } | null = null;

// Load site-specific hints asynchronously (first call may return empty).
void loadSiteProfile(location.hostname).then((profile) => {
  if (profile?.hints.length) siteHints = `Site hints: ${profile.hints.join('; ')}`;
});

/** Update the cursor position so page context can include nearby element info. */
export function setCursorPosition(x: number, y: number): void {
  cursorX = x;
  cursorY = y;
}

/** Record the latest gaze position for voice+gaze targeting. */
export function setLastGazePos(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    gazePos = null;
    return;
  }
  gazePos = { x: clampNormalized(x), y: clampNormalized(y) };
}

export function getPageContext(): PageContext {
  const excerpt = sanitizeForPrompt(extractMainText().slice(0, EXCERPT_LIMIT));

  // Include info about the element currently under the agent cursor.
  const atCursor = describeElementAt(cursorX, cursorY);
  const cursorHint = atCursor ? `Element at cursor: ${atCursor}` : '';

  // Enumerate numbered options visible on screen (dropdowns, radio groups, lists).
  const numberedHint = enumerateVisibleOptions();

  const parts = [siteHints, cursorHint, numberedHint, excerpt].filter(Boolean);
  return {
    url: location.href,
    title: document.title,
    selected_text: (window.getSelection()?.toString() ?? '').trim().slice(0, 1000),
    excerpt: parts.join('\n\n'),
    gazePos: gazePos ?? undefined,
  };
}

/** Find the most prominent list of options on screen and number them 1..N. */
function enumerateVisibleOptions(): string {
  // Priority: open <select> options, radio groups, then visible <li> items.
  const selects = document.querySelectorAll<HTMLSelectElement>('select');
  for (const sel of selects) {
    const rect = sel.getBoundingClientRect();
    if (rect.width === 0) continue;
    const opts = Array.from(sel.options).slice(0, 10);
    if (opts.length < 2) continue;
    const lines = opts.map((o, i) => `  ${i + 1}. ${o.text.trim()}`);
    return `Visible select options:\n${lines.join('\n')}`;
  }
  const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  if (radios.length >= 2) {
    const visible = Array.from(radios).filter((r) => r.offsetParent !== null).slice(0, 8);
    if (visible.length >= 2) {
      const lines = visible.map((r, i) => {
        const label = r.nextElementSibling?.textContent?.trim()
          ?? r.closest('label')?.textContent?.trim()
          ?? r.value;
        return `  ${i + 1}. ${label}`;
      });
      return `Visible radio options:\n${lines.join('\n')}`;
    }
  }
  return '';
}

function describeElementAt(x: number, y: number): string {
  const el = document.elementFromPoint(x, y);
  if (!el || el === document.body || el === document.documentElement) return '';
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? '';
  const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
  const text = el.textContent?.trim().slice(0, 80) ?? '';
  const href = el instanceof HTMLAnchorElement ? el.href : '';
  const parts = [tag, role && `role=${role}`, label && `label="${label}"`, text && `"${text}"`, href && `→${href}`].filter(Boolean);
  return parts.join(' ');
}

/** Returns the best-effort main readable text of the page. */
export function extractMainText(): string {
  const root = pickContentRoot();
  return collapseWhitespace(visibleText(root));
}

function pickContentRoot(): Element {
  const candidates = [
    document.querySelector('main'),
    document.querySelector('article'),
    document.querySelector('[role="main"]'),
    document.querySelector('#content, #main, .content, .post, .article'),
  ].filter((el): el is Element => el !== null);

  // Choose the candidate with the most text; otherwise fall back to body.
  let best: Element = document.body ?? document.documentElement;
  let bestLen = best ? visibleText(best).length : 0;
  for (const c of candidates) {
    const len = visibleText(c).length;
    if (len > bestLen) {
      best = c;
      bestLen = len;
    }
  }
  return best;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'SVG', 'IFRAME']);

/** Concatenate visible text, skipping hidden and non-content nodes. */
function visibleText(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      const text = node.nodeValue?.trim();
      if (!text) return NodeFilter.FILTER_REJECT;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  let node: Node | null;
  // Keep this bounded - we only need ~1500 chars downstream.
  while ((node = walker.nextNode()) && parts.join(' ').length < EXCERPT_LIMIT * 3) {
    parts.push(node.nodeValue!.trim());
  }
  return parts.join(' ');
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, value));
}
