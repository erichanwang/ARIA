/**
 * Page Diff Mode
 * Stores a text snapshot of the page on first visit.
 * On return, diffs it and reads the changes aloud.
 */

const STORAGE_PREFIX = 'aria.pageSnapshot.';

function snapshotKey(url: string): string {
  return STORAGE_PREFIX + btoa(url).slice(0, 80);
}

function getPageText(): string {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!(node.nodeValue ?? '').trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const parts: string[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    parts.push((node.nodeValue ?? '').trim());
  }
  return parts.join('\n');
}

export async function savePageSnapshot(): Promise<void> {
  const key = snapshotKey(location.href);
  const text = getPageText().slice(0, 10000);
  await chrome.storage.local.set({ [key]: { text, timestamp: Date.now() } });
}

export async function diffPageSnapshot(): Promise<string | null> {
  const key = snapshotKey(location.href);
  const raw = await chrome.storage.local.get(key);
  const stored = raw[key] as { text: string; timestamp: number } | undefined;
  if (!stored) {
    await savePageSnapshot();
    return null; // first visit — nothing to diff
  }

  const current = getPageText();
  const oldLines = new Set(stored.text.split('\n').filter((l) => l.trim().length > 10));
  const newLines = current.split('\n').filter((l) => l.trim().length > 10);
  const added = newLines.filter((l) => !oldLines.has(l));

  await savePageSnapshot();

  if (added.length === 0) return "The page content looks the same as your last visit.";
  if (added.length === 1) return `One new item was added: ${added[0].slice(0, 120)}`;
  if (added.length <= 3) {
    return `${added.length} new items appeared: ${added.map((l) => l.slice(0, 80)).join('; ')}`;
  }
  return `${added.length} new items were added to this page since your last visit.`;
}
