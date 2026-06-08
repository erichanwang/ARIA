/**
 * Price Watcher
 * Reads the price from the DOM, stores it with the URL.
 * On next visit, compares and announces the change.
 */

const STORAGE_KEY = 'aria.priceWatches';

export interface PriceWatch {
  url: string;
  price: number;
  currency: string;
  label: string;
  timestamp: number;
}

const PRICE_PATTERNS = [
  /\$\s*([\d,]+\.?\d*)/,
  /£\s*([\d,]+\.?\d*)/,
  /€\s*([\d,]+\.?\d*)/,
  /([\d,]+\.?\d*)\s*USD/i,
  /([\d,]+\.?\d*)\s*EUR/i,
  /([\d,]+\.?\d*)\s*GBP/i,
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD', '£': 'GBP', '€': 'EUR',
};

export function extractPagePrice(): { price: number; currency: string; raw: string } | null {
  const candidates: Array<{ el: Element; score: number }> = [];

  // Prefer elements with price-related class/id/itemprop.
  const priceSelectors = [
    '[itemprop="price"]', '[class*="price"]', '[id*="price"]',
    '[class*="Price"]', '[id*="Price"]',
    '[data-price]', '.amount', '.woocommerce-Price-amount',
  ];
  for (const sel of priceSelectors) {
    document.querySelectorAll(sel).forEach((el) => candidates.push({ el, score: 10 }));
  }

  // Also scan visible text nodes.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (PRICE_PATTERNS.some((p) => p.test(node.nodeValue ?? ''))) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_REJECT;
    },
  });
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.parentElement) candidates.push({ el: node.parentElement, score: 1 });
  }

  for (const { el } of candidates.sort((a, b) => b.score - a.score)) {
    const text = el.textContent ?? '';
    for (const pat of PRICE_PATTERNS) {
      const m = pat.exec(text);
      if (m) {
        const raw = m[0].trim();
        const numStr = m[1].replace(/,/g, '');
        const price = parseFloat(numStr);
        if (isNaN(price) || price <= 0) continue;
        const sym = /^[$£€]/.exec(raw)?.[0] ?? '';
        const currency = CURRENCY_SYMBOLS[sym] ?? 'USD';
        return { price, currency, raw };
      }
    }
  }
  return null;
}

export async function watchCurrentPrice(): Promise<string> {
  const found = extractPagePrice();
  if (!found) return "I couldn't find a price on this page.";

  const watches = await loadWatches();
  const url = location.href;
  const existing = watches.find((w) => w.url === url);

  const entry: PriceWatch = {
    url,
    price: found.price,
    currency: found.currency,
    label: document.title.slice(0, 80),
    timestamp: Date.now(),
  };

  if (existing) {
    const diff = found.price - existing.price;
    const change = diff > 0
      ? `up ${formatPrice(Math.abs(diff), found.currency)} since you last checked`
      : diff < 0
        ? `down ${formatPrice(Math.abs(diff), found.currency)} since you last checked`
        : 'unchanged since you last checked';
    const idx = watches.indexOf(existing);
    watches[idx] = entry;
    await saveWatches(watches);
    return `Price is ${found.raw} — ${change}. I'm now tracking it.`;
  }

  watches.push(entry);
  await saveWatches(watches);
  return `Got it — I'm watching the price: ${found.raw}. I'll let you know if it changes next time you visit.`;
}

export async function checkPriceOnLoad(speech: (msg: string) => void): Promise<void> {
  const url = location.href;
  const watches = await loadWatches();
  const existing = watches.find((w) => w.url === url);
  if (!existing) return;

  const found = extractPagePrice();
  if (!found) return;

  const diff = found.price - existing.price;
  if (Math.abs(diff) < 0.01) return; // no meaningful change

  const change = diff < 0
    ? `The price dropped ${formatPrice(Math.abs(diff), found.currency)} since you last checked — now ${found.raw}.`
    : `The price went up ${formatPrice(Math.abs(diff), found.currency)} since you last checked — now ${found.raw}.`;

  const idx = watches.indexOf(existing);
  watches[idx] = { ...existing, price: found.price, timestamp: Date.now() };
  await saveWatches(watches);
  speech(change);
}

function formatPrice(amount: number, currency: string): string {
  const sym: Record<string, string> = { USD: '$', GBP: '£', EUR: '€' };
  return `${sym[currency] ?? ''}${amount.toFixed(2)}`;
}

async function loadWatches(): Promise<PriceWatch[]> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return (raw[STORAGE_KEY] as PriceWatch[] | undefined) ?? [];
}

async function saveWatches(watches: PriceWatch[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: watches });
}
