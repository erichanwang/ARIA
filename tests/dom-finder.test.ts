/**
 * dom-finder unit tests. Covers the semantic element matching strategies
 * using real-world DOM patterns.
 *
 * jsdom doesn't run a layout engine, so we patch getBoundingClientRect to
 * return non-zero dimensions for all elements so isVisible() passes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Patch layout methods jsdom can't compute.
Element.prototype.getBoundingClientRect = vi.fn(() => ({
  width: 100,
  height: 20,
  top: 50,
  left: 50,
  right: 150,
  bottom: 70,
  x: 50,
  y: 50,
  toJSON: () => ({}),
}));

// jsdom doesn't include CSS.escape.
if (!globalThis.CSS) globalThis.CSS = {} as unknown as typeof CSS;
if (!CSS.escape) CSS.escape = (s: string) => s.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');

// Minimal chrome API mock.
const storageData: Record<string, unknown> = {};
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        const val = storageData[key];
        return val !== undefined ? { [key]: val } : {};
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(storageData, obj);
      }),
    },
  },
} as unknown as typeof chrome;

const { findElement, teachTarget, isVisible } = await import('../src/content/dom-finder');

function setBody(markup: string): void {
  document.body.innerHTML = markup;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

/* ---------- strategy 1: aria-label ---------------------------------------- */
describe('aria-label matching', () => {
  it('finds button by exact aria-label', () => {
    setBody('<button aria-label="Search">🔍</button>');
    const el = findElement('search');
    expect(el?.getAttribute('aria-label')).toBe('Search');
  });

  it('finds input by aria-label substring', () => {
    setBody('<input type="text" aria-label="Enter your email address" />');
    expect(findElement('email address')).toBeTruthy();
  });
});

/* ---------- strategy 2: visible text --------------------------------------- */
describe('visible text matching', () => {
  it('finds button by text content', () => {
    setBody('<button>Sign in</button>');
    expect(findElement('sign in')?.tagName).toBe('BUTTON');
  });

  it('prefers tightest text match over longer wrapper', () => {
    setBody(`
      <button>Login and continue</button>
      <button>Login</button>
    `);
    const el = findElement('login');
    expect(el?.textContent?.trim()).toBe('Login');
  });

  it('finds anchor by link text', () => {
    setBody('<a href="/about">About Us</a>');
    expect(findElement('about us')?.tagName).toBe('A');
  });
});

/* ---------- strategy 3: placeholder/title/value ---------------------------- */
describe('placeholder and title matching', () => {
  it('finds input by placeholder', () => {
    setBody('<input type="search" placeholder="Search products…" />');
    expect(findElement('search products')).toBeTruthy();
  });

  it('finds button by title attribute', () => {
    setBody('<button title="Close dialog">✕</button>');
    expect(findElement('close dialog')).toBeTruthy();
  });
});

/* ---------- strategy 4: name/id ------------------------------------------- */
describe('name and id matching', () => {
  it('finds input by name attribute', () => {
    setBody('<input type="text" name="username" />');
    expect(findElement('username')).toBeTruthy();
  });

  it('finds element by id', () => {
    setBody('<button id="submit-btn">Go</button>');
    expect(findElement('submit-btn')).toBeTruthy();
  });
});

/* ---------- strategy 5: submit intent ------------------------------------- */
describe('submit intent matching', () => {
  it('finds submit button when target is "submit"', () => {
    setBody('<button type="submit">Continue to checkout</button>');
    const el = findElement('submit');
    expect(el?.getAttribute('type')).toBe('submit');
  });
});

/* ---------- strategy 6: nearest interactive to text ----------------------- */
describe('nearest interactive to text', () => {
  it('finds button wrapping non-button text span', () => {
    setBody('<button><span class="icon">+</span><span>Add item</span></button>');
    const el = findElement('add item');
    expect(el?.tagName).toBe('BUTTON');
  });
});

/* ---------- teachTarget ---------------------------------------------------- */
describe('teachTarget override', () => {
  it('returns the taught element on subsequent calls', () => {
    setBody('<button id="special-btn">Rare action</button>');
    const btn = document.querySelector('#special-btn')!;
    teachTarget('rare action', btn);
    expect(findElement('rare action')).toBe(btn);
  });
});

/* ---------- isVisible helper ---------------------------------------------- */
describe('isVisible', () => {
  it('returns false for display:none elements', () => {
    setBody('<button style="display:none">Hidden</button>');
    const btn = document.querySelector('button')!;
    expect(isVisible(btn)).toBe(false);
  });

  it('returns false for visibility:hidden elements', () => {
    setBody('<button style="visibility:hidden">Hidden</button>');
    const btn = document.querySelector('button')!;
    expect(isVisible(btn)).toBe(false);
  });
});

