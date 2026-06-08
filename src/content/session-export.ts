/**
 * Session export: saves the full command history as a Markdown transcript.
 * Includes commands, actions, confidence, timestamps, and speech.
 */
import type { HistoryEntry } from '@shared/types';

export async function exportSessionTranscript(): Promise<void> {
  const raw = await chrome.storage.local.get('aria.history');
  const entries = (raw['aria.history'] as HistoryEntry[] | undefined) ?? [];

  if (entries.length === 0) {
    alert('No commands recorded yet this session.');
    return;
  }

  const lines = [
    `# ARIA Session Transcript`,
    `URL: ${location.href}`,
    `Exported: ${new Date().toISOString()}`,
    `Commands: ${entries.length}`,
    '',
    '---',
    '',
  ];

  for (const e of [...entries].reverse()) {
    const date = new Date(e.timestamp).toLocaleTimeString();
    const status = e.success ? '✓' : '✗';
    const conf = `${Math.round(e.confidence * 100)}%`;
    lines.push(`### ${date} — ${status} ${conf}`);
    lines.push(`**Command:** ${e.command}`);
    lines.push(`**Action:** ${e.action}`);
    if (e.speech) lines.push(`**Response:** ${e.speech}`);
    lines.push('');
  }

  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aria-session-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
