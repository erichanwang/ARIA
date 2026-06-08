/**
 * Daily Briefing Mode
 * Visits configured URLs in sequence, extracts headlines/key info,
 * reads a brief summary. Target: under 2 minutes total.
 */
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import { requestClaude } from '../../background/claude';
import { loadSettings } from '@shared/settings';
import { sendRuntime } from '@shared/messages';

export async function runDailyBriefing(speech: Speech, hud: Hud): Promise<void> {
  const settings = await loadSettings();
  const urls = settings.dailyBriefingUrls;

  if (urls.length === 0) {
    await speech.speak("You haven't configured any briefing URLs. Add some in ARIA settings under Daily Briefing.");
    return;
  }

  await speech.speak(`Starting your daily briefing. ${urls.length} source${urls.length === 1 ? '' : 's'} to cover.`);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    hud.setCommand(`Briefing: opening source ${i + 1}/${urls.length}`);
    await speech.speak(`Source ${i + 1}: ${shortUrl(url)}`);

    // Open the URL in a new tab.
    sendRuntime({ type: 'OPEN_TAB', target: 'background', url });

    // Wait a moment for the tab to exist, then summarize the current page.
    await delay(2500);

    // Summarize using whatever page content is available.
    const pageText = document.body?.innerText?.slice(0, 2000) ?? '';
    if (!pageText) {
      await speech.speak("I couldn't read that source.");
      continue;
    }

    const result = await requestClaude(
      settings.apiKey,
      'You summarize news content in 2 sentences. Plain text only.',
      `Summarize the key information from this page content in 2 sentences:\n\n${pageText}`,
    );

    if (result.ok && result.text) {
      await speech.speak(result.text.trim().slice(0, 300));
    }

    await delay(1000);
  }

  await speech.speak("That's your daily briefing. Have a great day!");
  hud.setCommand('Daily briefing complete');
}

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
