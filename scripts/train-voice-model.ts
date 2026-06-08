import fs from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import {
  buildModel,
  CLASSES,
  NUM_CLASSES,
  SEED_DATA,
  SEQ_LEN,
  tokenise,
} from '../src/background/command-classifier';
import type { TrainingExample } from '../src/shared/neural-types';

const args = process.argv.slice(2);
const valueFor = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const examplesPath = path.resolve(valueFor('--examples') ?? 'examples.training.json');
const outputPath = path.resolve(valueFor('--output') ?? 'electron/src/renderer/intent-model.json');
const epochs = Number.parseInt(valueFor('--epochs') ?? '100', 10);

if (!Number.isFinite(epochs) || epochs < 1) throw new Error('--epochs must be a positive integer');

const examples = JSON.parse(fs.readFileSync(examplesPath, 'utf8')) as TrainingExample[];
const all = [
  ...SEED_DATA.map(([command, actionType]) => ({ command, actionType, isCorrect: true })),
  ...examples,
];

await tf.setBackend('cpu');
await tf.ready();

const labels = all.map((example) => {
  const index = CLASSES.indexOf(example.actionType as typeof CLASSES[number]);
  return index >= 0 ? index : NUM_CLASSES - 1;
});

const classFrequency = new Map<number, number>();
for (let i = 0; i < all.length; i++) {
  if (all[i].isCorrect === false) continue;
  classFrequency.set(labels[i], (classFrequency.get(labels[i]) ?? 0) + 1);
}
const maximumFrequency = Math.max(...classFrequency.values());

const inputs = all.map((example) => tokenise(example.command));
const targets = all.map((example, i) => {
  const target = new Array<number>(NUM_CLASSES).fill(0);
  if (example.isCorrect === false) {
    target.fill(1 / (NUM_CLASSES - 1));
    target[labels[i]] = 0;
  } else {
    target[labels[i]] = 1;
  }
  const classWeight = example.isCorrect === false
    ? 1
    : maximumFrequency / (classFrequency.get(labels[i]) ?? maximumFrequency);
  const weight = (example.isCorrect === false ? 5 : 1) * classWeight;
  return target.map((value) => value * weight);
});

const classPositions = new Map<number, number>();
const trainingIndices: number[] = [];
const validationIndices: number[] = [];
for (let i = 0; i < all.length; i++) {
  if (all[i].isCorrect === false) {
    trainingIndices.push(i);
    continue;
  }
  const position = classPositions.get(labels[i]) ?? 0;
  classPositions.set(labels[i], position + 1);
  (position % 5 === 0 ? validationIndices : trainingIndices).push(i);
}

const model = buildModel();
const tensorFor = (values: number[][], indices: number[], width: number) =>
  tf.tensor2d(indices.map((index) => values[index]), [indices.length, width]);
const trainXs = tensorFor(inputs, trainingIndices, SEQ_LEN);
const trainYs = tensorFor(targets, trainingIndices, NUM_CLASSES);
const validationXs = tensorFor(inputs, validationIndices, SEQ_LEN);
const validationYs = tensorFor(targets, validationIndices, NUM_CLASSES);

console.log(`Training voice intent model: ${trainingIndices.length} train, ${validationIndices.length} validation, ${epochs} epochs`);
const history = await model.fit(trainXs, trainYs, {
  epochs,
  batchSize: Math.min(32, Math.max(4, Math.floor(trainingIndices.length / 4))),
  shuffle: true,
  validationData: [validationXs, validationYs],
  verbose: 0,
});
trainXs.dispose();
trainYs.dispose();
validationXs.dispose();
validationYs.dispose();

const allXs = tf.tensor2d(inputs, [all.length, SEQ_LEN]);
const allYs = tf.tensor2d(targets, [all.length, NUM_CLASSES]);
await model.fit(allXs, allYs, {
  epochs: Math.max(10, Math.floor(epochs / 4)),
  batchSize: Math.min(32, Math.max(4, Math.floor(all.length / 4))),
  shuffle: true,
  verbose: 0,
});
allXs.dispose();
allYs.dispose();

const weights = model.getWeights();
const serialized = await Promise.all(weights.map(async (weight) => ({
  shape: weight.shape,
  data: Array.from(await weight.data<'float32'>()),
})));
weights.forEach((weight) => weight.dispose());

const accuracy = history.history['acc'] ?? history.history['accuracy'];
const validationAccuracy = history.history['val_acc'] ?? history.history['val_accuracy'];
const finalTrainingAccuracy = Number(accuracy.at(-1) ?? 0);
const finalValidationAccuracy = Number(validationAccuracy.at(-1) ?? 0);
const artifact = {
  version: 2,
  weights: serialized,
  examples: all.map(({ command, actionType, isCorrect }) => ({ command, actionType, isCorrect })),
  metrics: {
    trainingAccuracy: finalTrainingAccuracy,
    validationAccuracy: finalValidationAccuracy,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(artifact));

console.log(`Training accuracy: ${Math.round(finalTrainingAccuracy * 100)}%`);
console.log(`Validation accuracy: ${Math.round(finalValidationAccuracy * 100)}%`);
console.log(`Saved model: ${outputPath}`);
