/**
 * Wire codec benchmark: encode+decode latency and payload size for
 * VisionFrameData - the per-camera-frame message sent offscreen ->
 * background -> content while eye or hand mode is active (~30-60fps) -
 * comparing the binary codec in src/shared/vision-frame-codec.ts against
 * JSON.stringify/parse on the same data.
 *
 * Usage: npm run eval:wire-codec
 */
import { decodeVisionFrame, encodeVisionFrame } from '../src/shared/vision-frame-codec';
import type { VisionFrameData } from '../src/shared/messages';

const ITERATIONS = 20000;

const FRAMES: VisionFrameData[] = [
  { tracker: 'face', gaze: { x: 0.42, y: 0.81 }, browRaise: true, blinkLeft: false, blinkRight: false },
  { tracker: 'face', gaze: { x: 0.5, y: 0.5 } },
  { tracker: 'hand', fingertip: { x: 0.31, y: 0.62 }, gesture: 'pinch' },
  { tracker: 'hand', fingertip: { x: 0.7, y: 0.2 }, gesture: 'open_palm' },
];

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function stats(samples: number[]): { p50: number; p99: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p99: percentile(sorted, 99) };
}

const binaryMs: number[] = [];
const jsonMs: number[] = [];
let binaryBytes = 0;
let jsonBytes = 0;

for (let i = 0; i < ITERATIONS; i++) {
  const frame = FRAMES[i % FRAMES.length];

  const t0 = performance.now();
  const encoded = encodeVisionFrame(frame);
  const decoded = decodeVisionFrame(encoded);
  const t1 = performance.now();
  binaryMs.push(t1 - t0);
  binaryBytes += encoded.byteLength;
  void decoded;

  const t2 = performance.now();
  const json = JSON.stringify(frame);
  const parsed = JSON.parse(json);
  const t3 = performance.now();
  jsonMs.push(t3 - t2);
  jsonBytes += json.length;
  void parsed;
}

console.log('\n=== Wire codec benchmark: VisionFrameData encode+decode ===');
console.log(`Iterations: ${ITERATIONS}, cycling through ${FRAMES.length} representative frames.\n`);

for (const [label, samples] of [
  ['Binary codec (encodeVisionFrame + decodeVisionFrame)', binaryMs],
  ['JSON (JSON.stringify + JSON.parse)', jsonMs],
] as const) {
  const { p50, p99 } = stats(samples);
  console.log(`${label}\n  round trip   p50: ${p50.toFixed(4)}ms   p99: ${p99.toFixed(4)}ms`);
}

console.log(
  `\nAverage payload size: binary ${(binaryBytes / ITERATIONS).toFixed(1)} bytes vs ` +
  `JSON ${(jsonBytes / ITERATIONS).toFixed(1)} bytes ` +
  `(${(jsonBytes / binaryBytes).toFixed(1)}x smaller).`,
);
console.log(
  'Scope: this measures encode/decode cost and payload size in isolation, not the actual ' +
  'chrome.runtime.sendMessage transport cost - structured clone of a plain object may already ' +
  'be cheap enough that transport, not serialization, dominates. Not wired into the live ' +
  'offscreen/background message path.',
);
