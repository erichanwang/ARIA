import { describe, expect, it } from 'vitest';
import { decodeVisionFrame, encodeVisionFrame } from '../src/shared/vision-frame-codec';
import type { VisionFrameData, HandGesture } from '../src/shared/messages';

const GESTURES: HandGesture[] = [
  'point', 'pinch', 'open_palm', 'fist', 'two_finger', 'peace', 'thumbs_up', 'thumbs_down',
  'three_finger', 'none',
];

function roundTrip(data: VisionFrameData): VisionFrameData {
  return decodeVisionFrame(encodeVisionFrame(data));
}

describe('vision frame codec', () => {
  it('round-trips a full face frame within fixed-point tolerance', () => {
    const data: VisionFrameData = {
      tracker: 'face',
      gaze: { x: 0.4231, y: 0.881 },
      browRaise: true,
      blinkLeft: true,
      blinkRight: false,
    };
    const out = roundTrip(data);
    expect(out.tracker).toBe('face');
    expect(out.gaze!.x).toBeCloseTo(data.gaze!.x, 4);
    expect(out.gaze!.y).toBeCloseTo(data.gaze!.y, 4);
    expect(out.browRaise).toBe(true);
    expect(out.blinkLeft).toBe(true);
    // blinkRight: false is indistinguishable from absent in the bitmask - the
    // decoder omits false optional booleans, matching how they're read
    // (`if (data.blinkRight)`) everywhere they're consumed.
    expect(out.blinkRight).toBeUndefined();
  });

  it('round-trips a full hand frame', () => {
    for (const gesture of GESTURES) {
      const data: VisionFrameData = { tracker: 'hand', fingertip: { x: 0.1, y: 0.9 }, gesture };
      const out = roundTrip(data);
      expect(out.tracker).toBe('hand');
      expect(out.fingertip!.x).toBeCloseTo(0.1, 4);
      expect(out.fingertip!.y).toBeCloseTo(0.9, 4);
      expect(out.gesture).toBe(gesture);
    }
  });

  it('round-trips a bare frame with no optional fields', () => {
    const out = roundTrip({ tracker: 'face' });
    expect(out).toEqual({ tracker: 'face' });
  });

  it('clamps out-of-range coordinates instead of wrapping', () => {
    const out = roundTrip({ tracker: 'face', gaze: { x: 1.2, y: -0.3 } });
    expect(out.gaze!.x).toBeCloseTo(1, 4);
    expect(out.gaze!.y).toBeCloseTo(0, 4);
  });

  it('encodes to a fixed small byte size, far below a JSON string', () => {
    const data: VisionFrameData = {
      tracker: 'hand',
      fingertip: { x: 0.5, y: 0.5 },
      gesture: 'pinch',
    };
    const bytes = encodeVisionFrame(data);
    const json = JSON.stringify(data);
    expect(bytes.byteLength).toBeLessThan(json.length);
  });
});
