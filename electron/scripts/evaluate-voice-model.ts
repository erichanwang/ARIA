import { pipeline } from '@huggingface/transformers';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { wordErrorRate } from '../../src/shared/transcript-metrics';

interface SampleMetadata {
  file: string;
  text: string;
}

const model = process.argv[2] ?? 'onnx-community/whisper-tiny.en';
const directory = join(homedir(), 'Documents', 'ARIA Voice Training');
const samples = readFileSync(join(directory, 'metadata.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as SampleMetadata);

if (samples.length === 0) throw new Error('No voice training samples found.');

const transcriber = await pipeline('automatic-speech-recognition', model, {
  dtype: {
    encoder_model: 'fp32',
    decoder_model_merged: 'fp32',
  },
});

let totalErrors = 0;
let totalWords = 0;
for (const sample of samples) {
  const decoded = spawnSync('ffmpeg', [
    '-v', 'error', '-i', join(directory, sample.file),
    '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1',
  ], { maxBuffer: 32 * 1024 * 1024 });
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString() || `ffmpeg failed for ${sample.file}`);
  const bytes = decoded.stdout;
  const audio = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const output = await transcriber(audio, {});
  const heard = (Array.isArray(output) ? output[0]?.text : output.text)?.trim() ?? '';
  const referenceWords = sample.text.trim().split(/\s+/).length;
  const errors = wordErrorRate(sample.text, heard) * referenceWords;
  totalErrors += errors;
  totalWords += referenceWords;
  console.log(JSON.stringify({ file: sample.file, reference: sample.text, heard, wordErrorRate: errors / referenceWords }));
}

console.log(JSON.stringify({ model, samples: samples.length, wordErrorRate: totalErrors / totalWords }));
