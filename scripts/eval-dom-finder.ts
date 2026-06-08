/**
 * DOM-finder benchmark: measures findElement()'s hit rate and per-strategy
 * fallback distribution across a fixture set of representative page
 * structures (login forms, nav bars, card CTAs, icon-only buttons, and the
 * synthetic-label SPA patterns from KI-08), plus a harder tier: open and
 * nested shadow DOM (web components), ARIA-only controls (compound
 * aria-labelledby, custom role widgets), and cases that are genuinely
 * unsolvable for any DOM-based finder - canvas-rendered UI, an unmounted
 * virtualized-list row, and a closed shadow root - which are expected to
 * MISS and are scored separately from real element matches (see the
 * "resolved to the correct element" vs "correctly declined" breakdown below).
 *
 * This does NOT reach real websites (no network access here) - it is a
 * fixture-based regression benchmark, which is what milestone 7's "live
 * multi-site testing still pending" note is asking to be backed by
 * something more than individual unit tests. Live multi-site numbers
 * still require running the extension against real pages in a real browser
 * (see README for that reproduction note).
 *
 * Usage: npm run eval:dom-finder
 */
import { JSDOM } from 'jsdom';
import { findElementWithTrace } from '../src/content/dom-finder';

interface Fixture {
  name: string;
  html: string;
  target: string;
  expectSelector: string; // CSS selector identifying the correct element
  // Runs after the fixture's HTML is parsed, before findElementWithTrace() is
  // called - used to attach shadow roots programmatically. jsdom doesn't
  // execute inline <script> tags by default, so shadow DOM fixtures can't be
  // expressed as plain HTML strings; this is the only way to build one.
  setup?: (doc: Document) => void;
}

