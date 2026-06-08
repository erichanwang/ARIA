/**
 * Intent-accuracy harness: measures the real pipeline (rule router + NN
 * classifier) against a held-out test set.
 *
 * Honesty note on the held-out split: the bundled `intent-model.json` used at
 * runtime was trained on SEED_DATA *plus* examples.training.json (see
 * scripts/train-voice-model.ts), so evaluating that bundled artifact against
 * examples.training.json would be measuring training accuracy, not
 * generalisation. Instead this script trains a throwaway model on SEED_DATA
 * ONLY (never touches examples.training.json), then evaluates the full
 * pipeline - stripAriaWakeWord -> routeExplicitDesktopIntent -> NN classify -
 * against examples.training.json, which the model never saw. That is a
 * genuine held-out set, just a small one (22 examples); see the printed
 * caveat about statistical power.
 *
 * Usage: npm run eval:intent
 */
import fs from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { buildModel, CLASSES, NUM_CLASSES, SEED_DATA, SEQ_LEN, tokenise } from '../src/background/command-classifier';
import { routeExplicitDesktopIntent, stripAriaWakeWord } from '../src/shared/intent-rules';
import type { TrainingExample } from '../src/shared/neural-types';

const EVAL_PATH = path.resolve('examples.training.json');
const rawEvalSet = JSON.parse(fs.readFileSync(EVAL_PATH, 'utf8')) as TrainingExample[];

// Some commands in examples.training.json are verbatim duplicates of SEED_DATA
// entries (e.g. "go back", "zoom in") - evaluating those would measure training
// accuracy, not generalisation. Drop them from the held-out set and say so,
// rather than silently reporting an inflated number.
const seedCommands = new Set(SEED_DATA.map(([command]) => command.toLowerCase().trim()));
const leaked = rawEvalSet.filter((e) => seedCommands.has(e.command.toLowerCase().trim()));
const evalSet = rawEvalSet.filter((e) => !seedCommands.has(e.command.toLowerCase().trim()));
if (evalSet.length === 0) {
  console.error('FATAL: every example in examples.training.json duplicates a SEED_DATA command — no held-out set possible.');
  process.exit(1);
}

await tf.setBackend('cpu');
await tf.ready();

const model = buildModel();
const labels = SEED_DATA.map(([, actionType]) => CLASSES.indexOf(actionType as typeof CLASSES[number]));
const inputs = SEED_DATA.map(([command]) => tokenise(command));
const targets = labels.map((label) => {
  const t = new Array<number>(NUM_CLASSES).fill(0);
  t[label] = 1;
  return t;
});
const xs = tf.tensor2d(inputs, [inputs.length, SEQ_LEN]);
const ys = tf.tensor2d(targets, [targets.length, NUM_CLASSES]);
console.log(`Training on SEED_DATA only: ${SEED_DATA.length} examples, ${NUM_CLASSES} classes.`);
await model.fit(xs, ys, { epochs: 80, batchSize: 16, shuffle: true, verbose: 0 });
xs.dispose();
ys.dispose();

// ── evaluate the full pipeline on the held-out set ─────────────────────
type Row = { command: string; expected: string; predicted: string; via: 'rule' | 'model' };
const rows: Row[] = [];

for (const example of evalSet) {
  const stripped = stripAriaWakeWord(example.command).command;
  const ruled = routeExplicitDesktopIntent(stripped);
  let predicted: string;
  let via: 'rule' | 'model';
  if (ruled) {
    predicted = ruled;
    via = 'rule';
  } else {
    const input = tf.tensor2d([tokenise(stripped)], [1, SEQ_LEN]);
    const pred = model.predict(input) as tf.Tensor2D;
    const probs = await pred.data<'float32'>();
    input.dispose();
    pred.dispose();
    let maxIdx = 0;
    let maxProb = -1;
    for (let i = 0; i < probs.length; i++) if (probs[i] > maxProb) { maxProb = probs[i]; maxIdx = i; }
    predicted = CLASSES[maxIdx];
    via = 'model';
  }
  rows.push({ command: example.command, expected: example.actionType, predicted, via });
}
model.dispose();

const correct = rows.filter((r) => r.expected === r.predicted).length;
const accuracy = correct / rows.length;

// Confusion matrix: expected (rows) x predicted (cols), sparse (only non-zero cells).
const confusion = new Map<string, Map<string, number>>();
for (const r of rows) {
  if (!confusion.has(r.expected)) confusion.set(r.expected, new Map());
  const row = confusion.get(r.expected)!;
  row.set(r.predicted, (row.get(r.predicted) ?? 0) + 1);
}

console.log('\n=== Intent-accuracy harness (held-out: examples.training.json) ===');
if (leaked.length > 0) {
  console.log(
    `Excluded ${leaked.length}/${rawEvalSet.length} examples.training.json entries because they are ` +
    `verbatim SEED_DATA commands (not held-out): ${leaked.map((e) => `"${e.command}"`).join(', ')}`,
  );
}
console.log(`Held-out examples: ${rows.length}`);
console.log(`Overall accuracy: ${correct}/${rows.length} = ${(accuracy * 100).toFixed(1)}%`);
console.log('\nPer-example detail:');
for (const r of rows) {
  const mark = r.expected === r.predicted ? 'OK  ' : 'MISS';
  console.log(`  [${mark}] (${r.via.padEnd(5)}) "${r.command}" -> expected=${r.expected}, predicted=${r.predicted}`);
}
console.log('\nConfusion matrix (expected -> {predicted: count}):');
for (const [expected, row] of confusion) {
  const entries = Array.from(row.entries()).map(([pred, count]) => `${pred}:${count}`).join(', ');
  console.log(`  ${expected} -> ${entries}`);
}
console.log(
  '\nCaveat: 22 examples spread over 20 classes is a small held-out set (mostly 1 example ' +
  'per class); treat this as a smoke-test of generalisation, not a statistically powered ' +
  'accuracy estimate.',
);