/* ---------- real-world patterns ------------------------------------------- */
describe('real-world page patterns', () => {
  it('finds nav link in multi-item navigation', () => {
    setBody(`
      <nav>
        <a href="/home">Home</a>
        <a href="/docs">Documentation</a>
        <a href="/pricing">Pricing</a>
      </nav>
    `);
    const el = findElement('documentation');
    expect(el).toBeTruthy();
    expect(el?.getAttribute('href')).toBe('/docs');
  });

  it('finds action button in card component', () => {
    setBody(`
      <div class="card">
        <h3>Product name</h3>
        <p>Description text</p>
        <button class="cta">Buy now</button>
      </div>
    `);
    const el = findElement('buy now');
    expect(el?.className).toBe('cta');
  });

  it('returns null when no match found', () => {
    setBody('<button>Something else entirely</button>');
    expect(findElement('nonexistent xyzzy quantum')).toBeNull();
  });

  it('finds input in a login form', () => {
    setBody(`
      <form>
        <input type="email" placeholder="Email address" />
        <input type="password" placeholder="Password" />
        <button type="submit">Log in</button>
      </form>
    `);
    expect(findElement('email address')).toBeTruthy();
    expect(findElement('log in')?.tagName).toBe('BUTTON');
  });

  // KI-08: React/Vue SPAs frequently render labels as plain divs/spans that
  // aren't wired to the input via `for`/`id` or `aria-labelledby` - only DOM
  // proximity ties them together.
  it('finds input next to a synthetic (non-<label>) div label', () => {
    setBody(`
      <div class="field">
        <div class="field-label">Email</div>
        <input type="text" />
      </div>
    `);
    const el = findElement('email');
    expect(el?.tagName).toBe('INPUT');
  });

  // Root-cause regression test: `label` is in the INTERACTIVE selector list,
  // so a bare `<label>Country</label>` with no `for`/`id` wiring matches
  // strategy 2 (visible text) on its own text before the nearest-interactive
  // fallback (strategy 6) ever runs - resolving to the label itself instead
  // of the control it labels.
  it('resolves a bare <label> with no for/id to its sibling control', () => {
    setBody(`
      <div class="field">
        <label>Country</label>
        <select><option>USA</option></select>
      </div>
    `);
    const el = findElement('country');
    expect(el?.tagName).toBe('SELECT');
  });

  it('resolves a <label for> to the referenced control', () => {
    setBody(`
      <label for="country-select">Country</label>
      <select id="country-select"><option>USA</option></select>
    `);
    const el = findElement('country');
    expect(el?.tagName).toBe('SELECT');
  });

  it('resolves a <label> wrapping its control', () => {
    setBody(`
      <label>Country<select><option>USA</option></select></label>
    `);
    const el = findElement('country');
    expect(el?.tagName).toBe('SELECT');
  });

  it('finds input inside a nested React-style field wrapper', () => {
    setBody(`
      <div class="form-group">
        <div class="form-group__header"><span>Phone number</span></div>
        <div class="form-group__control"><input type="tel" /></div>
      </div>
    `);
    const el = findElement('phone number');
    expect(el?.tagName).toBe('INPUT');
  });
});

/* ---------- shadow DOM ------------------------------------------------- */
describe('shadow DOM', () => {
  it('finds a button rendered inside an open shadow root', () => {
    setBody('<div id="host"></div>');
    const host = document.querySelector('#host')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button aria-label="Submit order">✓</button>';
    const el = findElement('submit order');
    expect(el?.tagName).toBe('BUTTON');
  });

  it('finds text-matched control nested two shadow roots deep', () => {
    setBody('<div id="outer-host"></div>');
    const outerHost = document.querySelector('#outer-host')!;
    const outerRoot = outerHost.attachShadow({ mode: 'open' });
    outerRoot.innerHTML = '<div id="inner-host"></div>';
    const innerHost = outerRoot.querySelector('#inner-host')!;
    const innerRoot = innerHost.attachShadow({ mode: 'open' });
    innerRoot.innerHTML = '<button>Confirm payment</button>';
    const el = findElement('confirm payment');
    expect(el?.tagName).toBe('BUTTON');
  });

  it('cannot see into a closed shadow root (documented limitation)', () => {
    setBody('<div id="host"></div>');
    const host = document.querySelector('#host')!;
    host.attachShadow({ mode: 'closed' }).innerHTML = '<button>Hidden action</button>';
    expect(findElement('hidden action')).toBeNull();
  });
});
