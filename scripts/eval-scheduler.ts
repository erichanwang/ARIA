/**
 * Scheduler benchmark: runs the real pipeline stages (transcript -> rule
 * router / NN classify -> action validation, the same stages measured in
 * eval-pipeline-latency.ts) through PriorityScheduler, and measures the
 * scheduling wait time (enqueue -> task start) for "command" tasks
 * (priority 0, latency-sensitive - a user is waiting) versus "background"
 * bookkeeping tasks (priority 10 - training-example recording, history
 * persistence - not latency-sensitive) under sustained background load.
 *
 * Scope, stated plainly: this is a scheduling-policy comparison, not a
 * general throughput claim. The background arrival rate here (4 tasks per
 * command turn, each with a real ~3ms async cost standing in for a
 * chrome.storage.local write) is chosen to run the queue past its service
 * rate on purpose, because that is the only situation where a scheduling
 * policy can matter - a queue that never backs up doesn't care what order
 * it drains in. Whether that arrival rate matches a real ARIA session
 * depends on how often chrome.storage writes actually queue up in
 * practice, which has not been measured against a live session. Read the
 * numbers below as "priority ordering protects command latency once a
 * background backlog exists," not as "ARIA is N times faster."
 *
 * Runs TRIALS repetitions of each policy and reports mean +/- stddev of the
 * per-trial p50/p99, not a single-shot number.
 *
 * Usage: npm run eval:scheduler
 */
import fs from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { PriorityScheduler } from '../src/background/scheduler';
import { buildModel, CLASSES, SEQ_LEN, tokenise } from '../src/background/command-classifier';
import { routeExplicitDesktopIntent, stripAriaWakeWord } from '../src/shared/intent-rules';
import { parseAgentAction } from '../src/shared/actions';

const COMMANDS = [
  'hey aria open github',
  'aria copy this text',
  'scroll down a little',
  'summarize this page',
  'find the pricing section',
  'zoom in on the page',
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function stats(samples: number[]): { p50: number; p99: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p99: percentile(sorted, 99) };
}
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

await tf.setBackend('cpu');
await tf.ready();

const artifactPath = path.resolve('electron/src/renderer/intent-model.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
  weights: Array<{ shape: number[]; data: number[] }>;
};
const model = buildModel();
const tensors = artifact.weights.map((w) => tf.tensor(w.data, w.shape));
model.setWeights(tensors);
tensors.forEach((t) => t.dispose());

/** One real pipeline pass: rule route, fall back to NN classify, validate. */
function runPipelineStage(command: string): void {
  const stripped = stripAriaWakeWord(command).command;
  const ruled = routeExplicitDesktopIntent(stripped);
  let actionType = ruled;
  if (!actionType) {
    const input = tf.tensor2d([tokenise(stripped)], [1, SEQ_LEN]);
    const pred = model.predict(input) as tf.Tensor2D;
    const probs = pred.dataSync<'float32'>();
    input.dispose();
    pred.dispose();
    let maxIdx = 0;
    let maxProb = -1;
    for (let i = 0; i < probs.length; i++) if (probs[i] > maxProb) { maxProb = probs[i]; maxIdx = i; }
    actionType = CLASSES[maxIdx];
  }
  parseAgentAction(`{"action":"${actionType === 'none' ? 'none' : 'click'}","target":"x","speech":"ok","confidence":0.9}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Background bookkeeping work the real orchestrator also queues per command
 * (training-example recording via chrome.storage, history persistence). The
 * real chrome.storage.local calls are async with real (small) latency, which
 * is what actually creates queue contention - not modeled here without the
 * delay, since a synchronous stand-in would drain faster than any command
 * could ever arrive. */
function runBackgroundStage(): Promise<void> {
  JSON.stringify({ recordedAt: Date.now(), note: 'training example' });
  return delay(3);
}

const COMMAND_PRIORITY = 0;
const BACKGROUND_PRIORITY = 10;
const COMMAND_COUNT = 100;
const BACKGROUND_PER_COMMAND = 4; // trailing bookkeeping queued after each command completes

interface RunResult {
  commandWaitMs: number[];
  totalMs: number;
}

/** Simulates COMMAND_COUNT turns: each turn queues trailing background
 * bookkeeping (as the real orchestrator does after acting on a command),
 * then - after a short gap standing in for STT/network latency before the
 * next spoken command - queues the next command while that bookkeeping may
 * still be draining. `priorityAware` controls whether background tasks are
 * actually tagged with a lower priority or share the command's priority
 * (plain FIFO), isolating priority ordering as the only variable. */
async function runWorkload(priorityAware: boolean): Promise<RunResult> {
  const scheduler = new PriorityScheduler();
  const commandWaitMs: number[] = [];
  const t0 = performance.now();

  for (let i = 0; i < COMMAND_COUNT; i++) {
    for (let b = 0; b < BACKGROUND_PER_COMMAND; b++) {
      scheduler.enqueue(priorityAware ? BACKGROUND_PRIORITY : COMMAND_PRIORITY, runBackgroundStage);
    }
    await delay(1);
    scheduler.enqueue(COMMAND_PRIORITY, () => runPipelineStage(COMMANDS[i % COMMANDS.length]));
  }

  await scheduler.onIdle();
  const totalMs = performance.now() - t0;

  for (const record of scheduler.history) {
    if (record.priority === COMMAND_PRIORITY) commandWaitMs.push(record.waitMs);
  }
  return { commandWaitMs, totalMs };
}

const TRIALS = 5;

async function runTrials(priorityAware: boolean): Promise<{ p50s: number[]; p99s: number[]; throughputs: number[] }> {
  const p50s: number[] = [];
  const p99s: number[] = [];
  const throughputs: number[] = [];
  for (let t = 0; t < TRIALS; t++) {
    const result = await runWorkload(priorityAware);
    const { p50, p99 } = stats(result.commandWaitMs);
    p50s.push(p50);
    p99s.push(p99);
    throughputs.push((COMMAND_COUNT + COMMAND_COUNT * BACKGROUND_PER_COMMAND) / (result.totalMs / 1000));
  }
  return { p50s, p99s, throughputs };
}

const withPriority = await runTrials(true);
const fifo = await runTrials(false);
model.dispose();

console.log('\n=== Scheduler benchmark: command queue wait time under sustained background load ===');
console.log(
  `${TRIALS} trials, each ${COMMAND_COUNT} commands with ${BACKGROUND_PER_COMMAND} background ` +
  'tasks queued ahead of each one. Mean +/- stddev across trials.\n',
);

for (const [label, result] of [
  ['Priority-aware (commands=0, background=10)', withPriority],
  ['Plain FIFO (all priority 0)', fifo],
] as const) {
  console.log(`${label}`);
  console.log(`  command wait p50: ${mean(result.p50s).toFixed(3)}ms +/- ${stddev(result.p50s).toFixed(3)}ms`);
  console.log(`  command wait p99: ${mean(result.p99s).toFixed(3)}ms +/- ${stddev(result.p99s).toFixed(3)}ms`);
  console.log(`  throughput: ${mean(result.throughputs).toFixed(0)} +/- ${stddev(result.throughputs).toFixed(0)} tasks/sec\n`);
}

console.log(
  'Scope: this shows scheduling policy under a background backlog constructed to exceed the\n' +
  'queue\'s service rate, not a general throughput claim - a queue that never backs up does not\n' +
  'care what order it drains in. Whether real ARIA sessions produce backlogs at this rate is not\n' +
  'measured here.',
);
