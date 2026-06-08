/**
 * MCQ quiz assistant. Scans the page for a multiple-choice question and its
 * options (radio groups first, then ARIA radio/listbox roles, then labelled
 * checkboxes), asks Claude which option is correct, animates the cursor to it
 * and clicks.
 */
import type { AgentCursor } from '../cursor';
import type { Hud } from '../hud';
import type { Speech } from '../speech';
import { clickElement } from '../synthetic-click';
import { isVisible } from '../dom-finder';
import { requestRuntime } from '@shared/messages';
import type { McqResult } from '@shared/tasks';

interface ScannedMcq {
  question: string;
  options: Array<{ el: Element; text: string }>;
}

export async function runMcq(cursor: AgentCursor, hud: Hud, speech: Speech): Promise<void> {
  const scan = scanMcq();
  if (!scan || scan.options.length < 2) {
    await speech.speak("I couldn't find a multiple-choice question on this page.");
    return;
  }

  hud.setCommand(`Solving: ${scan.question.slice(0, 60)}…`);
  cursor.setState('thinking');

  const res = await requestRuntime({
    type: 'RUN_TASK',
    target: 'background',
    request: { kind: 'mcq', question: scan.question, options: scan.options.map((o) => o.text) },
  });

  cursor.setState('idle');
  if (!res?.ok || !res.result) {
    await speech.speak('I had trouble solving that question.');
    return;
  }

  const result = res.result as McqResult;
  const choice = scan.options[result.answerIndex];
  if (!choice) {
    await speech.speak('I picked an answer but could not locate it on the page.');
    return;
  }

  choice.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await cursor.moveToElement(choice.el);
  cursor.setState('acting');
  clickElement(choice.el);
  await speech.speak(result.speech);
  cursor.setState('idle');
}

/** Best-effort DOM scan for a question + answer options. */
function scanMcq(): ScannedMcq | null {
  // 1. Native radio groups (most quiz pages).
  const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(isVisible);
  if (radios.length >= 2) {
    const options = radios.map((r) => ({ el: r as Element, text: labelFor(r) }));
    return { question: findQuestion(radios[0]), options };
  }

  // 2. ARIA radios / listbox options.
  const ariaOpts = Array.from(
    document.querySelectorAll('[role="radio"], [role="option"]'),
  ).filter(isVisible);
  if (ariaOpts.length >= 2) {
    return {
      question: findQuestion(ariaOpts[0]),
      options: ariaOpts.map((el) => ({ el, text: (el.textContent ?? '').trim() })),
    };
  }

  return null;
}

/** Resolve the visible label text for a radio/checkbox input. */
function labelFor(input: HTMLInputElement): string {
  if (input.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (lbl?.textContent?.trim()) return lbl.textContent.trim();
  }
  const wrap = input.closest('label');
  if (wrap?.textContent?.trim()) return wrap.textContent.trim();
  const aria = input.getAttribute('aria-label');
  if (aria) return aria;
  return (input.value || '').trim();
}

/** Walk up to find the nearest legend/heading/question-like text. */
function findQuestion(near: Element): string {
  const group = near.closest('fieldset, form, [role="radiogroup"], section, div');
  const legend = group?.querySelector('legend, h1, h2, h3, h4, [role="heading"]');
  if (legend?.textContent?.trim()) return legend.textContent.trim();
  // Fall back to the document title or a question mark line nearby.
  return document.title || 'Multiple choice question';
}
