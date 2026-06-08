export type ExplicitDesktopIntent =
  | 'navigate'
  | 'read_aloud'
  | 'copy_to_clipboard'
  | 'focus_timer'
  | 'shopping_list';

export function stripAriaWakeWord(command: string): { command: string; detected: boolean } {
  const match = command.match(/^\s*(?:(?:hey|hi|ok|okay)[\s,]+)?(?:aria|arya|area|ariah)\b[\s,.:;!?-]*/i);
  if (!match) return { command: command.trim(), detected: false };
  return { command: command.slice(match[0].length).trim(), detected: true };
}

export function routeExplicitDesktopIntent(command: string): ExplicitDesktopIntent | null {
  const text = command.trim().toLowerCase();
  if (!text) return null;

  if (/\b(shopping list|grocery list)\b/.test(text)) return 'shopping_list';
  if (/\b(timer|pomodoro)\b/.test(text) || /^focus (?:for )?\d/.test(text)) return 'focus_timer';
  if (/^(?:please )?copy(?:\s|$)/.test(text)) return 'copy_to_clipboard';
  if (/^(?:please )?read\b/.test(text) && /\b(aloud|out loud|clipboard|this|that|selection|text)\b/.test(text)) {
    return 'read_aloud';
  }
  if (/^(?:please )?(?:open|go to|navigate to|search for|look up)\s+/.test(text)
      && !/\b(?:new|current|next|previous) tab\b/.test(text)) {
    return 'navigate';
  }
  return null;
}
