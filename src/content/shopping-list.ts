/**
 * Shopping List Builder
 * "add this to my list" → extracts product name + price + URL from current hover position.
 * "read my list" → reads it aloud.
 * "clear my list" → wipes it.
 * "export my list" → downloads as CSV.
 */

const STORAGE_KEY = 'aria.shoppingList';

export interface ShoppingItem {
  name: string;
  price: string;
  url: string;
  addedAt: number;
}

export async function loadShoppingList(): Promise<ShoppingItem[]> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return (raw[STORAGE_KEY] as ShoppingItem[] | undefined) ?? [];
}

async function saveShoppingList(items: ShoppingItem[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

export async function addCurrentProductToList(cursorX: number, cursorY: number): Promise<string> {
  const item = extractProductFromPage(cursorX, cursorY);
  const list = await loadShoppingList();

  if (list.some((i) => i.url === item.url && i.name === item.name)) {
    return `${item.name} is already on your list.`;
  }

  list.push(item);
  await saveShoppingList(list);
  return `Added ${item.name}${item.price ? ` (${item.price})` : ''} to your shopping list. You now have ${list.length} item${list.length === 1 ? '' : 's'}.`;
}

export async function readShoppingList(): Promise<string> {
  const list = await loadShoppingList();
  if (list.length === 0) return "Your shopping list is empty.";
  const lines = list.map((item, i) => `${i + 1}. ${item.name}${item.price ? `, ${item.price}` : ''}`);
  return `You have ${list.length} item${list.length === 1 ? '' : 's'} on your list: ${lines.join('; ')}.`;
}

export async function clearShoppingList(): Promise<string> {
  await saveShoppingList([]);
  return "Shopping list cleared.";
}

export async function exportShoppingList(): Promise<string> {
  const list = await loadShoppingList();
  if (list.length === 0) return "Your shopping list is empty — nothing to export.";

  const csv = ['Name,Price,URL,Added']
    .concat(list.map((i) => `"${i.name}","${i.price}","${i.url}","${new Date(i.addedAt).toLocaleDateString()}"` ))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aria-shopping-list.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return `Exported ${list.length} item${list.length === 1 ? '' : 's'} as CSV.`;
}

function extractProductFromPage(cursorX: number, cursorY: number): ShoppingItem {
  // Try to find product name near the cursor.
  const elAtCursor = document.elementFromPoint(cursorX, cursorY);
  let name = '';
  let price = '';

  // Look for product title.
  const titleSelectors = [
    '[itemprop="name"]', '[class*="product-title"]', '[class*="product-name"]',
    'h1', '[class*="title"]',
  ];
  for (const sel of titleSelectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) { name = el.textContent.trim().slice(0, 120); break; }
  }

  // Look for price.
  const priceSelectors = [
    '[itemprop="price"]', '[class*="price"]', '.amount', '[data-price]',
  ];
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) { price = el.textContent.trim().slice(0, 20); break; }
  }

  // Fallback: use the element text near cursor.
  if (!name && elAtCursor) {
    name = (elAtCursor.textContent ?? '').trim().slice(0, 120);
  }

  if (!name) name = document.title.slice(0, 120);

  return { name, price, url: location.href, addedAt: Date.now() };
}
