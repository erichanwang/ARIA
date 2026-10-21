/**
 * Real hosted-vs-local comparison for command resolution (Task: on-device
 * inference). Uses the actual callOllama() code path (src/background/ollama.ts)
 * against a locally running Ollama server - not a mock - so these numbers are
 * genuine measurements on this machine.
 *
 * Honesty note: there is no ANTHROPIC_API_KEY available in this environment
 * (same constraint documented in scripts/eval-pipeline-latency.ts), so this
 * script CANNOT produce a real hosted-Claude accuracy/latency number to
 * compare against. It only reports the local Ollama side, measured for real.
 * Do not treat the missing hosted column as "hosted is worse" or "0ms" -
 * it is simply unmeasured here.
 *
 * Usage: npx tsx scripts/eval-inference-provider.ts [model] [sampleSize]
 */
import fs from 'node:fs';
import path from 'node:path';
import { callOllama } from '../src/background/ollama';
import type { PageContext } from '../src/shared/types';
import type { TrainingExample } from '../src/shared/neural-types';

const model = process.argv[2] ?? 'qwen2.5:0.5b';
const sampleSize = Number(process.argv[3] ?? 30);

const EVAL_PATH = path.resolve('examples.training.json');
const allExamples = JSON.parse(fs.readFileSync(EVAL_PATH, 'utf8')) as TrainingExample[];
const examples = allExamples.slice(0, sampleSize);

const page: PageContext = {
  url: 'https://example.com/article',
  title: 'Example Article',
  excerpt: 'This is a generic page used as fixed context for every eval command, so results measure command resolution rather than page comprehension.',
  selected_text: '',
};

async function main() {
  // Warm the model once (pays one-time load latency) so per-example timings
  // reflect steady-state inference, matching how the extension behaves after
  // the first command in a session.
  console.log(`Warming ${model}...`);
  await callOllama('warm up', page, '', [], 'ARIA', 'standard', model);

  type Row = { command: string; expected: string; predicted: string | null; ok: boolean; ms: number; error: string | null };
  const rows: Row[] = [];

  for (const ex of examples) {
    const t0 = performance.now();
    const result = await callOllama(ex.command, page, '', [], 'ARIA', 'standard', model);
    const ms = performance.now() - t0;
    rows.push({
      command: ex.command,
      expected: ex.actionType,
      predicted: result.action?.action ?? null,
      ok: result.ok && result.action?.action === ex.actionType,
      ms,
      error: result.error,
    });
    process.stdout.write('.');
  }
  console.log('\n');

  const correct = rows.filter((r) => r.ok).length;
  const parsedButWrong = rows.filter((r) => !r.ok && r.predicted !== null).length;
  const unparseable = rows.filter((r) => r.predicted === null).length;
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];

  console.log(`=== Local inference (Ollama, model=${model}) — real measurement on this machine ===`);
  console.log(`Sample: ${rows.length}/${allExamples.length} examples from examples.training.json`);
  console.log(`Command-resolution accuracy (predicted action === expected action): ${correct}/${rows.length} = ${((correct / rows.length) * 100).toFixed(1)}%`);
  console.log(`  Parsed valid JSON but wrong action: ${parsedButWrong}`);
  console.log(`  Unparseable / no action after retry: ${unparseable}`);
  console.log(`Latency (post-warm-up, includes local model inference over HTTP): median ${median.toFixed(0)}ms, p95 ${p95.toFixed(0)}ms`);
  console.log('\nMisses:');
  for (const r of rows) {
    if (!r.ok) console.log(`  "${r.command}" -> expected=${r.expected}, got=${r.predicted ?? `ERROR: ${r.error}`}`);
  }

  console.log(
    '\nNOT measured: hosted Claude API accuracy/latency for this same set - no ANTHROPIC_API_KEY is ' +
    'available in this environment. Do not infer a hosted number from this output.',
  );
}

main();