const FIXTURES: Fixture[] = [
  { name: 'icon button via aria-label', html: '<button aria-label="Search">🔍</button>', target: 'search', expectSelector: 'button' },
  { name: 'plain text button', html: '<button>Sign in</button>', target: 'sign in', expectSelector: 'button' },
  { name: 'nav link among siblings', html: '<nav><a href="/home">Home</a><a href="/docs">Documentation</a><a href="/pricing">Pricing</a></nav>', target: 'documentation', expectSelector: 'a[href="/docs"]' },
  { name: 'search input via placeholder', html: '<input type="search" placeholder="Search products…" />', target: 'search products', expectSelector: 'input' },
  { name: 'input via name attribute', html: '<input type="text" name="username" />', target: 'username', expectSelector: 'input' },
  { name: 'submit-intent fallback', html: '<button type="submit">Continue to checkout</button>', target: 'submit', expectSelector: 'button[type="submit"]' },
  { name: 'icon + text wrapped in button', html: '<button><span class="icon">+</span><span>Add item</span></button>', target: 'add item', expectSelector: 'button' },
  { name: 'card CTA button', html: '<div class="card"><h3>Product name</h3><p>Description text</p><button class="cta">Buy now</button></div>', target: 'buy now', expectSelector: '.cta' },
  { name: 'login form email field', html: '<form><input type="email" placeholder="Email address" /><input type="password" placeholder="Password" /><button type="submit">Log in</button></form>', target: 'email address', expectSelector: 'input[type="email"]' },
  { name: 'React-style synthetic label (div, no for/id)', html: '<div class="field"><div class="field-label">Email</div><input type="text" /></div>', target: 'email', expectSelector: 'input' },
  { name: 'nested SPA field wrapper', html: '<div class="form-group"><div class="form-group__header"><span>Phone number</span></div><div class="form-group__control"><input type="tel" /></div></div>', target: 'phone number', expectSelector: 'input[type="tel"]' },
  { name: 'button id match, no visible text overlap', html: '<button id="submit-btn">Go</button>', target: 'submit-btn', expectSelector: '#submit-btn' },
  { name: 'title attribute on icon button', html: '<button title="Close dialog">✕</button>', target: 'close dialog', expectSelector: 'button' },
  { name: 'ambiguous text: tightest wrapper wins', html: '<button>Login and continue</button><button>Login</button>', target: 'login', expectSelector: 'button:nth-of-type(2)' },
  { name: 'deeply nested dashboard tile CTA', html: '<div class="dashboard"><div class="tile"><div class="tile-header"><span>Usage</span></div><div class="tile-body"><p>82% of quota used</p><div class="tile-actions"><button class="upgrade">Upgrade plan</button></div></div></div></div>', target: 'upgrade plan', expectSelector: '.upgrade' },
  { name: 'table row action button', html: '<table><tr><td>Invoice #204</td><td><button aria-label="Download invoice 204">⬇</button></td></tr></table>', target: 'download invoice 204', expectSelector: 'button' },
  { name: 'no match (target not present)', html: '<button>Something else entirely</button>', target: 'nonexistent xyzzy quantum', expectSelector: '' },
  { name: 'modal dismiss via role=button', html: '<div role="button" aria-label="Dismiss">×</div>', target: 'dismiss', expectSelector: '[role="button"]' },
  { name: 'select element via label text nearby', html: '<div class="field"><label>Country</label><select><option>USA</option></select></div>', target: 'country', expectSelector: 'select' },
  { name: 'link with icon-only child, text on wrapper', html: '<a href="/settings"><svg></svg>Settings</a>', target: 'settings', expectSelector: 'a' },

  // ── Harder fixtures: shadow DOM, ARIA-only controls, and structural cases
  // no DOM-based finder can ever solve. These are meant to lower the hit
  // rate honestly, not to be tuned until they pass.
  {
    name: 'button inside open shadow root (web component)',
    html: '<div id="ws-host"></div>',
    target: 'add to cart',
    expectSelector: 'button',
    setup: (doc) => {
      const host = doc.getElementById('ws-host')!;
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<button aria-label="Add to cart">+</button>';
    },
  },
  {
    name: 'control two shadow roots deep (nested web components)',
    html: '<div id="outer-host"></div>',
    target: 'confirm payment',
    expectSelector: 'button',
    setup: (doc) => {
      const outer = doc.getElementById('outer-host')!;
      const outerRoot = outer.attachShadow({ mode: 'open' });
      outerRoot.innerHTML = '<div id="inner-host"></div>';
      const inner = outerRoot.getElementById('inner-host')!;
      const innerRoot = inner.attachShadow({ mode: 'open' });
      innerRoot.innerHTML = '<button>Confirm payment</button>';
    },
  },
  {
    name: 'closed shadow root (documented limitation, expect MISS)',
    html: '<div id="closed-host"></div>',
    target: 'delete account',
    expectSelector: '', // no reachable element - a real MISS is the correct/honest result
    setup: (doc) => {
      doc.getElementById('closed-host')!.attachShadow({ mode: 'closed' }).innerHTML = '<button>Delete account</button>';
    },
  },
  {
    name: 'compound aria-labelledby referencing two ids',
    html: '<span id="lbl-a">Ship to</span> <span id="lbl-b">New York</span><button aria-labelledby="lbl-a lbl-b">→</button>',
    target: 'ship to new york',
    expectSelector: 'button',
  },
  {
    name: 'custom ARIA switch control (role=switch, no native input)',
    html: '<div role="button" aria-label="Enable dark mode" tabindex="0">◐</div>',
    target: 'enable dark mode',
    expectSelector: '[role="button"]',
  },
  {
    name: 'canvas-rendered UI (no DOM node exists, expect MISS)',
    html: '<canvas id="game" width="300" height="150"></canvas>',
    target: 'start game button',
    expectSelector: '', // genuinely unsolvable for a DOM-based finder - the "button" is pixels
  },
  {
    name: 'virtualized list item not yet mounted (expect MISS)',
    html: '<div class="list-viewport"><div class="row" data-index="0">Item 1</div><div class="row" data-index="1">Item 2</div><div class="row" data-index="2">Item 3</div></div>',
    target: 'item 87',
    expectSelector: '', // react-window/react-virtualized only mount visible rows - item 87 isn't in the DOM at all
  },
  {
    name: 'label text lives in a separate aria-describedby element, not aria-label',
    html: '<div class="tile"><div class="tile-actions"><button aria-describedby="hint-1">⇪</button></div><p id="hint-1" style="display:none">Export report as PDF</p></div>',
    target: 'export report as pdf',
    expectSelector: 'button', // the one button on the page is the objectively correct target
  },
];

// Patch layout methods jsdom can't compute - same technique as tests/dom-finder.test.ts.
function makeDom(html: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = () => ({
    width: 100, height: 20, top: 50, left: 50, right: 150, bottom: 70, x: 50, y: 50, toJSON: () => ({}),
  });
  if (!window.CSS) (window as unknown as { CSS: unknown }).CSS = {};
  if (!window.CSS.escape) window.CSS.escape = (s: string) => s.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
  return dom;
}

/** Same shadow-piercing lookup dom-finder.ts uses internally, needed here to
 * resolve the expected element for shadow-DOM fixtures (querySelector alone
 * can't see into a shadow root either). */
