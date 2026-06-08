/**
 * Training data CRUD + training pipeline.
 * Records successful Claude interactions as labelled examples,
 * then fine-tunes the local NN on demand.
 */
import { initClassifier, trainClassifier, isModelReady } from './command-classifier';
import type { TrainingExample, TrainingStatus, TrainingConfig } from '@shared/neural-types';

const EXAMPLES_KEY = 'aria.nn.examples';
const STATUS_KEY = 'aria.nn.status';

// ── data quality checks ──────────────────────────────

function isValidCommand(command: string): boolean {
  // Reject noisy/invalid commands
  if (!command || command.trim().length < 2) return false; // Too short
  if (/^\d+$/.test(command)) return false; // All digits
  if (/^[\s.,!?;:'"]+$/.test(command)) return false; // Only punctuation/spaces
  return true;
}

export interface DataQualityReport {
  totalExamples: number;
  uniqueCommands: number;
  duplicates: number;
  noise: number; // examples filtered out due to quality issues
  classBalance: Record<string, number>; // count per action class
}

async function analyzeDataQuality(examples: TrainingExample[]): Promise<DataQualityReport> {
  const validExamples: TrainingExample[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let noise = 0;

  for (const ex of examples) {
    if (!isValidCommand(ex.command)) {
      noise++;
      continue;
    }
    const key = `${ex.command}|${ex.actionType}`;
    if (seen.has(key)) {
      duplicates++;
    } else {
      seen.add(key);
      validExamples.push(ex);
    }
  }

  const classBalance: Record<string, number> = {};
  for (const ex of validExamples) {
    classBalance[ex.actionType] = (classBalance[ex.actionType] ?? 0) + 1;
  }

  return {
    totalExamples: examples.length,
    uniqueCommands: new Set(validExamples.map((e) => e.command)).size,
    duplicates,
    noise,
    classBalance,
  };
}

// ── storage helpers ──────────────────────────────────

async function readExamples(): Promise<TrainingExample[]> {
  const raw = await chrome.storage.local.get(EXAMPLES_KEY);
  return (raw[EXAMPLES_KEY] as TrainingExample[] | undefined) ?? [];
}

async function writeExamples(examples: TrainingExample[]): Promise<void> {
  await chrome.storage.local.set({ [EXAMPLES_KEY]: examples });
}

// ── public API ───────────────────────────────────────

/** Save a new labelled example (called after every confident Claude action). */
export async function recordExample(command: string, actionType: string, source: 'claude' | 'user' = 'claude'): Promise<void> {
  // Reject noisy commands
  if (!isValidCommand(command)) return;

  const examples = await readExamples();
  // Avoid duplicates: check entire dataset (not just last 100)
  if (examples.some((e) => e.command === command && e.actionType === actionType)) return;

  examples.push({ command, actionType, timestamp: Date.now(), source });
  // Cap at 2 000 stored examples to keep storage bounded.
  if (examples.length > 2000) examples.splice(0, examples.length - 2000);
  await writeExamples(examples);
}

/** Retrieve all stored user examples. */
export async function getExamples(): Promise<TrainingExample[]> {
  return readExamples();
}

/** Get data quality report. */
export async function getDataQuality(): Promise<DataQualityReport> {
  const examples = await readExamples();
  return analyzeDataQuality(examples);
}

/** Delete all stored examples. */
export async function clearExamples(): Promise<void> {
  await chrome.storage.local.remove(EXAMPLES_KEY);
}

/** Run a full training cycle. Returns training status. */
export async function runTraining(config?: TrainingConfig): Promise<TrainingStatus> {
  const examples = await readExamples();
  const result = await trainClassifier(examples, config);

  const status: TrainingStatus = {
    exampleCount: examples.length,
    lastTrainedAt: Date.now(),
    modelReady: true,
    lastAccuracy: result.trainAccuracy,
    validationAccuracy: result.validationAccuracy,
    recommendedConfidenceThreshold: result.recommendedConfidenceThreshold,
  };
  await chrome.storage.local.set({ [STATUS_KEY]: status });
  return status;
}

/** Get the latest saved training status. */
export async function getTrainingStatus(): Promise<TrainingStatus> {
  const raw = await chrome.storage.local.get(STATUS_KEY);
  const saved = raw[STATUS_KEY] as TrainingStatus | undefined;
  const examples = await readExamples();
  const quality = await analyzeDataQuality(examples);

  return {
    exampleCount: examples.length,
    lastTrainedAt: saved?.lastTrainedAt ?? null,
    modelReady: isModelReady(),
    lastAccuracy: saved?.lastAccuracy ?? null,
    validationAccuracy: saved?.validationAccuracy ?? null,
    dataQuality: {
      uniqueCommands: quality.uniqueCommands,
      duplicates: quality.duplicates,
      noise: quality.noise,
      classBalance: quality.classBalance,
    },
  };
}

/** Initialise the classifier on service worker start. */
export async function initTrainer(): Promise<void> {
  await initClassifier();
}
