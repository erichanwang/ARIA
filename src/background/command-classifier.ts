/**
 * On-device neural classifier for offline command routing.
 * Runs TF.js with the CPU backend (works in MV3 service workers).
 *
 * Architecture: Embedding → GlobalAveragePooling1D → Dense(48) → Dense(N_CLASSES)
 * Weights are serialised to chrome.storage.local for persistence across SW restarts.
 */
import '@tensorflow/tfjs-backend-cpu';
import * as tf from '@tensorflow/tfjs-core';
import { sequential, layers } from '@tensorflow/tfjs-layers';
import type { TrainingExample, ClassifierPrediction, TrainingConfig, TrainingResult, PerClassMetrics } from '@shared/neural-types';

// ───────────────────── constants ─────────────────────

export const VOCAB_SIZE = 256;
export const EMBED_DIM = 16;
export const SEQ_LEN = 12;
const WEIGHTS_KEY = 'aria.nn.weights';

export const CLASSES = [
  'click', 'scroll', 'navigate', 'read_aloud', 'summarize',
  'find_on_page', 'translate', 'zoom_page', 'tab_action', 'browser_nav',
  'bookmark_page', 'type_into', 'submit_form', 'copy_to_clipboard',
  'auto_scroll', 'focus_timer', 'shopping_list', 'media_control',
  'highlight', 'none',
] as const;
export const NUM_CLASSES = CLASSES.length;

// ───────────────────── vocabulary ────────────────────

export const VOCAB_WORDS = [
  '<PAD>', '<UNK>',
  // verbs
  'click','tap','press','scroll','go','navigate','open','close','type',
  'read','find','search','highlight','select','copy','paste','submit',
  'zoom','translate','summarize','bookmark','save','play','pause','mute',
  'unmute','back','forward','reload','refresh','stop','start','resume',
  'dictate','annotate','focus','add','clear','export','check','show',
  'hide','toggle','switch','download','write','enter','hit','move',
  'increase','decrease','lower','raise','make','set','tell','give',
  // nouns
  'page','tab','link','button','form','field','input','text','image',
  'video','audio','music','menu','window','browser','site','website','url',
  'address','bar','article','heading','list','item','element','outline',
  'timer','pomodoro','shopping','price','product','cart','volume',
  'fullscreen','caption','subtitle','speed','history','settings',
  'section','paragraph','word','sentence','selection','clipboard',
  // directions/positions
  'up','down','left','right','top','bottom','next','previous','prev',
  'first','last','beginning','end','middle','above','below','here',
  // pronouns/articles
  'this','the','a','an','my','that','these','those',
  // prepositions
  'to','for','in','on','at','of','with','from','into','onto',
  // modifiers
  'new','current','active','selected','all','every','some','please',
  'bigger','smaller','faster','slower','louder','quieter','little',
  'more','less','big','small','fast','slow','loud','quiet','auto',
  // languages
  'english','spanish','french','german','chinese','japanese','arabic',
  'portuguese','italian','russian','korean',
  // numbers/time
  'one','two','three','five','ten','fifteen','twenty','thirty',
  'minutes','min','seconds','hours',
  // content words
  'aloud','automatically','summary','explain','answer','question',
  'definition','translation','description','mode','help','me',
  'can','could','would','should','want','need',
  // misc
  'cancel','undo','redo','again','repeat','never','always',
  'detect','tool','feature','pomodoro',
];

const VOCAB_MAP = new Map<string, number>(VOCAB_WORDS.map((w, i) => [w, i]));

