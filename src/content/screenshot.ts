/**
 * Screenshot + describe. Captures the visible viewport via canvas drawImage
 * from a video stream (chrome.tabCapture is MV3-restricted from content
 * scripts; we use html2canvas fallback or a background-delegated capture).
 *
 * MV3 workaround: we ask the background to call chrome.tabs.captureVisibleTab,
 * which returns a dataURL, then send it to Claude vision for description.
 */
import { requestRuntime } from '@shared/messages';
import type { Speech } from './speech';
import type { Hud } from './hud';

export async function runScreenshotDescribe(speech: Speech, hud: Hud): Promise<void> {
  hud.setCommand('Capturing screenshot…');

  const res = await requestRuntime({ type: 'CAPTURE_SCREENSHOT', target: 'background' });
  if (!res?.ok || !res.dataUrl) {
    await speech.speak("I couldn't capture the screen.");
    return;
  }

  hud.setCommand('Describing screenshot…');
  const descRes = await requestRuntime({
    type: 'DESCRIBE_SCREENSHOT',
    target: 'background',
    dataUrl: res.dataUrl,
  });

  if (!descRes?.ok || !descRes.description) {
    await speech.speak("I couldn't describe the screenshot.");
    return;
  }

  showScreenshotPanel(res.dataUrl, descRes.description);
  await speech.speak(descRes.description);
  hud.setCommand('Say "tell me more" to ask follow-up questions.');
}

function showScreenshotPanel(dataUrl: string, description: string): void {
  const existing = document.getElementById('aria-screenshot-panel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'aria-screenshot-panel';
  panel.style.cssText = [
    'position:fixed', 'bottom:20px', 'right:20px', 'width:380px', 'z-index:2147483646',
    'background:rgba(14,14,20,0.97)', 'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:14px', 'overflow:hidden',
    'box-shadow:0 12px 48px rgba(0,0,0,0.6)', 'backdrop-filter:blur(10px)',
    'font-family:ui-sans-serif,system-ui,sans-serif',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.07)';
  const title = document.createElement('span');
  title.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:#9aa0aa;font-weight:700';
  title.textContent = 'Screenshot';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:14px;padding:0';
  closeBtn.addEventListener('click', () => panel.remove());
  header.append(title, closeBtn);

  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'width:100%;display:block;max-height:200px;object-fit:cover';

  const desc = document.createElement('div');
  desc.style.cssText = 'padding:12px 14px;color:#c0c8d4;font-size:13px;line-height:1.5';
  desc.textContent = description;

  panel.append(header, img, desc);
  document.documentElement.appendChild(panel);
  setTimeout(() => panel.remove(), 30000);
}
