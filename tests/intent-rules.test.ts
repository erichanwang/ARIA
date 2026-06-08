import { describe, expect, it } from 'vitest';
import { routeExplicitDesktopIntent, stripAriaWakeWord } from '../src/shared/intent-rules';

describe('ARIA wake word', () => {
  it.each([
    ['ARIA', ''],
    ['ARIA, open GitHub', 'open GitHub'],
    ['Hey ARIA please set a timer', 'please set a timer'],
    ['Hey, Aria', ''],
    ['Area open GitHub', 'open GitHub'],
    ['Hi Arya', ''],
  ])('strips a leading wake word from %s', (spoken, expected) => {
    expect(stripAriaWakeWord(spoken)).toEqual({ command: expected, detected: true });
  });

  it('does not strip ARIA when it is not the wake-word prefix', () => {
    expect(stripAriaWakeWord('what is ARIA')).toEqual({ command: 'what is ARIA', detected: false });
  });

  it('routes a command after the wake word is removed', () => {
    const wake = stripAriaWakeWord('ARIA, open GitHub');
    expect(routeExplicitDesktopIntent(wake.command)).toBe('navigate');
  });
});

describe('explicit desktop intent routing', () => {
  it.each([
    ['open github', 'navigate'],
    ['please search for weather tomorrow', 'navigate'],
    ['copy this text', 'copy_to_clipboard'],
    ['read the clipboard aloud', 'read_aloud'],
    ['set a timer for 10 minutes', 'focus_timer'],
    ['focus for 25 minutes', 'focus_timer'],
    ['add milk to my shopping list', 'shopping_list'],
  ])('routes %s', (command, expected) => {
    expect(routeExplicitDesktopIntent(command)).toBe(expected);
  });

  it.each([
    'open a new tab',
    'thank you',
    'what did I say',
    'copycat',
    '',
  ])('leaves %s for the neural classifier', (command) => {
    expect(routeExplicitDesktopIntent(command)).toBeNull();
  });
});
