export const EYE_STATES = ['open', 'both_closed', 'left_wink', 'right_wink'] as const;
export type EyeState = typeof EYE_STATES[number];
export type EyeFeatures = [leftEyeAspectRatio: number, rightEyeAspectRatio: number];

export interface EyeWinkModel {
  version: 1;
  open: EyeFeatures;
  closed: EyeFeatures;
  centroids: Record<EyeState, EyeFeatures>;
}

export interface EyeClassification {
  state: EyeState | 'uncertain';
  confidence: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function centroid(samples: EyeFeatures[]): EyeFeatures {
  return [median(samples.map((sample) => sample[0])), median(samples.map((sample) => sample[1]))];
}

function normalize(features: EyeFeatures, open: EyeFeatures, closed: EyeFeatures): EyeFeatures {
  return [
    (features[0] - closed[0]) / Math.max(0.006, open[0] - closed[0]),
    (features[1] - closed[1]) / Math.max(0.006, open[1] - closed[1]),
  ];
}

export function trainEyeWinkModel(samples: Record<EyeState, EyeFeatures[]>): EyeWinkModel {
  for (const state of EYE_STATES) {
    if (samples[state].length < 12) throw new Error(`Need at least 12 clear ${state.replace('_', ' ')} samples`);
    if (samples[state].some((sample) => sample.some((value) => !Number.isFinite(value)))) {
      throw new Error(`Invalid ${state.replace('_', ' ')} sample`);
    }
  }

  const centroids = Object.fromEntries(EYE_STATES.map((state) => [state, centroid(samples[state])])) as Record<EyeState, EyeFeatures>;
  const open = centroids.open;
  const closed = centroids.both_closed;
  const leftRange = open[0] - closed[0];
  const rightRange = open[1] - closed[1];
  if (leftRange < 0.006 || rightRange < 0.006) {
    throw new Error('Open and closed eyes were too similar. Improve lighting and train again.');
  }
  if (centroids.left_wink[0] > open[0] - leftRange * 0.2
      || centroids.left_wink[1] < closed[1] + rightRange * 0.45) {
    throw new Error('Left wink was not distinct enough. Keep the right eye naturally open.');
  }
  if (centroids.right_wink[1] > open[1] - rightRange * 0.2
      || centroids.right_wink[0] < closed[0] + leftRange * 0.45) {
    throw new Error('Right wink was not distinct enough. Keep the left eye naturally open.');
  }
  return { version: 1, open, closed, centroids };
}

export function classifyEyeState(model: EyeWinkModel, features: EyeFeatures): EyeClassification {
  const normalized = normalize(features, model.open, model.closed);
  const ranked = EYE_STATES.map((state) => {
    const target = normalize(model.centroids[state], model.open, model.closed);
    return { state, distance: Math.hypot(normalized[0] - target[0], normalized[1] - target[1]) };
  }).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const margin = ranked[1].distance - best.distance;
  if (best.distance > 0.7 || margin < 0.12) return { state: 'uncertain', confidence: 0 };
  const confidence = Math.min(1, (1 - best.distance / 0.7) * Math.min(1, margin / 0.5));
  return { state: best.state, confidence };
}
