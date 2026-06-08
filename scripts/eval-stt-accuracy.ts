/**
 * Speech-to-text accuracy harness: transcribes labeled recordings
 * under `~/Documents/ARIA Voice Training/` (or `ARIA_STT_DATASET_DIR`) with the exact model the desktop
 * app uses (`onnx-community/whisper-base.en` via @huggingface/transformers,
 * same dtype config as `electron/src/renderer/app.ts` getOfflineTranscriber),
 * and compares against the ground-truth transcript in metadata.jsonl.
 *
 * Audio is read straight from its existing location and never copied into
 * the repo. Decoding webm/opus -> 16kHz mono PCM is done by shelling out to
 * the system `ffmpeg` binary (no Node webm decoder is installed, and this is
 * a one-line native-tool call instead of a new dependency).
 *
 * Normalisation (stated explicitly because it changes the number): both
 * reference and hypothesis are lowercased and tokenised with
 * `src/shared/transcript-metrics.ts`'s `wordErrorRate`, which matches
 * `[a-z0-9]+(?:'[a-z0-9]+)?` tokens - i.e. lowercase, strip all punctuation
 * except apostrophes-within-a-word. This is the same normalisation the
 * desktop app itself uses for its "Word match" display in Build Voice
 * Dataset.
 *
 * Usage: npm run eval:stt
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { wordErrorRate } from '../src/shared/transcript-metrics';

const DATASET_DIR = process.env.ARIA_STT_DATASET_DIR
  ? path.resolve(process.env.ARIA_STT_DATASET_DIR)
  : path.join(os.homedir(), 'Documents', 'ARIA Voice Training');
const METADATA_PATH = path.join(DATASET_DIR, 'metadata.jsonl');
const TRANSFORMERS_ENTRY = path.resolve(
  'electron/node_modules/@huggingface/transformers/dist/transformers.node.mjs',
);

type Sample = { file: string; text: string };

if (!fs.existsSync(METADATA_PATH)) {
  console.error(`FATAL: dataset not found at ${METADATA_PATH}`);
  process.exit(1);
}
const samples: Sample[] = fs.readFileSync(METADATA_PATH, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

// Decode webm/opus -> 16kHz mono f32le PCM via ffmpeg, matching the sample
// rate the desktop app resamples to before feeding Whisper (resampleAudio's
// targetRate).
function decodeToPcm16k(filePath: string): Float32Array {
  const stdout = execFileSync('ffmpeg', [
    '-i', filePath,
    '-f', 'f32le',
    '-ar', '16000',
    '-ac', '1',
    '-loglevel', 'error',
    '-',
  ], { maxBuffer: 1024 * 1024 * 64, stdio: ['ignore', 'pipe', 'ignore'] });
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length / 4);
}

let transformers: typeof import('@huggingface/transformers');
try {
  transformers = await import(TRANSFORMERS_ENTRY);
} catch (error) {
  console.error(`FATAL: could not load @huggingface/transformers from ${TRANSFORMERS_ENTRY}`);
  console.error(error);
  process.exit(1);
}

console.log(`Loading onnx-community/whisper-base.en (same model + dtype config as the desktop app)...`);
let transcriber;
try {
  transcriber = await transformers.pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-base.en',
    {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
      progress_callback: (progress: Record<string, unknown>) => {
        if (progress && typeof progress === 'object' && 'status' in progress) {
          console.log(`  ${JSON.stringify(progress)}`);
        }
      },
    },
  );
} catch (error) {
  console.error('FATAL: model load failed (likely no network access to download weights).');
  console.error(error);
  process.exit(1);
}

type Result = { file: string; reference: string; hypothesis: string; wer: number; refWords: number };
const results: Result[] = [];

for (const sample of samples) {
  const filePath = path.join(DATASET_DIR, sample.file);
  const audio = decodeToPcm16k(filePath);
  const output = await transcriber(audio, {});
  const hypothesis = (Array.isArray(output) ? output[0]?.text : (output as { text?: string }).text)?.trim() ?? '';
  const wer = wordErrorRate(sample.text, hypothesis);
  const refWords = (sample.text.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? []).length;
  results.push({ file: sample.file, reference: sample.text, hypothesis, wer, refWords });
}

// Aggregate WER = total edit distance / total reference words (not a mean of
// per-sample WER, which would over-weight short samples). wordErrorRate
// returns distance/refWords, so distance = wer * refWords.
const totalDistance = results.reduce((sum, r) => sum + r.wer * r.refWords, 0);
const totalRefWords = results.reduce((sum, r) => sum + r.refWords, 0);
const aggregateWer = totalRefWords > 0 ? totalDistance / totalRefWords : NaN;

console.log('\n=== STT accuracy harness (onnx-community/whisper-base.en) ===');
console.log(`Dataset: ${DATASET_DIR}`);
console.log(
  'Normalisation: lowercase, tokens matching [a-z0-9]+ (apostrophes kept mid-word), ' +
  'all other punctuation stripped - same normalisation the desktop app itself uses.',
);
console.log('\nPer-sample:');
for (const r of results) {
  console.log(`  ${r.file}`);
  console.log(`    reference:  "${r.reference}"`);
  console.log(`    hypothesis: "${r.hypothesis}"`);
  console.log(`    WER: ${(r.wer * 100).toFixed(1)}%  accuracy: ${((1 - r.wer) * 100).toFixed(1)}%`);
}
console.log(
  `\nAggregate over ${results.length} samples: WER ${(aggregateWer * 100).toFixed(1)}%, ` +
  `word accuracy ${((1 - aggregateWer) * 100).toFixed(1)}%`,
);
console.log(
  `\nSmoke test, not a statistically powered estimate: n=${results.length} recordings from a ` +
  'single speaker/microphone. Do not generalise this number to other speakers, accents, or ' +
  'recording conditions.',
);
