export interface TrainingExample {
  command: string;
  actionType: string;
  timestamp: number;
  source: 'claude' | 'user';
  isCorrect?: boolean; // false = user punished this prediction; true/undefined = positive example
}

export interface ClassifierPrediction {
  actionType: string;
  confidence: number;
}

export interface PerClassMetrics {
  [className: string]: {
    precision: number;
    recall: number;
    f1: number;
    support: number; // number of examples in validation set for this class
  };
}

export interface TrainingResult {
  trainAccuracy: number;
  validationAccuracy: number;
  perClassMetrics: PerClassMetrics;
  recommendedConfidenceThreshold?: number; // recommended action confidence threshold (0.3-0.75)
  history?: {
    epochs: number[];
    trainLoss: number[];
    trainAccuracy: number[];
    valLoss?: number[];
    valAccuracy?: number[];
  }; // optional: epoch-by-epoch metrics for visualization
}

export interface TrainingConfig {
  epochs?: number; // auto-scaled if not provided
  batchSize?: number; // defaults to min(32, datasetSize/4)
  validationSplit?: number; // defaults to 0.2
  earlyStoppingPatience?: number; // stop if val_loss doesn't improve for N epochs
  seed?: number; // for reproducibility (if not set, training is non-deterministic)
  shuffle?: boolean; // defaults to false for reproducibility; set true for randomization
}

export interface TrainingStatus {
  exampleCount: number;
  lastTrainedAt: number | null;
  modelReady: boolean;
  lastAccuracy: number | null;
  validationAccuracy?: number | null; // accuracy on held-out validation set
  recommendedConfidenceThreshold?: number; // recommended threshold for action confirmation (0.3-0.75)
  dataQuality?: {
    uniqueCommands: number;
    duplicates: number;
    noise: number;
    classBalance?: Record<string, number>;
  }; // data quality metrics
}
