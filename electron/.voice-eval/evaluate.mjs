// electron/scripts/evaluate-voice-model.ts
import { pipeline } from "@huggingface/transformers";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// src/shared/transcript-metrics.ts
function words(text) {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
}
function wordErrorRate(reference, hypothesis) {
  const expected = words(reference);
  const actual = words(hypothesis);
  if (expected.length === 0) return actual.length === 0 ? 0 : 1;
  const previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let row = 1; row <= expected.length; row++) {
    const current = [row];
    for (let column = 1; column <= actual.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + Number(expected[row - 1] !== actual[column - 1])
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[actual.length] / expected.length;
}

// electron/scripts/evaluate-voice-model.ts
var model = process.argv[2] ?? "onnx-community/whisper-tiny.en";
var directory = join(homedir(), "Documents", "ARIA Voice Training");
var samples = readFileSync(join(directory, "metadata.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
if (samples.length === 0) throw new Error("No voice training samples found.");
var transcriber = await pipeline("automatic-speech-recognition", model, {
  dtype: {
    encoder_model: "fp32",
    decoder_model_merged: "fp32"
  }
});
var totalErrors = 0;
var totalWords = 0;
for (const sample of samples) {
  const decoded = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    join(directory, sample.file),
    "-f",
    "f32le",
    "-ac",
    "1",
    "-ar",
    "16000",
    "pipe:1"
  ], { maxBuffer: 32 * 1024 * 1024 });
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString() || `ffmpeg failed for ${sample.file}`);
  const bytes = decoded.stdout;
  const audio = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const output = await transcriber(audio, {});
  const heard = (Array.isArray(output) ? output[0]?.text : output.text)?.trim() ?? "";
  const referenceWords = sample.text.trim().split(/\s+/).length;
  const errors = wordErrorRate(sample.text, heard) * referenceWords;
  totalErrors += errors;
  totalWords += referenceWords;
  console.log(JSON.stringify({ file: sample.file, reference: sample.text, heard, wordErrorRate: errors / referenceWords }));
}
console.log(JSON.stringify({ model, samples: samples.length, wordErrorRate: totalErrors / totalWords }));
