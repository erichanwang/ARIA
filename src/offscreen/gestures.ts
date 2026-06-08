/**
 * Hand gesture classifier. Maps 21 MediaPipe hand landmarks to one of ARIA's
 * recognized gestures using simple geometric heuristics:
 *
 *   pinch        → thumb + index tips close            → click
 *   open_palm    → 4+ fingers extended + spread        → pause
 *   fist         → all fingers curled                  → hold
 *   two_finger   → index + middle extended, others in  → scroll
 *   point        → index extended only                 → move cursor
 *   peace        → index + middle extended + spread    → right-click
 *   thumbs_up    → thumb extended up, fingers curled   → confirm
 *   thumbs_down  → thumb extended down, fingers curled → cancel
 *   three_finger → index + middle + ring extended      → task picker
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { HandGesture } from '@shared/messages';

const WRIST = 0;
const FINGERS = {
  index:  [8, 6]  as const,
  middle: [12, 10] as const,
  ring:   [16, 14] as const,
  pinky:  [20, 18] as const,
};
const THUMB_TIP = 4;
const THUMB_IP  = 3;
const INDEX_TIP = 8;

export function classifyGesture(lm: NormalizedLandmark[]): HandGesture {
  const wrist = lm[WRIST];
  const handSize = dist(lm[WRIST], lm[9]); // wrist → middle MCP

  const ext = {
    index:  isExtended(lm, FINGERS.index,  wrist),
    middle: isExtended(lm, FINGERS.middle, wrist),
    ring:   isExtended(lm, FINGERS.ring,   wrist),
    pinky:  isExtended(lm, FINGERS.pinky,  wrist),
  };
  const count = Object.values(ext).filter(Boolean).length;

  // Pinch (highest priority): thumb + index tips close.
  if (dist(lm[THUMB_TIP], lm[INDEX_TIP]) < handSize * 0.35) return 'pinch';

  if (count === 0) {
    // Fist vs thumbs_up/thumbs_down: check thumb direction.
    const thumbUp   = lm[THUMB_TIP].y < lm[WRIST].y - handSize * 0.5;
    const thumbDown = lm[THUMB_TIP].y > lm[WRIST].y + handSize * 0.5;
    // Thumb must be extended (away from palm).
    const thumbExt = dist(lm[THUMB_TIP], wrist) > dist(lm[THUMB_IP], wrist) * 1.1;
    if (thumbExt && thumbUp)   return 'thumbs_up';
    if (thumbExt && thumbDown) return 'thumbs_down';
    return 'fist';
  }

  if (count >= 4) return 'open_palm';

  // Three fingers: index + middle + ring.
  if (ext.index && ext.middle && ext.ring && !ext.pinky) return 'three_finger';

  // Peace vs two_finger: index + middle extended, spread apart.
  if (ext.index && ext.middle && !ext.ring && !ext.pinky) {
    const spread = dist(lm[8], lm[12]); // index tip to middle tip
    return spread > handSize * 0.6 ? 'peace' : 'two_finger';
  }

  if (ext.index && count === 1) return 'point';
  return 'none';
}

function isExtended(lm: NormalizedLandmark[], [tip, pip]: readonly [number, number], wrist: NormalizedLandmark): boolean {
  return dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.05;
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