// Seeded pseudorandom number generator for reproducible shuffling
class SeededRandom {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = new SeededRandom(seed);
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function tokenise(command: string): number[] {
  const words = command.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const indices = words.map((w) => VOCAB_MAP.get(w) ?? 1); // 1 = <UNK>
  // Pad or truncate to SEQ_LEN
  const padded = new Array<number>(SEQ_LEN).fill(0);
  for (let i = 0; i < Math.min(indices.length, SEQ_LEN); i++) padded[i] = indices[i];
  return padded;
}

// Compute per-class precision, recall, F1 from predictions vs ground truth
function computePerClassMetrics(predictions: number[], trueLabels: number[]): PerClassMetrics {
  const metrics: PerClassMetrics = {};
  const confusionMatrix = new Map<string, { tp: number; fp: number; fn: number }>();

  for (let i = 0; i < CLASSES.length; i++) {
    const className = CLASSES[i];
    confusionMatrix.set(className, { tp: 0, fp: 0, fn: 0 });
  }

  for (let i = 0; i < predictions.length; i++) {
    const pred = CLASSES[predictions[i]];
    const true_ = CLASSES[trueLabels[i]];

    if (pred === true_) {
      confusionMatrix.get(pred)!.tp += 1;
    } else {
      confusionMatrix.get(pred)!.fp += 1;
      confusionMatrix.get(true_)!.fn += 1;
    }
  }

  for (const [className, counts] of confusionMatrix) {
    const { tp, fp, fn } = counts;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    const support = tp + fn;

    metrics[className] = { precision, recall, f1, support };
  }

  return metrics;
}

// ───────────────────── seed training data ────────────────────

export const SEED_DATA: Array<[string, string]> = [
  // click
  ['click the button','click'],['tap the link','click'],['press submit','click'],
  ['click on the menu','click'],['tap login','click'],['click the close button','click'],
  ['press the download button','click'],['click the next button','click'],
  ['tap settings','click'],['press back button','click'],['click play','click'],
  ['tap the checkbox','click'],['click accept','click'],['press okay','click'],

  // scroll
  ['scroll down','scroll'],['scroll up','scroll'],['go down','scroll'],
  ['go up the page','scroll'],['scroll to the bottom','scroll'],['scroll to top','scroll'],
  ['move down the page','scroll'],['scroll a little down','scroll'],
  ['go to the bottom','scroll'],['scroll up a bit','scroll'],

  // navigate
  ['go to google','navigate'],['open youtube','navigate'],['navigate to wikipedia','navigate'],
  ['go to amazon','navigate'],['search for cats','navigate'],['take me to twitter','navigate'],
  ['go to reddit','navigate'],['open github','navigate'],['go to gmail','navigate'],

  // read_aloud
  ['read this page aloud','read_aloud'],['read this article to me','read_aloud'],
  ['read the text aloud','read_aloud'],['read aloud','read_aloud'],
  ['start reading','read_aloud'],['read this to me','read_aloud'],
  ['read out loud','read_aloud'],['read the article aloud','read_aloud'],

  // summarize
  ['summarize this page','summarize'],['give me a summary','summarize'],
  ['what is this page about','summarize'],['briefly summarize this','summarize'],
  ['summarize the article','summarize'],['give me the gist','summarize'],
  ['summarize','summarize'],['give me an overview','summarize'],

  // find_on_page
  ['find the word privacy','find_on_page'],['search for contact on this page','find_on_page'],
  ['find pricing on this page','find_on_page'],['look for the login section','find_on_page'],
  ['find the download link','find_on_page'],['search on page','find_on_page'],
  ['look for the button','find_on_page'],['find the form','find_on_page'],

  // translate
  ['translate this to spanish','translate'],['translate the page to french','translate'],
  ['translate to german','translate'],['translate to chinese','translate'],
  ['what does this say in english','translate'],['translate to japanese','translate'],
  ['translate to arabic','translate'],['translate this text','translate'],

  // zoom_page
  ['zoom in','zoom_page'],['zoom out','zoom_page'],['make the text bigger','zoom_page'],
  ['make it smaller','zoom_page'],['reset zoom','zoom_page'],
  ['increase zoom','zoom_page'],['make the page bigger','zoom_page'],

  // tab_action
  ['close this tab','tab_action'],['open a new tab','tab_action'],
  ['reload the page','tab_action'],['duplicate this tab','tab_action'],
  ['close tab','tab_action'],['new tab','tab_action'],
  ['refresh the page','tab_action'],['open new tab','tab_action'],

  // browser_nav
  ['go back','browser_nav'],['go forward','browser_nav'],
  ['go to the previous page','browser_nav'],['navigate back','browser_nav'],
  ['back','browser_nav'],['forward','browser_nav'],['previous page','browser_nav'],

  // bookmark_page
  ['bookmark this page','bookmark_page'],['save this page','bookmark_page'],
  ['add to bookmarks','bookmark_page'],['bookmark this','bookmark_page'],
  ['save page','bookmark_page'],['add bookmark','bookmark_page'],

  // type_into
  ['type hello in the search box','type_into'],['type my name in the field','type_into'],
  ['enter text in the input','type_into'],['type in the password field','type_into'],
  ['type hello','type_into'],['write hello in the input','type_into'],

  // submit_form
  ['submit the form','submit_form'],['send the form','submit_form'],
  ['hit submit','submit_form'],['submit','submit_form'],
  ['click submit','submit_form'],['press submit','submit_form'],

  // copy_to_clipboard
  ['copy this text','copy_to_clipboard'],['copy the selection','copy_to_clipboard'],
  ['copy to clipboard','copy_to_clipboard'],['copy this','copy_to_clipboard'],
  ['copy','copy_to_clipboard'],['copy selected text','copy_to_clipboard'],

  // auto_scroll
  ['start auto scroll','auto_scroll'],['start scrolling automatically','auto_scroll'],
  ['stop auto scroll','auto_scroll'],['auto scroll','auto_scroll'],
  ['scroll automatically','auto_scroll'],['pause scrolling','auto_scroll'],

  // focus_timer
  ['start a pomodoro','focus_timer'],['start a focus timer for 25 minutes','focus_timer'],
  ['set a 10 minute timer','focus_timer'],['pomodoro timer','focus_timer'],
  ['focus for 30 minutes','focus_timer'],['start timer','focus_timer'],
  ['pomodoro','focus_timer'],

  // shopping_list
  ['add this to my list','shopping_list'],['add to shopping list','shopping_list'],
  ['read my shopping list','shopping_list'],['clear my list','shopping_list'],
  ['add to list','shopping_list'],['add item to list','shopping_list'],

  // media_control
  ['play the video','media_control'],['pause','media_control'],
  ['mute','media_control'],['unmute','media_control'],
  ['toggle play','media_control'],['fullscreen','media_control'],
  ['increase volume','media_control'],['lower the volume','media_control'],
  ['volume up','media_control'],['volume down','media_control'],

  // highlight
  ['highlight this text','highlight'],['highlight the paragraph','highlight'],
  ['highlight','highlight'],['select and highlight this','highlight'],
  ['highlight the heading','highlight'],['mark this text','highlight'],

  // none
  ['hello','none'],['what do you think','none'],['never mind','none'],
  ['cancel','none'],['hmm','none'],['ok','none'],['thanks','none'],
];

// ───────────────────── model ─────────────────────────

let _model: ReturnType<typeof sequential> | null = null;
let _ready = false;

async function ensureBackend(): Promise<void> {
  await tf.setBackend('cpu');
  await tf.ready();
}

export function buildModel(): ReturnType<typeof sequential> {
  const m = sequential({
    layers: [
      layers.embedding({ inputDim: VOCAB_SIZE, outputDim: EMBED_DIM, inputLength: SEQ_LEN }),
      layers.globalAveragePooling1d(),
      layers.dense({ units: 48, activation: 'relu' }),
      layers.dropout({ rate: 0.2 }),
      layers.dense({ units: NUM_CLASSES, activation: 'softmax' }),
    ],
  });
  m.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  return m;
}

// ───────────────────── weight serialisation ──────────────────

async function saveWeights(model: ReturnType<typeof sequential>): Promise<void> {
  const weights = model.getWeights();
  const serialised = await Promise.all(
    weights.map(async (w) => ({ shape: w.shape, data: Array.from(await w.data<'float32'>()) })),
  );
  weights.forEach((w) => w.dispose());
  await chrome.storage.local.set({ [WEIGHTS_KEY]: serialised });
}

async function loadWeights(model: ReturnType<typeof sequential>): Promise<boolean> {
  const raw = await chrome.storage.local.get(WEIGHTS_KEY);
  const serialised = raw[WEIGHTS_KEY] as Array<{ shape: number[]; data: number[] }> | undefined;
  if (!serialised?.length) return false;
  const tensors = serialised.map(({ shape, data }) => tf.tensor(data, shape));
  try {
    model.setWeights(tensors);
    return true;
  } catch {
    return false;
  } finally {
    tensors.forEach((t) => t.dispose());
  }
}

// ───────────────────── public API ────────────────────

/** Initialise TF.js, build model, load persisted weights. */
export async function initClassifier(): Promise<void> {
  await ensureBackend();
  _model = buildModel();
  // Try to load previously trained weights.
  const loaded = await loadWeights(_model);
  _ready = loaded;
}

/** Train (or re-train) on seed data + user examples. Returns training result with accuracy and per-class metrics. */
export async function trainClassifier(userExamples: TrainingExample[], config?: TrainingConfig): Promise<TrainingResult> {
  await ensureBackend();
  if (!_model) _model = buildModel();

  const seedExamples = SEED_DATA.map(([cmd, act]) => ({ command: cmd, actionType: act, isCorrect: true }));
  let all = [...seedExamples, ...userExamples];

  // For reproducibility: shuffle with seed if provided, otherwise keep order (deterministic)
  if (config?.seed !== undefined) {
    all = seededShuffle(all, config.seed);
  }

  const xArr = all.map((e) => tokenise(e.command));
  const yArr = all.map((e) => {
    const idx = CLASSES.indexOf(e.actionType as typeof CLASSES[number]);
    return idx >= 0 ? idx : NUM_CLASSES - 1; // fallback to 'none'
  });

  // Upweight negative examples (punished corrections) to focus training on avoiding wrong predictions
  const negativeWeight = all.map((e) => (e.isCorrect === false ? 5.0 : 1.0));

  // Apply class weighting to handle imbalanced classes
  // Classes with fewer examples get higher weight to balance training
  const classFreq = new Map<number, number>();
  for (let i = 0; i < yArr.length; i++) {
    if (all[i].isCorrect === false) continue;
    const y = yArr[i];
    classFreq.set(y, (classFreq.get(y) ?? 0) + 1);
  }
  const maxFreq = Math.max(...Array.from(classFreq.values()));
  const classWeights = new Map<number, number>();
  for (const [cls, freq] of classFreq) {
    // inverse frequency weighting: class with 10% of examples gets 10x weight
    classWeights.set(cls, maxFreq / freq);
  }

  // Combine negative example weight with class weight
  const weights = all.map((e, i) => {
    if (e.isCorrect === false) return negativeWeight[i];
    const cw = classWeights.get(yArr[i]) ?? 1.0;
    return negativeWeight[i] * cw;
  });

  // Auto-tune epochs based on dataset size: scale from 40 (small) to 200 (large)
  const autoEpochs = Math.min(200, Math.max(40, Math.ceil(all.length * 0.15)));
  const epochs = config?.epochs ?? autoEpochs;
  const batchSize = config?.batchSize ?? Math.min(32, Math.max(4, Math.floor(all.length / 4)));
  const validationSplit = config?.validationSplit ?? 0.2;
  const shuffle = config?.shuffle ?? false; // default: false for reproducibility

  // Split into training and validation sets
  const positiveIndices = all.map((e, i) => e.isCorrect === false ? -1 : i).filter((i) => i >= 0);
  const validationCount = Math.floor(positiveIndices.length * validationSplit);
  const valIndices = validationCount > 0 ? positiveIndices.slice(-validationCount) : [];
  const valIndexSet = new Set(valIndices);
  const trainIndices = all.map((_, i) => i).filter((i) => !valIndexSet.has(i));

  const trainXArr = trainIndices.map((i) => xArr[i]);
  const trainYArr = trainIndices.map((i) => {
    const label = yArr[i];
    const target = new Array<number>(NUM_CLASSES).fill(0);
    if (all[i].isCorrect === false) {
      const alternativeProbability = 1 / (NUM_CLASSES - 1);
      target.fill(alternativeProbability);
      target[label] = 0;
    } else {
      target[label] = 1;
    }
    return target;
  });
  const trainWeights = trainIndices.map((i) => weights[i]);

  const valXArr = valIndices.map((i) => xArr[i]);
  const valYArr = valIndices.map((i) => yArr[i]);

  const xs = tf.tensor2d(trainXArr, [trainXArr.length, SEQ_LEN]);
  const weightedTrainYArr = trainYArr.map((target, i) => target.map((value) => value * trainWeights[i]));
  const ys = tf.tensor2d(weightedTrainYArr, [trainYArr.length, NUM_CLASSES]);

  let trainAccuracy = 0;
  const hist = await _model.fit(xs, ys, {
    epochs,
    batchSize,
    shuffle,
    verbose: 0, // set to 1 for progress logging in browser console
  });

  xs.dispose();
  ys.dispose();

  const lastAcc = hist.history['acc'] ?? hist.history['accuracy'];
  if (Array.isArray(lastAcc)) trainAccuracy = lastAcc[lastAcc.length - 1] as number;

  // Extract training history for visualization (loss curve, accuracy curve)
  const trainAccuracyHistory = (hist.history['acc'] ?? hist.history['accuracy']) as number[];
  const trainLossHistory = (hist.history['loss']) as number[];
  const trainingHistory = {
    epochs: Array.from({ length: trainAccuracyHistory?.length ?? 0 }, (_, i) => i + 1),
    trainLoss: trainLossHistory ?? [],
    trainAccuracy: trainAccuracyHistory ?? [],
  };

  // Evaluate on validation set
  let validationAccuracy = 0;
  let perClassMetrics: PerClassMetrics = {};
  if (valXArr.length > 0) {
    const valXs = tf.tensor2d(valXArr, [valXArr.length, SEQ_LEN]);
    const valPredTensor = _model.predict(valXs) as tf.Tensor2D;
    const valPreds = await valPredTensor.data<'float32'>();
    valXs.dispose();
    valPredTensor.dispose();

    const valPredictions: number[] = [];
    for (let i = 0; i < valYArr.length; i++) {
      let maxIdx = 0;
      let maxProb = 0;
      for (let j = 0; j < NUM_CLASSES; j++) {
        const prob = valPreds[i * NUM_CLASSES + j];
        if (prob > maxProb) { maxProb = prob; maxIdx = j; }
      }
      valPredictions.push(maxIdx);
    }

    // Compute validation accuracy
    let correct = 0;
    for (let i = 0; i < valYArr.length; i++) {
      if (valPredictions[i] === valYArr[i]) correct += 1;
    }
    validationAccuracy = valYArr.length > 0 ? correct / valYArr.length : 0;

    // Compute per-class metrics
    perClassMetrics = computePerClassMetrics(valPredictions, valYArr);
  }

  // Recommend confidence threshold based on validation accuracy
  // Higher accuracy → more confident threshold (user trusts the model more)
  // Lower accuracy → more conservative threshold (require user confirmation more often)
  const recommendedThreshold = Math.max(0.3, Math.min(0.75, 0.5 + (validationAccuracy - 0.5) * 0.5));

  await saveWeights(_model);
  _ready = true;
  return { trainAccuracy, validationAccuracy, perClassMetrics, recommendedConfidenceThreshold: recommendedThreshold, history: trainingHistory };
}

/** Classify a voice command. Returns null if the model is not yet trained. */
export async function classify(command: string): Promise<ClassifierPrediction | null> {
  if (!_model || !_ready) return null;
  await ensureBackend();

  const input = tf.tensor2d([tokenise(command)], [1, SEQ_LEN]);
  const predTensor = _model.predict(input) as tf.Tensor2D;
  const probs = await predTensor.data<'float32'>();
  input.dispose();
  predTensor.dispose();

  let maxIdx = 0;
  let maxProb = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] > maxProb) { maxProb = probs[i]; maxIdx = i; }
  }

  return { actionType: CLASSES[maxIdx], confidence: maxProb };
}

