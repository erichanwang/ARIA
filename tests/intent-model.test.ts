import { describe, expect, it } from 'vitest';
import '@tensorflow/tfjs-backend-cpu';
import * as tf from '@tensorflow/tfjs-core';
import artifact from '../electron/src/renderer/intent-model.json';
import {
  buildModel,
  CLASSES,
  EMBED_DIM,
  NUM_CLASSES,
  SEQ_LEN,
  tokenise,
  VOCAB_SIZE,
} from '../src/background/command-classifier';

describe('bundled intent model', () => {
  it('contains versioned weights with the classifier architecture', () => {
    expect(artifact.version).toBeGreaterThanOrEqual(2);
    expect(artifact.weights.map((weight) => weight.shape)).toEqual([
      [VOCAB_SIZE, EMBED_DIM],
      [EMBED_DIM, 48],
      [48],
      [48, NUM_CLASSES],
      [NUM_CLASSES],
    ]);
    for (const weight of artifact.weights) {
      const expectedValues = weight.shape.reduce((total, size) => total * size, 1);
      expect(weight.data).toHaveLength(expectedValues);
    }
  });

  it('covers every intent class with positive training examples', () => {
    const coveredClasses = new Set(
      artifact.examples
        .filter((example) => example.isCorrect !== false)
        .map((example) => example.actionType),
    );
    expect(artifact.examples.length).toBeGreaterThanOrEqual(150);
    for (const actionType of CLASSES) expect(coveredClasses.has(actionType)).toBe(true);
  });

  it('records bounded training and validation metrics', () => {
    expect(artifact.metrics.trainingAccuracy).toBeGreaterThanOrEqual(0);
    expect(artifact.metrics.trainingAccuracy).toBeLessThanOrEqual(1);
    expect(artifact.metrics.validationAccuracy).toBeGreaterThanOrEqual(0);
    expect(artifact.metrics.validationAccuracy).toBeLessThanOrEqual(1);
  });

  it('routes a held-out desktop command set above the preliminary quality gate', async () => {
    const heldOut: Array<[string, typeof CLASSES[number]]> = [
      ['tap this button', 'click'],
      ['move down the page', 'scroll'],
      ['open reddit', 'navigate'],
      ['say this text aloud', 'read_aloud'],
      ['explain this article briefly', 'summarize'],
      ['look for settings on this page', 'find_on_page'],
      ['translate the article to german', 'translate'],
      ['increase the page size', 'zoom_page'],
      ['refresh the current tab', 'tab_action'],
      ['return to the previous page', 'browser_nav'],
      ['save the current site', 'bookmark_page'],
      ['write my name in the field', 'type_into'],
      ['send this form', 'submit_form'],
      ['put the selection on the clipboard', 'copy_to_clipboard'],
      ['scroll the page automatically', 'auto_scroll'],
      ['focus for twenty minutes', 'focus_timer'],
      ['add milk to my shopping list', 'shopping_list'],
      ['unmute the video', 'media_control'],
      ['mark this paragraph', 'highlight'],
      ['thank you', 'none'],
    ];

    await tf.setBackend('cpu');
    await tf.ready();
    const model = buildModel();
    const tensors = artifact.weights.map((weight) => tf.tensor(weight.data, weight.shape));
    model.setWeights(tensors);
    tensors.forEach((tensor) => tensor.dispose());
    const input = tf.tensor2d(heldOut.map(([command]) => tokenise(command)), [heldOut.length, SEQ_LEN]);
    const prediction = model.predict(input) as tf.Tensor2D;
    const predictedTensor = tf.argMax(prediction, 1);
    const predictedClasses = await predictedTensor.data();
    const correct = heldOut.reduce(
      (total, [, expected], index) => total + Number(CLASSES[predictedClasses[index]] === expected),
      0,
    );
    input.dispose();
    prediction.dispose();
    predictedTensor.dispose();
    model.dispose();

    expect(correct / heldOut.length).toBeGreaterThanOrEqual(0.5);
  });
});
