/**
 * Own binary wire codec for VisionFrameData - the per-camera-frame gaze/hand
 * message sent offscreen -> background -> content at camera frame rate
 * (~30-60fps while eye or hand mode is active). It ships today as a plain
 * JS object over chrome.runtime.sendMessage (structured clone, effectively
 * JSON-shaped). This is a fixed-layout binary encoding of the same data
 * into a Uint8Array: a one-byte tracker tag, a one-byte presence bitmask
 * for the six optional fields, then only the bytes each present field
 * needs - normalized 0..1 coordinates as fixed-point uint16 (65536 steps,
 * ~0.000015 max quantization error), booleans as bitmask bits (no payload
 * bytes), and the gesture enum as one byte. Encode/decode round-trips
 * exactly within that quantization tolerance; see the test for the
 * round-trip property and the benchmark script for size and latency
 * against JSON.stringify/parse on the same data.
 */
import type { HandGesture, VisionFrameData, VisionTracker } from './messages';

const TRACKERS: readonly VisionTracker[] = ['face', 'hand'];
const GESTURES: readonly HandGesture[] = [
  'point', 'pinch', 'open_palm', 'fist', 'two_finger', 'peace', 'thumbs_up', 'thumbs_down',
  'three_finger', 'none',
];

const enum Bit {
  Gaze = 1 << 0,
  BrowRaise = 1 << 1,
  BlinkLeft = 1 << 2,
  BlinkRight = 1 << 3,
  Fingertip = 1 << 4,
  Gesture = 1 << 5,
}

function encodeUnit(x: number): number {
  // Clamp to [0, 1] before scaling - callers may hand in slightly out-of-range
  // floats from upstream landmark math; clamping keeps the fixed-point value
  // in range instead of wrapping.
  return Math.round(Math.max(0, Math.min(1, x)) * 0xffff);
}
function decodeUnit(u: number): number {
  return u / 0xffff;
}

export function encodeVisionFrame(data: VisionFrameData): Uint8Array {
  let flags = 0;
  if (data.gaze) flags |= Bit.Gaze;
  if (data.browRaise) flags |= Bit.BrowRaise;
  if (data.blinkLeft) flags |= Bit.BlinkLeft;
  if (data.blinkRight) flags |= Bit.BlinkRight;
  if (data.fingertip) flags |= Bit.Fingertip;
  if (data.gesture) flags |= Bit.Gesture;

  const size = 2
    + (data.gaze ? 4 : 0)
    + (data.fingertip ? 4 : 0)
    + (data.gesture ? 1 : 0);
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let offset = 0;

  const trackerIdx = TRACKERS.indexOf(data.tracker);
  if (trackerIdx < 0) throw new Error(`unknown tracker: ${data.tracker}`);
  view.setUint8(offset, trackerIdx); offset += 1;
  view.setUint8(offset, flags); offset += 1;

  if (data.gaze) {
    view.setUint16(offset, encodeUnit(data.gaze.x)); offset += 2;
    view.setUint16(offset, encodeUnit(data.gaze.y)); offset += 2;
  }
  if (data.fingertip) {
    view.setUint16(offset, encodeUnit(data.fingertip.x)); offset += 2;
    view.setUint16(offset, encodeUnit(data.fingertip.y)); offset += 2;
  }
  if (data.gesture) {
    const gestureIdx = GESTURES.indexOf(data.gesture);
    if (gestureIdx < 0) throw new Error(`unknown gesture: ${data.gesture}`);
    view.setUint8(offset, gestureIdx); offset += 1;
  }

  return new Uint8Array(buf);
}

export function decodeVisionFrame(bytes: Uint8Array): VisionFrameData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const tracker = TRACKERS[view.getUint8(offset)]; offset += 1;
  if (!tracker) throw new Error('invalid tracker byte');
  const flags = view.getUint8(offset); offset += 1;

  const result: VisionFrameData = { tracker };
  if (flags & Bit.Gaze) {
    const x = decodeUnit(view.getUint16(offset)); offset += 2;
    const y = decodeUnit(view.getUint16(offset)); offset += 2;
    result.gaze = { x, y };
  }
  if (flags & Bit.BrowRaise) result.browRaise = true;
  if (flags & Bit.BlinkLeft) result.blinkLeft = true;
  if (flags & Bit.BlinkRight) result.blinkRight = true;
  if (flags & Bit.Fingertip) {
    const x = decodeUnit(view.getUint16(offset)); offset += 2;
    const y = decodeUnit(view.getUint16(offset)); offset += 2;
    result.fingertip = { x, y };
  }
  if (flags & Bit.Gesture) {
    const gesture = GESTURES[view.getUint8(offset)]; offset += 1;
    if (!gesture) throw new Error('invalid gesture byte');
    result.gesture = gesture;
  }

  return result;
}