export function isModelReady(): boolean {
  return _ready;
}

/**
 * Recommend a confidence threshold based on validation set performance.
 * Uses the F1 score to find the optimal threshold that balances precision/recall.
 * If validation data unavailable, returns a sensible default.
 */
export async function recommendConfidenceThreshold(userExamples: TrainingExample[]): Promise<number> {
  // If not enough validation data, use conservative default
  if (userExamples.length < 10) return 0.5;

  // TODO: Implement optimal threshold selection using ROC curve / F1 score
  // For now, use simple heuristic: threshold = 0.5 + (model accuracy - 0.5) * 0.4
  // This adapts the threshold based on overall model performance
  // If model is 60% accurate: threshold = 0.5 + 0.1 * 0.4 = 0.54
  // If model is 80% accurate: threshold = 0.5 + 0.3 * 0.4 = 0.62
  // If model is 90% accurate: threshold = 0.5 + 0.4 * 0.4 = 0.66 (capped at 0.75)

  await ensureBackend();
  if (!_model || !_ready) return 0.5;

  const seedExamples = SEED_DATA.map(([cmd, act]) => ({ command: cmd, actionType: act, isCorrect: true }));
  const all = [...seedExamples, ...userExamples];

  const xArr = all.map((e) => tokenise(e.command));
  const yArr = all.map((e) => CLASSES.indexOf(e.actionType as typeof CLASSES[number]));

  // Quick inference pass to get confidence distribution
  let correctCount = 0;
  for (const tokens of xArr) {
    const input = tf.tensor2d([tokens], [1, SEQ_LEN]);
    const pred = _model.predict(input) as tf.Tensor2D;
    const probs = await pred.data<'float32'>();
    input.dispose();
    pred.dispose();

    let maxIdx = 0;
    let maxProb = 0;
    for (let i = 0; i < probs.length; i++) {
      if (probs[i] > maxProb) { maxProb = probs[i]; maxIdx = i; }
    }
    const trueIdx = yArr[xArr.indexOf(tokens)];
    if (maxIdx === trueIdx) correctCount++;
  }

  const accuracy = correctCount / all.length;
  const recommendedThreshold = Math.min(0.75, 0.5 + (accuracy - 0.5) * 0.4);
  return Math.max(0.3, Math.min(0.75, recommendedThreshold));
}
