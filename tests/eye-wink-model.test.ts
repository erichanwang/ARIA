import { describe, expect, it } from 'vitest';
import { classifyEyeState, trainEyeWinkModel, type EyeFeatures, type EyeState } from '../src/shared/eye-wink-model';

function samples(center: EyeFeatures): EyeFeatures[] {
  return Array.from({ length: 20 }, (_, index) => {
    const offset = (index % 5 - 2) * 0.001;
    return [center[0] + offset, center[1] - offset];
  });
}

const training: Record<EyeState, EyeFeatures[]> = {
  open: samples([0.18, 0.2]),
  both_closed: samples([0.04, 0.05]),
  left_wink: samples([0.05, 0.19]),
  right_wink: samples([0.17, 0.04]),
};

describe('personalized eye wink model', () => {
  it.each([
    [[0.18, 0.2], 'open'],
    [[0.04, 0.05], 'both_closed'],
    [[0.05, 0.19], 'left_wink'],
    [[0.17, 0.04], 'right_wink'],
  ] as Array<[EyeFeatures, EyeState]>)('classifies %s as %s', (features, state) => {
    expect(classifyEyeState(trainEyeWinkModel(training), features).state).toBe(state);
  });

  it('rejects an ambiguous half-closed frame', () => {
    expect(classifyEyeState(trainEyeWinkModel(training), [0.105, 0.125]).state).toBe('uncertain');
  });

  it('requires enough personal samples', () => {
    expect(() => trainEyeWinkModel({ ...training, left_wink: training.left_wink.slice(0, 5) }))
      .toThrow(/at least 12 clear left wink samples/);
  });
});
