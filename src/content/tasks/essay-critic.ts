/**
 * Essay Reader + Critic
 * Reads the current page and sends to Claude with a critique prompt.
 * Speaks structured feedback: intro strength, body evidence, conclusion.
 */
import { extractMainText } from '../page-context';
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import { requestClaude } from '../../background/claude';
import { loadSettings } from '@shared/settings';

export async function runEssayCritic(speech: Speech, hud: Hud): Promise<void> {
  const text = extractMainText().slice(0, 4000);
  if (text.length < 200) {
    await speech.speak("This page doesn't seem to have enough text to critique. Try navigating to an essay or article.");
    return;
  }

  await speech.speak("Reading the essay — I'll have feedback in a moment.");
  hud.setCommand('Analyzing essay…');

  const settings = await loadSettings();

  const systemPrompt = `You are an essay critic. Analyze the given text and provide structured feedback in 3 parts:
1. Introduction: Is it engaging? Does it state a clear thesis?
2. Body: Is the argument well-supported? What's missing?
3. Conclusion: Is it strong and does it circle back to the thesis?
Keep each part to 1-2 sentences. Be specific and actionable. Respond in plain text, no JSON.`;

  const result = await requestClaude(settings.apiKey, systemPrompt, `Critique this text:\n\n${text}`);

  if (!result.ok || !result.text) {
    await speech.speak("I had trouble analyzing the essay. Please try again.");
    return;
  }

  const feedback = result.text.trim();
  hud.setCommand('Essay critique ready');

  // Show as a card on the page.
  showCritiqueCard(feedback);

  // Speak the feedback.
  const sentences = feedback.match(/[^.!?]+[.!?]+|\S+$/g) ?? [feedback];
  await speech.speak("Here's my critique:");
  for (const s of sentences.slice(0, 15)) {
    if (s.trim()) await speech.speak(s.trim());
  }
}

function showCritiqueCard(text: string): void {
  const existing = document.getElementById('aria-essay-critique');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.id = 'aria-essay-critique';
  card.style.cssText = [
    'position:fixed', 'top:20px', 'right:20px',
    'max-width:360px', 'max-height:60vh',
    'background:rgba(14,14,22,0.97)',
    'border:1px solid rgba(255,213,79,0.3)',
    'border-radius:12px', 'padding:16px',
    'color:#f3f3f7',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:13px', 'line-height:1.5',
    'box-shadow:0 12px 40px rgba(0,0,0,0.6)',
    'backdrop-filter:blur(8px)',
    'z-index:2147483645',
    'overflow-y:auto',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#ffd580;margin-bottom:10px;display:flex;justify-content:space-between';
  const title = document.createElement('span');
  title.textContent = 'Essay Critique';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.style.cssText = 'background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:14px';
  close.addEventListener('click', () => card.remove());
  header.append(title, close);

  const body = document.createElement('div');
  body.style.cssText = 'white-space:pre-wrap';
  body.textContent = text;

  card.append(header, body);
  document.documentElement.appendChild(card);
  setTimeout(() => card.remove(), 60000);
}