function deepQuerySelector(root: ParentNode, selector: string): Element | null {
  const found = root.querySelector(selector);
  if (found) return found;
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const inner = deepQuerySelector(el.shadowRoot as unknown as ParentNode, selector);
      if (inner) return inner;
    }
  }
  return null;
}

function runFixture(fixture: Fixture): { hit: boolean; strategy: string | null } {
  const dom = makeDom(fixture.html);
  fixture.setup?.(dom.window.document as unknown as Document);
  // dom-finder.ts is written for a browser content-script context and refers
  // to several DOM globals directly (document, CSS, location, NodeFilter,
  // getComputedStyle) - mirror them from jsdom's window, same as vitest's
  // jsdom environment does automatically for the test suite.
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.CSS = dom.window.CSS;
  g.location = dom.window.location;
  g.NodeFilter = dom.window.NodeFilter;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  g.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };

  // Every fixture uses a distinct target string, so dom-finder's module-level
  // session cache/learned maps can't leak a match from one fixture's DOM into
  // another's - each lookup misses the cache and re-scans the current document.
  const result = findElementWithTrace(fixture.target);
  if (!result) return { hit: fixture.expectSelector === '', strategy: null };
  const expected = fixture.expectSelector
    ? deepQuerySelector(dom.window.document as unknown as ParentNode, fixture.expectSelector)
    : null;
  const hit = fixture.expectSelector !== '' && result.el === expected;
  return { hit, strategy: result.strategy };
}

const results: Array<{ fixture: Fixture; hit: boolean; strategy: string | null }> = [];
for (const fixture of FIXTURES) {
  const { hit, strategy } = runFixture(fixture);
  results.push({ fixture, hit, strategy });
}

const hits = results.filter((r) => r.hit).length;
// "Hit" folds together two different things: fixtures where the correct
// answer is a real element (was it found?) and fixtures where the correct
// answer is "no element exists" (did it correctly decline instead of
// guessing wrong?). Reporting only the combined number would make a
// benchmark that includes structurally-unsolvable cases (canvas, virtualized
// lists, closed shadow roots) look better than it is - break it out.
const matchFixtures = results.filter((r) => r.fixture.expectSelector !== '');
const noMatchFixtures = results.filter((r) => r.fixture.expectSelector === '');
const matchHits = matchFixtures.filter((r) => r.hit).length;
const noMatchHits = noMatchFixtures.filter((r) => r.hit).length;

console.log('\n=== DOM-finder benchmark (fixture set, not live websites) ===');
console.log(`Fixtures: ${results.length}`);
console.log(`Overall: ${hits}/${results.length} = ${((hits / results.length) * 100).toFixed(1)}%`);
console.log(
  `  - resolved to the correct element: ${matchHits}/${matchFixtures.length} = ` +
  `${((matchHits / matchFixtures.length) * 100).toFixed(1)}%`,
);
console.log(
  `  - correctly declined an unsolvable case (canvas UI, unmounted virtualized row, closed shadow root, ` +
  `deliberate no-match): ${noMatchHits}/${noMatchFixtures.length}\n`,
);

console.log('Per-fixture detail:');
for (const { fixture, hit, strategy } of results) {
  console.log(`  [${hit ? 'OK  ' : 'MISS'}] (${(strategy ?? 'none').padEnd(19)}) ${fixture.name}`);
}

const strategyCounts = new Map<string, number>();
for (const { strategy } of results.filter((r) => r.hit)) {
  const key = strategy ?? 'none';
  strategyCounts.set(key, (strategyCounts.get(key) ?? 0) + 1);
}
console.log('\nFallback distribution (strategy that resolved each successful match):');
for (const [strategy, count] of [...strategyCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${strategy.padEnd(19)} ${count}/${hits}`);
}

const misses = results.filter((r) => !r.hit && r.fixture.expectSelector !== '');
if (misses.length > 0) {
  console.log('\nMisses (excluding the intentional no-match fixture):');
  for (const m of misses) console.log(`  - ${m.fixture.name}: target="${m.fixture.target}"`);
}

console.log(
  `\nCaveat: this is a fixture benchmark (${results.length} hand-built DOM snippets covering the ` +
  'patterns named in the README and KNOWN_ISSUES, plus shadow DOM, canvas UI, virtualized lists, ' +
  'and ARIA-only controls), not a live crawl of real websites. It is a floor, not a ceiling — ' +
  'real pages have more noise (ads, overlays, duplicate labels) that these fixtures do not model. ' +
  'Live multi-site testing remains the open item in KI (milestone 7).',
);
