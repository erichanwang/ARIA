/**
 * Semantic element finder. Turns a natural-language target like "the login
 * button" into a concrete DOM element using a cascade of strategies, returning
 * the first confident match.
 *
 * Strategy order (per MVP spec):
 *   1. aria-label / accessible name contains target
 *   2. Visible text content matches (button, a, [role=button], label, summary)
 *   3. placeholder / title / value matches (inputs & buttons)
 *   4. name or id attribute matches
 *   5. submit-ish intent ("submit"/"go"/"continue"/"search") → submit control
 *   6. Closest interactive element to any element whose text matches
 *
 * A learned-target map (click-to-teach) is consulted FIRST so user corrections
 * stick for the session.
 *
 * Shadow DOM: candidate discovery (strategies 1-6) recurses into any OPEN
 * shadow root it finds, since `querySelectorAll`/`TreeWalker` never cross a
 * shadow boundary on their own. Closed shadow roots have no JS-visible
 * handle at all and remain unreachable - that's a real, permanent limitation
 * of any DOM-based finder, not something this cascade papers over.
 */

const INTERACTIVE = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], summary, label';

// Session-scoped click-to-teach memory: normalized target → element.
const learned = new Map<string, Element>();

// Short-lived result cache: skip full DOM scan if same target was found <2s ago
// and the element is still connected.
interface FindCacheEntry { el: Element; at: number }
const findCache = new Map<string, FindCacheEntry>();
const FIND_CACHE_TTL = 2000;

// Per-domain persistent selector cache: restored from storage on first use.
// Key: `aria.teach.${hostname}` → Record<normalizedTarget, cssSelector>
let persistentLoaded = false;
const persistentSelectors = new Map<string, string>();

function ensurePersistentLoaded(): void {
  if (persistentLoaded) return;
  persistentLoaded = true;
  const key = `aria.teach.${location.hostname}`;
  chrome.storage.local.get(key).then((raw) => {
    const map = raw[key] as Record<string, string> | undefined;
    if (!map) return;
    for (const [target, selector] of Object.entries(map)) {
      persistentSelectors.set(target, selector);
    }
  }).catch(() => {});
}

function savePersistentSelector(target: string, selector: string): void {
  const key = `aria.teach.${location.hostname}`;
  persistentSelectors.set(target, selector);
  const obj: Record<string, string> = {};
  persistentSelectors.forEach((v, k) => { obj[k] = v; });
  chrome.storage.local.set({ [key]: obj }).catch(() => {});
}

export function teachTarget(target: string, el: Element): void {
  const normalizedTarget = norm(target);
  learned.set(normalizedTarget, el);
  // Derive and persist a stable CSS selector for this element.
  const selector = deriveCssSelector(el);
  if (selector) savePersistentSelector(normalizedTarget, selector);
}

/**
 * Attempt to derive a short, stable CSS selector for the element.
 * Tries id, then aria-label, then a short nth-child path.
 */
function deriveCssSelector(el: Element): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const aria = el.getAttribute('aria-label');
  if (aria) return `[aria-label="${CSS.escape(aria)}"]`;
  // Short nth-child chain (max 3 levels)
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; depth < 3 && cur && cur !== document.body; depth++) {
    const tag = cur.tagName.toLowerCase();
    const parentEl: Element | null = cur.parentElement;
    if (!parentEl) break;
    const siblings = Array.from(parentEl.children).filter((c) => (c as Element).tagName === (cur as Element).tagName);
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const idx = siblings.indexOf(cur) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    }
    cur = parentEl;
  }
  return parts.length ? parts.join(' > ') : null;
}

// Names of the 6 documented matching strategies (see the module docblock),
// plus the memory shortcuts that can short-circuit them. Exposed via
// findElementWithTrace() so the DOM-finder benchmark can report which
// strategy actually resolved each target instead of only pass/fail.
export type FindStrategy =
  | 'cache' | 'learned' | 'persistent'
  | 'aria-label' | 'text' | 'attribute' | 'name-id' | 'submit-intent' | 'nearest-interactive';

export function findElement(target: string): Element | null {
  return findElementWithTrace(target)?.el ?? null;
}

