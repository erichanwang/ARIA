/**
 * Latency harness for the offline-measurable stages of the command pipeline:
 *
 *   transcript -> rule router / NN classify -> action validation
 *
 * The Claude API round trip (src/background/claude.ts -> callClaude) is
 * deliberately NOT included: it needs a live Anthropic API key and network
 * access, neither of which exist in this environment. Fabricating a number
 * for it would be worse than omitting it, so this harness only reports the
 * stages it can actually run and measure.
 *
 * Usage: npm run eval:latency
 */
import fs from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { buildModel, CLASSES, SEQ_LEN, tokenise } from '../src/background/command-classifier';
import { routeExplicitDesktopIntent, stripAriaWakeWord } from '../src/shared/intent-rules';
import { parseAgentAction } from '../src/shared/actions';

const ITERATIONS = 500;

// Representative commands: a mix that resolves via the rule router and via
// the NN classifier, so the measured pipeline reflects both code paths.
const COMMANDS = [
  'hey aria open github',
  'aria copy this text',
  'scroll down a little',
  'click the submit button',
  'summarize this page',
  'find the pricing section',
  'translate this to spanish',
  'zoom in on the page',
  'go back to the previous page',
  'highlight this paragraph',
  'thank you',
];

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function stats(samples: number[]): { median: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

await tf.setBackend('cpu');
await tf.ready();

// Load the already-trained bundled weights instead of retraining - this
// harness measures inference latency, not training, and the bundled model
// is the one that actually ships.
const artifactPath = path.resolve('electron/src/renderer/intent-model.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
  weights: Array<{ shape: number[]; data: number[] }>;
};
const model = buildModel();
const tensors = artifact.weights.map((w) => tf.tensor(w.data, w.shape));
model.setWeights(tensors);
tensors.forEach((t) => t.dispose());

const ruleMs: number[] = [];
const classifyMs: number[] = [];
const validateMs: number[] = [];
const totalMs: number[] = [];

// A synthetic-but-schema-valid Claude response, used to time the real
// parseAgentAction/Zod-validation code path without needing a live API call.
function sampleClaudeJson(actionType: string): string {
  const bodies: Record<string, string> = {
    click: `{"action":"click","target":"the login button","speech":"Clicking login.","confidence":0.9}`,
    scroll: `{"action":"scroll","direction":"down","amount":"medium","speech":"Scrolling down.","confidence":0.9}`,
    navigate: `{"action":"navigate","url":"https://github.com","speech":"Opening GitHub.","confidence":0.9}`,
    read_aloud: `{"action":"read_aloud","speech":"Reading the page.","confidence":0.9}`,
    summarize: `{"action":"summarize","speech":"Here is a summary.","confidence":0.85}`,
    find_on_page: `{"action":"find_on_page","query":"pricing","speech":"Looking for pricing.","confidence":0.8}`,
    translate: `{"action":"translate","text":"Hello","targetLang":"Spanish","translation":"Hola","speech":"Translated to Spanish: Hola.","confidence":0.85}`,
    zoom_page: `{"action":"zoom_page","direction":"in","speech":"Zooming in.","confidence":0.9}`,
    browser_nav: `{"action":"browser_nav","command":"back","speech":"Going back.","confidence":0.9}`,
    highlight: `{"action":"highlight","text":"this paragraph","speech":"Highlighting.","confidence":0.85}`,
    copy_to_clipboard: `{"action":"copy_to_clipboard","speech":"Copied.","confidence":0.9}`,
  };
  return bodies[actionType] ?? `{"action":"none","speech":"I'm not sure how to help with that.","confidence":0.4}`;
}

for (let i = 0; i < ITERATIONS; i++) {
  const command = COMMANDS[i % COMMANDS.length];

  const t0 = performance.now();
  const stripped = stripAriaWakeWord(command).command;
  const ruled = routeExplicitDesktopIntent(stripped);
  const t1 = performance.now();
  ruleMs.push(t1 - t0);

  let actionType: string;
  const t2 = performance.now();
  if (ruled) {
    actionType = ruled;
  } else {
    const input = tf.tensor2d([tokenise(stripped)], [1, SEQ_LEN]);
    const pred = model.predict(input) as tf.Tensor2D;
    const probs = pred.dataSync<'float32'>();
    input.dispose();
    pred.dispose();
    let maxIdx = 0;
    let maxProb = -1;
    for (let j = 0; j < probs.length; j++) if (probs[j] > maxProb) { maxProb = probs[j]; maxIdx = j; }
    actionType = CLASSES[maxIdx];
  }
  const t3 = performance.now();
  classifyMs.push(t3 - t2);

  const t4 = performance.now();
  parseAgentAction(sampleClaudeJson(actionType));
  const t5 = performance.now();
  validateMs.push(t5 - t4);

  totalMs.push((t1 - t0) + (t3 - t2) + (t5 - t4));
}
model.dispose();

console.log('\n=== Pipeline latency harness (offline stages only, node CPU backend) ===');
console.log(`Iterations: ${ITERATIONS}\n`);

const rows: Array<[string, number[]]> = [
  ['1. transcript -> rule router (stripAriaWakeWord + routeExplicitDesktopIntent)', ruleMs],
  ['2. rule miss -> NN classify (tokenise + model.predict)', classifyMs],
  ['3. Claude response -> action validation (parseAgentAction / Zod)', validateMs],
  ['Total (stages 1-3, excludes Claude API round trip)', totalMs],
];
for (const [label, samples] of rows) {
  const { median, p95 } = stats(samples);
  console.log(`${label}\n  median: ${median.toFixed(3)}ms   p95: ${p95.toFixed(3)}ms`);
}

console.log(
  '\nNOT measured: the Claude API round trip (src/background/claude.ts callClaude) — ' +
  'requires a live ANTHROPIC_API_KEY and network access, unavailable in this environment. ' +
  'No number is reported for it; do not treat its absence as zero latency.',
);
