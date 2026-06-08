/**
 * Hand Gesture Trainer
 * Interactive training: shows gesture name + description,
 * asks user to perform it, validates via incoming hand data.
 * Gives checkmark when correct.
 */
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import type { HandGesture } from '@shared/messages';

interface GestureGuide {
  gesture: HandGesture;
  name: string;
  instruction: string;
  emoji: string;
}

const GESTURES: GestureGuide[] = [
  { gesture: 'point', name: 'Point', instruction: 'Extend your index finger and curl the others.', emoji: '👆' },
  { gesture: 'pinch', name: 'Pinch', instruction: 'Touch your index finger tip to your thumb.', emoji: '🤌' },
  { gesture: 'open_palm', name: 'Open Palm', instruction: 'Open your hand flat, all fingers extended.', emoji: '✋' },
  { gesture: 'fist', name: 'Fist', instruction: 'Close all fingers into a fist.', emoji: '✊' },
  { gesture: 'two_finger', name: 'Two Fingers', instruction: 'Extend your index and middle finger, curl the others.', emoji: '✌' },
  { gesture: 'peace', name: 'Peace Sign', instruction: 'Same as two fingers — a V shape.', emoji: '✌' },
  { gesture: 'thumbs_up', name: 'Thumbs Up', instruction: 'Extend your thumb, curl other fingers.', emoji: '👍' },
];

let onGestureDetected: ((g: HandGesture) => void) | null = null;
let trainerActive = false;

/** Called by hand-driver whenever a gesture is classified. */
export function feedGestureToTrainer(gesture: HandGesture): void {
  if (!trainerActive || !onGestureDetected || gesture === 'none') return;
  onGestureDetected(gesture);
}

export async function runGestureTrainer(speech: Speech, hud: Hud): Promise<void> {
  trainerActive = true;
  await speech.speak("Gesture trainer started! I'll show you each gesture. Perform it when prompted.");

  let passed = 0;

  for (const guide of GESTURES) {
    hud.setCommand(`${guide.emoji} Gesture: ${guide.name} — ${guide.instruction}`);
    showGestureCard(guide);
    await speech.speak(`${guide.name}: ${guide.instruction}`);

    const success = await waitForGesture(guide.gesture, 8000);
    if (success) {
      passed++;
      await speech.speak(`${guide.name}! Well done.`);
      hud.setCommand(`✓ ${guide.name} — correct!`);
    } else {
      await speech.speak(`Let's move on — you can practice ${guide.name} later.`);
    }
    await delay(800);
    dismissGestureCard();
  }

  trainerActive = false;
  const pct = Math.round((passed / GESTURES.length) * 100);
  await speech.speak(`Training complete! You nailed ${passed} of ${GESTURES.length} gestures — ${pct}%. You're ready to use hand mode!`);
  hud.setCommand(`Gesture trainer done: ${pct}%`);
}

function waitForGesture(target: HandGesture, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { onGestureDetected = null; resolve(false); }, timeoutMs);
    onGestureDetected = (g: HandGesture) => {
      if (g === target) {
        clearTimeout(timeout);
        onGestureDetected = null;
        resolve(true);
      }
    };
  });
}

function showGestureCard(guide: GestureGuide): void {
  dismissGestureCard();
  const card = document.createElement('div');
  card.id = 'aria-gesture-card';
  card.style.cssText = [
    'position:fixed', 'top:50%', 'left:50%',
    'transform:translate(-50%,-50%)',
    'background:rgba(14,14,22,0.97)',
    'border:1px solid rgba(43,127,255,0.5)',
    'border-radius:16px', 'padding:28px 36px',
    'text-align:center',
    'color:#f3f3f7',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'z-index:2147483645',
    'box-shadow:0 20px 60px rgba(0,0,0,0.7)',
    'backdrop-filter:blur(10px)',
  ].join(';');
  card.innerHTML = `
    <div style="font-size:48px;margin-bottom:12px">${guide.emoji}</div>
    <div style="font-size:20px;font-weight:700;margin-bottom:8px">${guide.name}</div>
    <div style="color:#9aa0aa;font-size:14px;line-height:1.5">${guide.instruction}</div>
    <div style="margin-top:16px;color:#2b7fff;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Perform this gesture now</div>`;
  document.documentElement.appendChild(card);
}

function dismissGestureCard(): void {
  document.getElementById('aria-gesture-card')?.remove();
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