export function findElementWithTrace(target: string): { el: Element; strategy: FindStrategy } | null {
  ensurePersistentLoaded();
  const want = norm(target);
  if (!want) return null;

  // Short-lived result cache.
  const cached = findCache.get(want);
  if (cached && cached.el.isConnected && Date.now() - cached.at < FIND_CACHE_TTL) {
    return { el: cached.el, strategy: 'cache' };
  }

  // 0a. Session-scoped learned override.
  const taught = learned.get(want);
  if (taught && taught.isConnected) return { el: taught, strategy: 'learned' };

  // 0b. Persistent selector from a previous teach session.
  const persistSel = persistentSelectors.get(want);
  if (persistSel) {
    try {
      const el = document.querySelector(persistSel);
      if (el && isVisible(el)) return { el, strategy: 'persistent' };
    } catch { /* bad selector */ }
  }

  const candidates = visibleInteractive();

  const cache1 = (el: Element, strategy: FindStrategy) => {
    // `label` is in INTERACTIVE (it's clickable to activate its control), so
    // strategies 1-4 can match a bare `<label>Country</label>` on its own
    // text/attributes before the nearest-interactive fallback (strategy 6)
    // ever runs. A label is never itself the useful target - resolve it to
    // its associated control (native `for`/wrapping via `.control`, or the
    // KI-08 nearby-container fallback) so e.g. "country" resolves to the
    // `<select>`, not the `<label>` text node.
    const resolved = el.tagName === 'LABEL' ? resolveLabelControl(el as HTMLLabelElement) : el;
    findCache.set(want, { el: resolved, at: Date.now() });
    return { el: resolved, strategy };
  };

  // 1. Accessible name (aria-label / aria-labelledby / alt / title).
  const byAria = candidates.find((el) => contains(accessibleName(el), want));
  if (byAria) return cache1(byAria, 'aria-label');

  // 2. Visible text content.
  const byText = bestTextMatch(candidates, want);
  if (byText) return cache1(byText, 'text');

  // 3. placeholder / title / value.
  const byAttr = candidates.find(
    (el) =>
      contains(el.getAttribute('placeholder'), want) ||
      contains(el.getAttribute('title'), want) ||
      contains((el as HTMLInputElement).value, want),
  );
  if (byAttr) return cache1(byAttr, 'attribute');

  // 4. name / id.
  const byId = candidates.find(
    (el) => contains(el.getAttribute('name'), want) || contains(el.id, want),
  );
  if (byId) return cache1(byId, 'name-id');

  // 5. submit-ish intent.
  if (/\b(submit|go|continue|search|next|send|login|sign in)\b/.test(want)) {
    const submit = candidates.find(
      (el) =>
        el.matches('[type="submit"], button[type="submit"]') ||
        (el.tagName === 'BUTTON' && !el.getAttribute('type')),
    );
    if (submit) return cache1(submit, 'submit-intent');
  }

  // 6. Nearest interactive ancestor/descendant of ANY text node match.
  const near = nearestInteractiveToText(want);
  if (near) return cache1(near, 'nearest-interactive');

  return null;
}

/* ------------------------------ helpers ----------------------------------- */

/**
 * `querySelectorAll` never descends into shadow roots - each shadow root is a
 * separate DOM tree. Modern component libraries (web components, many design
 * systems) render real interactive controls inside an OPEN shadow root, which
 * made the whole cascade blind to them. This walks the light DOM and recurses
 * into any open shadow root it finds, so strategies 1-5 see those elements
 * too. Closed shadow roots have no JS-visible boundary (`shadowRoot` is null)
 * and are unreachable by design - that's a genuine, undocumented-away
 * limitation, not something this can fix.
 */
function allElementsDeep(root: ParentNode): Element[] {
  const out: Element[] = [];
  const walk = (r: ParentNode) => {
    for (const el of r.querySelectorAll('*')) {
      out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return out;
}

function visibleInteractive(): Element[] {
  return allElementsDeep(document).filter((el) => el.matches(INTERACTIVE) && isVisible(el));
}

/** Pick the text match with the best (shortest, most exact) overlap. */
function bestTextMatch(candidates: Element[], want: string): Element | null {
  let best: Element | null = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    const text = norm(el.textContent ?? '');
    if (!text || !contains(text, want)) continue;
    // Prefer exact matches, then the tightest wrapper around the phrase.
    const score = text === want ? 0 : text.length - want.length;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Text nodes matching `want`, walked across light DOM + open shadow roots. */
function textNodesDeep(root: ParentNode, want: string): Text[] {
  const out: Text[] = [];
  const walk = (r: ParentNode) => {
    const walker = document.createTreeWalker(r as unknown as Node, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return contains(node.nodeValue, want) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    let node: Node | null;
    while ((node = walker.nextNode())) out.push(node as Text);
    // querySelectorAll('*') is scoped to `r` - it won't cross into a shadow
    // root, so this can't double-visit elements the recursive call below
    // already covers.
    for (const el of r.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return out;
}

function nearestInteractiveToText(want: string): Element | null {
  for (const node of textNodesDeep(document.body, want)) {
    const host = node.parentElement;
    if (!host) continue;
    const interactive =
      host.closest(INTERACTIVE) ?? host.querySelector(INTERACTIVE) ?? nearbyInteractive(host);
    if (interactive && isVisible(interactive)) return interactive;
  }
  return null;
}

/**
 * KI-08: React/Vue SPAs often render form labels as plain `<div>`/`<span>`
 * text siblings of the input, with no `for`/`id` or `aria-labelledby` tying
 * them together - e.g. `<div class="field"><div>Email</div><input/></div>`.
 * Walk up a few ancestor "field container" levels from the label text and
 * look for an interactive element anywhere inside that container.
 */
/** Resolve a `<label>` to its associated form control, falling back to the
 * KI-08 nearby-container search; returns the label itself if neither finds
 * one (a genuinely standalone label with no control to act on). */
function resolveLabelControl(label: HTMLLabelElement): Element {
  if (label.control && isVisible(label.control)) return label.control;
  const nearby = nearbyInteractive(label);
  if (nearby && nearby !== label && isVisible(nearby)) return nearby;
  return label;
}

function nearbyInteractive(labelHost: Element): Element | null {
  let container: Element | null = labelHost;
  for (let depth = 0; depth < 3 && container; depth++) {
    // Exclude labelHost itself: when called from resolveLabelControl, the
    // label is itself in INTERACTIVE and would otherwise match its own
    // querySelector (it's a descendant of its container) before the actual
    // control it's meant to point to.
    const interactive = Array.from(container.querySelectorAll(INTERACTIVE)).find((el) => el !== labelHost);
    if (interactive) return interactive;
    container = container.parentElement;
  }
  return null;
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return text;
  }
  const alt = el.getAttribute('alt');
  if (alt) return alt;
  const title = el.getAttribute('title');
  if (title) return title;
  return '';
}

export function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function contains(haystack: string | null | undefined, needle: string): boolean {
  return !!haystack && norm(haystack).includes(needle);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
