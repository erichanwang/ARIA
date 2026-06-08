/**
 * Page summarizer task. Extracts main content, sends to Claude (via the
 * background RUN_TASK route), shows a floating summary card, and reads
 * the summary aloud with a "tell me more" follow-up hint.
 */
import { extractMainText } from '../page-context';
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import { requestRuntime } from '@shared/messages';
import type { SummarizeResult } from '@shared/tasks';

export async function runSummarizer(speech: Speech, hud: Hud): Promise<void> {
  hud.setCommand('Summarizing page…');
  const text = extractMainText().slice(0, 6000);
  if (!text) {
    await speech.speak("I couldn't find readable content on this page.");
    return;
  }

  const res = await requestRuntime({
    type: 'RUN_TASK',
    target: 'background',
    request: { kind: 'summarize', text, url: location.href },
  });

  if (!res?.ok || !res.result) {
    await speech.speak('Summary failed. ' + (res?.error ?? ''));
    return;
  }

  const result = res.result as SummarizeResult;
  showSummaryCard(result);
  await speech.speak(result.speech);

  hud.setCommand('Say "tell me more" for details.');
}

function showSummaryCard(result: SummarizeResult): void {
  const existing = document.getElementById('aria-page-summary');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.id = 'aria-page-summary';
  card.style.cssText = [
    'position:fixed', 'top:20px', 'right:20px', 'width:360px', 'max-height:80vh',
    'overflow-y:auto', 'z-index:2147483646',
    'background:rgba(14,14,20,0.97)', 'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:14px', 'padding:18px 20px', 'color:#f3f3f7',
    'font-family:ui-sans-serif,system-ui,sans-serif', 'font-size:13px', 'line-height:1.6',
    'box-shadow:0 12px 48px rgba(0,0,0,0.6)', 'backdrop-filter:blur(10px)',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
  const title = document.createElement('span');
  title.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:#9aa0aa;font-weight:700';
  title.textContent = 'Page Summary';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:14px;padding:0';
  closeBtn.addEventListener('click', () => card.remove());
  header.append(title, closeBtn);

  const summaryP = document.createElement('p');
  summaryP.style.cssText = 'margin:0 0 12px;color:#f3f3f7;font-weight:500';
  summaryP.textContent = result.summary;

  const bulletList = document.createElement('ul');
  bulletList.style.cssText = 'margin:0;padding-left:18px;color:#c0c8d4;display:flex;flex-direction:column;gap:5px';
  for (const b of result.bullets) {
    const li = document.createElement('li');
    li.textContent = b;
    bulletList.appendChild(li);
  }

  card.append(header, summaryP, bulletList);
  document.documentElement.appendChild(card);
}
