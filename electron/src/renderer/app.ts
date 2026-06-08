/**
 * ARIA Desktop renderer - voice + eye + hand control with online RL training.
 *
 *  Modes:
 *   Voice  - speak command → intent NN → action  (Cmd/Ctrl+Shift+Y/N feedback)
 *   Eye    - gaze regression NN → screen cursor + dwell-click
 *   Hand   - gesture classifier NN → cursor move (fingertip) + pinch-click
 *
 *  Reinforcement loop:
 *   After any action the last (input, action) pair is held in memory.
 *   Cmd/Ctrl+Shift+Y → positive example recorded → periodic micro-retrain
 *   Cmd/Ctrl+Shift+N → negative example recorded → retrain
 *
 *  All three NNs are trained offline:
 *   Intent  - seed corpus + Claude-confirmed examples + RL corrections
 *   Gaze    - 9-point calibration sequence (regression)
 *   Gesture - 2-second pose samples per class (classification)
 */
import * as tf from '@tensorflow/tfjs';
import {
  FaceLandmarker, HandLandmarker, FilesetResolver,
  type FaceLandmarkerResult, type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import pretrainedIntentModel from './intent-model.json';
import { routeExplicitDesktopIntent, stripAriaWakeWord } from '../../../src/shared/intent-rules';
import { VOICE_TRAINING_PROMPTS } from '../../../src/shared/voice-training-prompts';
import { wordErrorRate } from '../../../src/shared/transcript-metrics';
import { formatTranscriptTimestamp } from '../../../src/shared/transcript-timestamp';
import {
  EYE_STATES,
  classifyEyeState,
  trainEyeWinkModel,
  type EyeFeatures,
  type EyeState,
  type EyeWinkModel,
} from '../../../src/shared/eye-wink-model';

/* ─── bridge (preload) ─── */
declare const ariaDesktop: {
  openUrl:       (url: string) => Promise<void>;
  writeClipboard:(text: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  startTimer:    (seconds: number, label: string) => Promise<number>;
  hideWindow:    () => Promise<void>;
  minimizeWindow:() => Promise<void>;
  setPanelPinned:(pinned: boolean) => Promise<void>;
  resizeWindow:  (height: number) => Promise<number>;
  getSettings:   () => Promise<Record<string, unknown>>;
  saveSettings:  (s: Record<string, unknown>) => Promise<void>;
  saveVoiceTrainingSample: (sample: { audio: Uint8Array; mimeType: string; prompt: string; spokenText: string; promptIndex: number }) =>
    Promise<{ count: number; file: string }>;
  openVoiceTrainingFolder: () => Promise<string>;
  startCameraFallback: () => Promise<boolean>;
  stopCameraFallback: () => Promise<void>;
  log:            (event: string, details?: Record<string, unknown>) => void;
  moveCursor:    (pos: { x: number; y: number; visible: boolean; state?: string; dwell?: number; clicking?: boolean }) => void;
  onActivate:    (cb: () => void) => void;
  onRlReward:    (cb: () => void) => void;
  onRlPunish:    (cb: () => void) => void;
  onOpenVoiceTraining: (cb: () => void) => void;
  onOpenEyeTraining: (cb: () => void) => void;
  onOpenHandTraining: (cb: () => void) => void;
  onCameraFallbackFrame: (cb: (frame: { width: number; height: number; data: Uint8Array }) => void) => void;
  onCameraFallbackError: (cb: (error: string) => void) => void;
};

/* ─── DOM ─── */
const logoDot      = document.getElementById('logo-dot')!;
const overlay      = document.getElementById('overlay') as HTMLDivElement;
const statusText   = document.getElementById('status-text')!;
const transcriptEl = document.getElementById('transcript')!;
const resultEl     = document.getElementById('result')!;
const cameraPanel  = document.getElementById('camera-panel')!;
const camVideo     = document.getElementById('cam-video') as HTMLVideoElement;
const camCanvas    = document.getElementById('cam-canvas') as HTMLCanvasElement;
const camLabel     = document.getElementById('cam-label')!;
const calOverlay   = document.getElementById('cal-overlay')!;
const calDot       = document.getElementById('cal-dot') as HTMLDivElement;
const calText      = document.getElementById('cal-text')!;
const eyeTrainingOverlay = document.getElementById('eye-training-overlay')!;
const eyeTrainingPreview = document.getElementById('eye-training-preview') as HTMLCanvasElement;
const eyeTrainingInstruction = document.getElementById('eye-training-instruction')!;
const eyeTrainingProgress = document.getElementById('eye-training-progress') as HTMLProgressElement;
const eyeTrainingStatus = document.getElementById('eye-training-status')!;
const eyeTrainingCapture = document.getElementById('eye-training-capture') as HTMLButtonElement;
const eyeTrainingCancel = document.getElementById('eye-training-cancel') as HTMLButtonElement;
const gestOverlay  = document.getElementById('gest-overlay')!;
const gestPreview = document.getElementById('gest-preview') as HTMLCanvasElement;
const gestInstruction = document.getElementById('gest-instruction')!;
const gestLabel    = document.getElementById('gest-label')!;
const gestProgress = document.getElementById('gest-progress')!;
const gestCapture = document.getElementById('gest-capture') as HTMLButtonElement;
const gestClose    = document.getElementById('gest-close') as HTMLButtonElement;
const speakBtn     = document.getElementById('speak-btn') as HTMLButtonElement;
const alwaysListenBtn = document.getElementById('always-listen-btn') as HTMLButtonElement;
const ttsBtn       = document.getElementById('tts-btn') as HTMLButtonElement;
const pinPanelBtn  = document.getElementById('pin-panel-btn') as HTMLButtonElement;
const cameraToggleBtn = document.getElementById('camera-toggle-btn') as HTMLButtonElement;
const voiceTrainingBtn = document.getElementById('voice-training-btn') as HTMLButtonElement;
const voiceTrainingOverlay = document.getElementById('voice-training-overlay') as HTMLDivElement;
const voiceTrainingProgress = document.getElementById('voice-training-progress')!;
const voiceTrainingPrompt = document.getElementById('voice-training-prompt')!;
const voiceTrainingStatus = document.getElementById('voice-training-status')!;
const voiceTrainingHeard = document.getElementById('voice-training-heard')!;
const voiceTrainingActual = document.getElementById('voice-training-actual') as HTMLTextAreaElement;
const voiceTrainingRecord = document.getElementById('voice-training-record') as HTMLButtonElement;
const voiceTrainingStop = document.getElementById('voice-training-stop') as HTMLButtonElement;
const voiceTrainingSave = document.getElementById('voice-training-save') as HTMLButtonElement;
const voiceTrainingNext = document.getElementById('voice-training-next') as HTMLButtonElement;
const voiceTrainingFolder = document.getElementById('voice-training-folder') as HTMLButtonElement;
const voiceTrainingDone = document.getElementById('voice-training-done') as HTMLButtonElement;
const inputMethodSelect = document.getElementById('input-method') as HTMLSelectElement;
const microphoneDeviceSelect = document.getElementById('microphone-device') as HTMLSelectElement;
const microphoneWaveforms = Array.from(document.querySelectorAll<HTMLElement>('.mic-waveform'));
const typedCommandRow = document.getElementById('typed-command-row') as HTMLDivElement;
const commandInput = document.getElementById('command-input') as HTMLInputElement;
const runCommandBtn = document.getElementById('run-command-btn') as HTMLButtonElement;
const trainNNBtn   = document.getElementById('train-nn-btn') as HTMLButtonElement;
const calibrateBtn = document.getElementById('calibrate-btn') as HTMLButtonElement;
const trainWinkBtn = document.getElementById('train-wink-btn') as HTMLButtonElement;
const trainGestBtn = document.getElementById('train-gesture-btn') as HTMLButtonElement;
const apiKeyInput  = document.getElementById('api-key-input') as HTMLInputElement;
const minimizeBtn  = document.getElementById('minimize-btn') as HTMLButtonElement;
const closeBtn     = document.getElementById('close-btn') as HTMLButtonElement;
const modePills    = document.querySelectorAll<HTMLElement>('.mode-pill');

/* ══════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════ */

const VOCAB_SIZE = 256; const EMBED_DIM = 16; const SEQ_LEN = 12;
const INTENT_CLASSES = [
  'click','scroll','navigate','read_aloud','summarize','find_on_page','translate',
  'zoom_page','tab_action','browser_nav','bookmark_page','type_into','submit_form',
  'copy_to_clipboard','auto_scroll','focus_timer','shopping_list','media_control',
  'highlight','none',
] as const;
type IntentClass = typeof INTENT_CLASSES[number];
const NUM_INTENT = INTENT_CLASSES.length;


const GESTURE_CLASSES = ['point','pinch','open_palm','fist','peace','thumbs_up','thumbs_down','none'] as const;
type GestureClass = typeof GESTURE_CLASSES[number];
const NUM_GESTURE = GESTURE_CLASSES.length;
const HAND_IN = 63; const GAZE_IN = 5;

// Gesture → voice command string (drives the intent classifier)
const GESTURE_COMMANDS: Partial<Record<GestureClass, string>> = {
  pinch:      'click',
  open_palm:  'stop',
  fist:       'summarize',
  peace:      'zoom in',
  thumbs_up:  'confirm',
  thumbs_down:'cancel',
};
const GESTURE_INSTRUCTIONS: Record<GestureClass, string> = {
  point: 'Extend only your index finger and keep the other fingers folded.',
  pinch: 'Touch your thumb tip to your index fingertip.',
  open_palm: 'Show an open palm with all fingers comfortably spread.',
  fist: 'Close your hand into a relaxed fist.',
  peace: 'Raise your index and middle fingers in a V shape.',
  thumbs_up: 'Make a clear thumbs-up gesture.',
  thumbs_down: 'Make a clear thumbs-down gesture.',
  none: 'Hold a relaxed neutral hand that is not one of the other gestures.',
};

/* ══════════════════════════════════════════════
   VOCABULARY
   ══════════════════════════════════════════════ */

const VOCAB_WORDS = [
  '<PAD>','<UNK>','click','tap','press','scroll','go','navigate','open','close','type',
  'read','find','search','highlight','select','copy','paste','submit','zoom','translate',
  'summarize','bookmark','save','play','pause','mute','unmute','back','forward','reload',
  'refresh','stop','start','resume','dictate','annotate','focus','add','clear','export',
  'check','show','hide','toggle','switch','download','write','enter','hit','move',
  'increase','decrease','lower','raise','make','set','tell','give',
  'page','tab','link','button','form','field','input','text','image','video','audio',
  'music','menu','window','browser','site','website','url','address','bar','article',
  'heading','list','item','element','outline','timer','pomodoro','shopping','price',
  'product','cart','volume','fullscreen','caption','subtitle','speed','history','settings',
  'section','paragraph','word','sentence','selection','clipboard',
  'up','down','left','right','top','bottom','next','previous','prev','first','last',
  'beginning','end','middle','above','below','here',
  'this','the','a','an','my','that','these','those','to','for','in','on','at','of',
  'with','from','into','onto','new','current','active','selected','all','every','some',
  'please','bigger','smaller','faster','slower','louder','quieter','little','more','less',
  'big','small','fast','slow','loud','quiet','auto',
  'english','spanish','french','german','chinese','japanese','arabic','portuguese','italian','russian','korean',
  'one','two','three','five','ten','fifteen','twenty','thirty','minutes','min','seconds','hours',
  'aloud','automatically','summary','explain','answer','question','definition','translation',
  'description','mode','help','me','can','could','would','should','want','need',
  'cancel','undo','redo','again','repeat','never','always','detect','tool','feature',
];
const VOCAB_MAP = new Map(VOCAB_WORDS.map((w, i) => [w, i]));

function tokenise(cmd: string): number[] {
  const words = cmd.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
  const p = new Array<number>(SEQ_LEN).fill(0);
  words.slice(0, SEQ_LEN).forEach((w, i) => { p[i] = VOCAB_MAP.get(w) ?? 1; });
  return p;
}

/* ══════════════════════════════════════════════
   MODEL UTILITIES
   ══════════════════════════════════════════════ */

type W = { shape: number[]; data: number[] };
type IntentTrainingExample = { command: string; actionType: string; isCorrect?: boolean };
type IntentModelArtifact = {
  version: number;
  weights: W[];
  examples: IntentTrainingExample[];
  metrics: { trainingAccuracy: number; validationAccuracy: number };
};
const PRETRAINED_INTENT = pretrainedIntentModel as unknown as IntentModelArtifact;
const PRETRAINED_INTENT_CACHE_VERSION = [
  PRETRAINED_INTENT.version,
  PRETRAINED_INTENT.examples.length,
  PRETRAINED_INTENT.metrics.validationAccuracy.toFixed(6),
].join(':');
const INTENT_CONFIDENCE_THRESHOLD = Math.max(
  0.35,
  Math.min(0.65, PRETRAINED_INTENT.metrics.validationAccuracy),
);

async function saveModel(m: tf.LayersModel, key: string): Promise<void> {
  const ws = m.getWeights();
  const s: W[] = await Promise.all(ws.map(async (w) => ({ shape: w.shape, data: Array.from(await w.data<'float32'>()) })));
  ws.forEach((w) => w.dispose());
  localStorage.setItem(key, JSON.stringify(s));
}

async function loadModel(m: tf.LayersModel, key: string): Promise<boolean> {
  const raw = localStorage.getItem(key);
  if (!raw) return false;
  const s = JSON.parse(raw) as W[];
  return applyWeights(m, s);
}

function applyWeights(m: tf.LayersModel, s: W[]): boolean {
  const ts = s.map(({ shape, data }) => tf.tensor(data, shape));
  try { m.setWeights(ts); return true; } catch { return false; }
  finally { ts.forEach((t) => t.dispose()); }
}

/* ══════════════════════════════════════════════
   INTENT NN (voice command → action class)
   ══════════════════════════════════════════════ */

let intentModel: tf.LayersModel | null = null;
let intentReady = false;
const IW_KEY = 'aria_intent_weights';
const IW_VERSION_KEY = 'aria_intent_model_version';
const IE_KEY = 'aria_intent_examples';

function buildIntentModel(): tf.LayersModel {
  const m = tf.sequential({ layers: [
    tf.layers.embedding({ inputDim: VOCAB_SIZE, outputDim: EMBED_DIM, inputLength: SEQ_LEN }),
    tf.layers.globalAveragePooling1d(),
    tf.layers.dense({ units: 48, activation: 'relu' }),
    tf.layers.dropout({ rate: 0.2 }),
    tf.layers.dense({ units: NUM_INTENT, activation: 'softmax' }),
  ]});
  m.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  return m;
}

async function trainIntentModel(extra: Array<{ command: string; actionType: string; isCorrect?: boolean }>): Promise<number> {
  if (!intentModel) intentModel = buildIntentModel();
  const all = [...PRETRAINED_INTENT.examples, ...extra];
  const xArr = all.map((e) => tokenise(e.command));
  const yArr = all.map((e) => {
    const idx = INTENT_CLASSES.indexOf(e.actionType as IntentClass);
    const v = new Array<number>(NUM_INTENT).fill(0);
    const label = idx >= 0 ? idx : NUM_INTENT - 1;
    if (e.isCorrect === false) {
      v.fill(1 / (NUM_INTENT - 1));
      v[label] = 0;
    } else {
      v[label] = 1;
    }
    return v;
  });
  // Upweight negative examples (user corrections) to focus on avoiding wrong predictions
  const weights = all.map((e) => (e.isCorrect === false ? 5.0 : 1.0));

  // Auto-tune epochs: scale from 40 to 200 based on dataset size
  const autoEpochs = Math.min(200, Math.max(40, Math.ceil(all.length * 0.15)));
  const batchSize = Math.min(32, Math.max(4, Math.floor(all.length / 4)));

  const xs = tf.tensor2d(xArr, [all.length, SEQ_LEN]);
  const weightedTargets = yArr.map((target, i) => target.map((value) => value * weights[i]));
  const ys = tf.tensor2d(weightedTargets, [all.length, NUM_INTENT]);
  // Use shuffle: false for reproducibility by default
  const hist = await intentModel.fit(xs, ys, { epochs: autoEpochs, batchSize, shuffle: false, verbose: 0, validationSplit: 0.2 });
  xs.dispose(); ys.dispose();
  await saveModel(intentModel, IW_KEY);
  localStorage.setItem(IW_VERSION_KEY, PRETRAINED_INTENT_CACHE_VERSION);
  intentReady = true;
  const acc = (hist.history['acc'] ?? hist.history['accuracy']) as number[];
  return acc[acc.length - 1] ?? 0;
}

async function classifyIntent(cmd: string): Promise<{ actionType: string; confidence: number } | null> {
  if (!intentModel || !intentReady) return null;
  const inp = tf.tensor2d([tokenise(cmd)], [1, SEQ_LEN]);
  const pred = intentModel.predict(inp) as tf.Tensor2D;
  const probs = await pred.data<'float32'>();
  inp.dispose(); pred.dispose();
  let mi = 0; let mp = 0;
  for (let i = 0; i < probs.length; i++) { if (probs[i] > mp) { mp = probs[i]; mi = i; } }
  return { actionType: INTENT_CLASSES[mi], confidence: mp };
}

function getStoredVoiceExamples(): Array<{ command: string; actionType: string; isCorrect?: boolean }> {
  try {
    const raw = JSON.parse(localStorage.getItem(IE_KEY) ?? '[]') as Array<{ command: string; actionType: string; isCorrect?: boolean }>;
    return raw.map(e => ({ ...e, isCorrect: e.isCorrect !== false })); // default to true for backward compat
  } catch { return []; }
}

function storeVoiceExample(command: string, actionType: string, isCorrect = true): void {
  const e = getStoredVoiceExamples();
  e.push({ command, actionType, isCorrect });
  localStorage.setItem(IE_KEY, JSON.stringify(e.slice(-2000)));
}

/* ══════════════════════════════════════════════
   GAZE REGRESSION NN (iris/head → screen coords)
   ══════════════════════════════════════════════ */

let gazeModel: tf.LayersModel | null = null;
let gazeReady = false;
const GW_KEY = 'aria_gaze_weights';
const GC_KEY = 'aria_gaze_cal';
let calData: Array<{ features: number[]; target: [number, number] }> = [];

function buildGazeModel(): tf.LayersModel {
  const m = tf.sequential({ layers: [
    tf.layers.dense({ inputShape: [GAZE_IN], units: 32, activation: 'relu' }),
    tf.layers.dense({ units: 16, activation: 'relu' }),
    tf.layers.dense({ units: 2, activation: 'sigmoid' }),
  ]});
  m.compile({ optimizer: tf.train.adam(0.01), loss: 'meanSquaredError' });
  return m;
}

async function trainGazeModel(): Promise<void> {
  if (calData.length < 5) { setStatus('Need ≥5 calibration points'); return; }
  if (!gazeModel) gazeModel = buildGazeModel();
  const xs = tf.tensor2d(calData.map((d) => d.features), [calData.length, GAZE_IN]);
  const ys = tf.tensor2d(calData.map((d) => d.target), [calData.length, 2]);
  await gazeModel.fit(xs, ys, { epochs: 200, verbose: 0 });
  xs.dispose(); ys.dispose();
  await saveModel(gazeModel, GW_KEY);
  gazeReady = true;
  localStorage.setItem(GC_KEY, JSON.stringify(calData));
}

async function predictGaze(features: number[]): Promise<[number, number] | null> {
  if (!gazeModel || !gazeReady) return null;
  const inp = tf.tensor2d([features], [1, GAZE_IN]);
  const pred = gazeModel.predict(inp) as tf.Tensor2D;
  const d = await pred.data<'float32'>();
  inp.dispose(); pred.dispose();
  return [d[0], d[1]];
}

// 9-point calibration
const CAL_POINTS: Array<[number, number]> = [
  [0.1,0.1],[0.5,0.1],[0.9,0.1],[0.1,0.5],[0.5,0.5],
  [0.9,0.5],[0.1,0.9],[0.5,0.9],[0.9,0.9],
];
let calIdx = 0; let calSamples: number[][] = []; let calRunning = false;

function startCalibration(): void {
  if (calRunning) return;
  calRunning = true; calIdx = 0; calSamples = []; calData = [];
  calOverlay.classList.add('visible'); showCalPoint();
}

function showCalPoint(): void {
  if (calIdx >= CAL_POINTS.length) { void finishCalibration(); return; }
  const [nx, ny] = CAL_POINTS[calIdx];
  const { width, height } = calOverlay.getBoundingClientRect();
  calDot.style.left = `${nx * width}px`; calDot.style.top = `${ny * height}px`;
  calText.textContent = `Look at the dot (${calIdx + 1}/${CAL_POINTS.length})`;
  calSamples = [];
  const id = setInterval(() => { if (latestFaceFeatures) calSamples.push([...latestFaceFeatures]); }, 50);
  setTimeout(() => {
    clearInterval(id);
    if (calSamples.length > 0) {
      const avg = new Array<number>(GAZE_IN).fill(0);
      calSamples.forEach((s) => s.forEach((v, i) => { avg[i] += v / calSamples.length; }));
      calData.push({ features: avg, target: CAL_POINTS[calIdx] });
    }
    calIdx++; showCalPoint();
  }, 1200);
}

async function finishCalibration(): Promise<void> {
  calRunning = false; calOverlay.classList.remove('visible');
  setStatus('Training gaze model…');
  await trainGazeModel(); setStatus('Eye tracking calibrated!');
}

let latestFaceFeatures: number[] | null = null;

const EYE_WINK_MODEL_KEY = 'aria_eye_wink_model_v1';
const EYE_TRAINING_STAGES: Array<{ state: EyeState; instruction: string }> = [
  { state: 'open', instruction: 'Keep both eyes naturally open. Relax your eyelids.' },
  { state: 'both_closed', instruction: 'Close both eyes gently and keep your face still.' },
  { state: 'left_wink', instruction: 'Wink only your LEFT eye. Keep your right eye naturally open.' },
  { state: 'right_wink', instruction: 'Wink only your RIGHT eye. Keep your left eye naturally open.' },
];
let eyeWinkModel: EyeWinkModel | null = null;
let latestEyeFeatures: EyeFeatures | null = null;
let eyeTrainingActive = false;
let eyeTrainingStage = -1;
let eyeTrainingCollectAfter = 0;
let eyeTrainingCollecting = false;
function emptyEyeTrainingSamples(): Record<EyeState, EyeFeatures[]> {
  return { open: [], both_closed: [], left_wink: [], right_wink: [] };
}
let eyeTrainingSamples = emptyEyeTrainingSamples();
let eyeTrainingTimer: ReturnType<typeof setInterval> | null = null;
let winkCandidate: EyeState | 'uncertain' = 'uncertain';
let winkCandidateSince = 0;
let winkLatched = false;
let winkCooldownUntil = 0;
let rendererInitialized = false;
let eyeTrainingRequested = false;
let handTrainingRequested = false;

function closeEyeTraining(): void {
  if (eyeTrainingTimer) clearInterval(eyeTrainingTimer);
  eyeTrainingTimer = null;
  eyeTrainingActive = false;
  eyeTrainingCollecting = false;
  eyeTrainingStage = -1;
  eyeTrainingPreview.getContext('2d')?.clearRect(0, 0, eyeTrainingPreview.width, eyeTrainingPreview.height);
  eyeTrainingOverlay.classList.remove('visible');
  eyeTrainingCancel.textContent = 'Cancel';
}

function finishEyeTraining(): void {
  if (eyeTrainingTimer) clearInterval(eyeTrainingTimer);
  eyeTrainingTimer = null;
  eyeTrainingActive = false;
  try {
    eyeWinkModel = trainEyeWinkModel(eyeTrainingSamples);
    localStorage.setItem(EYE_WINK_MODEL_KEY, JSON.stringify(eyeWinkModel));
    trainWinkBtn.textContent = 'Retrain Winks';
    eyeTrainingInstruction.textContent = 'Personal wink model saved.';
    eyeTrainingStatus.textContent = 'Natural blinks are kept separate from left and right winks.';
    eyeTrainingProgress.value = 1;
    eyeTrainingCapture.disabled = true;
    eyeTrainingCancel.textContent = 'Done';
    ariaDesktop.log('eye-wink-training-end', {
      samples: Object.fromEntries(EYE_STATES.map((state) => [state, eyeTrainingSamples[state].length])),
    });
  } catch (error) {
    eyeWinkModel = null;
    eyeTrainingInstruction.textContent = 'Training needs another pass.';
    eyeTrainingStatus.textContent = error instanceof Error ? error.message : String(error);
    eyeTrainingCancel.textContent = 'Close';
    eyeTrainingCapture.disabled = true;
    ariaDesktop.log('eye-wink-training-error', { error: eyeTrainingStatus.textContent });
  }
}

function beginEyeTrainingStage(index: number): void {
  if (index >= EYE_TRAINING_STAGES.length) {
    finishEyeTraining();
    return;
  }
  eyeTrainingStage = index;
  const stage = EYE_TRAINING_STAGES[index];
  eyeTrainingCollecting = false;
  eyeTrainingInstruction.textContent = stage.instruction;
  eyeTrainingStatus.textContent = `Step ${index + 1} of ${EYE_TRAINING_STAGES.length}: press Capture when ready.`;
  eyeTrainingProgress.value = index / EYE_TRAINING_STAGES.length;
  eyeTrainingCapture.disabled = false;
  eyeTrainingCapture.textContent = `Capture ${stage.state.replace('_', ' ')}`;
}

function captureEyeTrainingStage(): void {
  if (!eyeTrainingActive || eyeTrainingStage < 0 || eyeTrainingTimer) return;
  const index = eyeTrainingStage;
  const state = EYE_TRAINING_STAGES[index].state;
  eyeTrainingSamples[state] = [];
  eyeTrainingCapture.disabled = true;
  const started = performance.now();
  const preparationEnds = started + 2000;
  const collectionEnds = preparationEnds + 2500;
  eyeTrainingTimer = setInterval(() => {
    const now = performance.now();
    if (now < preparationEnds) {
      eyeTrainingStatus.textContent = `Get ready: ${Math.max(1, Math.ceil((preparationEnds - now) / 1000))}`;
      return;
    }
    if (!eyeTrainingCollecting) {
      eyeTrainingCollecting = true;
      eyeTrainingCollectAfter = now;
    }
    const collectionProgress = Math.min(1, (now - preparationEnds) / (collectionEnds - preparationEnds));
    eyeTrainingProgress.value = (index + collectionProgress) / EYE_TRAINING_STAGES.length;
    eyeTrainingStatus.textContent = 'Hold this expression.';
    if (now >= collectionEnds) {
      if (eyeTrainingTimer) clearInterval(eyeTrainingTimer);
      eyeTrainingTimer = null;
      eyeTrainingCollecting = false;
      if (eyeTrainingSamples[state].length < 12) {
        eyeTrainingStatus.textContent = 'Face was not clear enough. Adjust lighting and capture this step again.';
        eyeTrainingCapture.disabled = false;
      } else {
        beginEyeTrainingStage(index + 1);
      }
    }
  }, 80);
}

async function startEyeTraining(): Promise<void> {
  if (eyeTrainingActive) return;
  try {
    await initMediaPipe();
    await startVision();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Eye training failed: ${message}`);
    ariaDesktop.log('eye-wink-training-error', { error: message });
    return;
  }
  if (!camStream && !fallbackCameraActive) {
    setStatus('Camera is unavailable for wink training');
    return;
  }
  eyeTrainingSamples = emptyEyeTrainingSamples();
  eyeTrainingActive = true;
  eyeTrainingOverlay.classList.add('visible');
  ariaDesktop.moveCursor({ x: cursorX, y: cursorY, visible: false });
  ariaDesktop.log('eye-wink-training-start');
  beginEyeTrainingStage(0);
}

async function openEyeTraining(): Promise<void> {
  try {
    await setMode('eye');
    await saveCurrentSettings();
    await startEyeTraining();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Eye training failed: ${message}`);
    ariaDesktop.log('eye-wink-training-error', { error: message });
  }
}

function requestEyeTraining(): void {
  eyeTrainingRequested = true;
  if (rendererInitialized) void openEyeTraining();
}

async function openHandTraining(): Promise<void> {
  try {
    await setMode('hand');
    await saveCurrentSettings();
    await startGestureTraining();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Hand training failed: ${message}`);
    ariaDesktop.log('hand-training-error', { error: message });
  }
}

function requestHandTraining(): void {
  handTrainingRequested = true;
  if (rendererInitialized) void openHandTraining();
}

function processPersonalWink(features: EyeFeatures): void {
  if (!eyeWinkModel || eyeTrainingActive || calRunning) return;
  const classification = classifyEyeState(eyeWinkModel, features);
  const now = performance.now();
  if (classification.state !== winkCandidate) {
    winkCandidate = classification.state;
    winkCandidateSince = now;
  }
  if (classification.state === 'open') winkLatched = false;
  const isWink = classification.state === 'left_wink' || classification.state === 'right_wink';
  if (!isWink || winkLatched || now < winkCooldownUntil || now - winkCandidateSince < 220) return;
  winkLatched = true;
  winkCooldownUntil = now + 700;
  const button = classification.state === 'left_wink' ? 'left' : 'right';
  ariaDesktop.moveCursor({ x: cursorX, y: cursorY, visible: true, state: 'eye', dwell: 0, clicking: true });
  setResult(`${button === 'left' ? 'Left' : 'Right'} wink detected at (${Math.round(cursorX)}, ${Math.round(cursorY)}); system pointer unchanged`);
  ariaDesktop.log('eye-wink-detected', { button, confidence: Number(classification.confidence.toFixed(3)) });
}

/* ══════════════════════════════════════════════
   GESTURE CLASSIFIER NN (hand landmarks → gesture)
   ══════════════════════════════════════════════ */

let gestureModel: tf.LayersModel | null = null;
let gestureReady = false;
let gestureExamples: Array<{ features: number[]; label: number }> = [];
let latestHandFeatures: number[] | null = null;
let trainingGesture = false;
let gestureTrainingIndex = -1;
let gestureTrainingCollecting = false;
let gestureTrainingTimer: ReturnType<typeof setInterval> | null = null;
const GEW_KEY = 'aria_gesture_weights';
const GEE_KEY = 'aria_gesture_examples';

function buildGestureModel(): tf.LayersModel {
  const m = tf.sequential({ layers: [
    tf.layers.dense({ inputShape: [HAND_IN], units: 64, activation: 'relu' }),
    tf.layers.dropout({ rate: 0.3 }),
    tf.layers.dense({ units: 32, activation: 'relu' }),
    tf.layers.dense({ units: NUM_GESTURE, activation: 'softmax' }),
  ]});
  m.compile({ optimizer: 'adam', loss: 'sparseCategoricalCrossentropy', metrics: ['accuracy'] });
  return m;
}

function normaliseLandmarks(lms: Array<{ x: number; y: number; z: number }>): number[] {
  const w = lms[0]; const flat = lms.flatMap((l) => [l.x - w.x, l.y - w.y, l.z - w.z]);
  const mx = Math.max(...flat.map(Math.abs), 1e-6);
  return flat.map((v) => v / mx);
}

async function trainGestureModel(): Promise<void> {
  if (gestureExamples.length < 8) return;
  if (!gestureModel) gestureModel = buildGestureModel();
  const xs = tf.tensor2d(gestureExamples.map((e) => e.features), [gestureExamples.length, HAND_IN]);
  const ys = tf.tensor1d(gestureExamples.map((e) => e.label), 'int32');
  await gestureModel.fit(xs, ys, { epochs: 60, batchSize: Math.min(16, gestureExamples.length), shuffle: true, verbose: 0 });
  xs.dispose(); ys.dispose();
  await saveModel(gestureModel, GEW_KEY);
  gestureReady = true;
  localStorage.setItem(GEE_KEY, JSON.stringify(gestureExamples));
}

async function classifyGesture(features: number[]): Promise<{ gesture: GestureClass; confidence: number } | null> {
  if (!gestureModel || !gestureReady) return null;
  const inp = tf.tensor2d([features], [1, HAND_IN]);
  const pred = gestureModel.predict(inp) as tf.Tensor2D;
  const probs = await pred.data<'float32'>();
  inp.dispose(); pred.dispose();
  let mi = 0; let mp = 0;
  for (let i = 0; i < probs.length; i++) { if (probs[i] > mp) { mp = probs[i]; mi = i; } }
  return { gesture: GESTURE_CLASSES[mi], confidence: mp };
}

function closeGestureTraining(): void {
  if (gestureTrainingTimer) clearInterval(gestureTrainingTimer);
  gestureTrainingTimer = null;
  gestureTrainingCollecting = false;
  trainingGesture = false;
  gestureTrainingIndex = -1;
  gestPreview.getContext('2d')?.clearRect(0, 0, gestPreview.width, gestPreview.height);
  gestOverlay.classList.remove('visible');
  gestClose.textContent = 'Cancel';
}

function beginGestureTrainingStage(index: number): void {
  if (index >= GESTURE_CLASSES.length) {
    void finishGestureTraining();
    return;
  }
  gestureTrainingIndex = index;
  gestureTrainingCollecting = false;
  const gesture = GESTURE_CLASSES[index];
  gestLabel.textContent = gesture.replace(/_/g, ' ').toUpperCase();
  gestInstruction.textContent = GESTURE_INSTRUCTIONS[gesture];
  gestProgress.textContent = `${index + 1} / ${GESTURE_CLASSES.length}: press Capture when ready.`;
  gestCapture.disabled = false;
  gestCapture.textContent = `Capture ${gesture.replace(/_/g, ' ')}`;
}

function captureGestureTrainingStage(): void {
  if (!trainingGesture || gestureTrainingIndex < 0 || gestureTrainingTimer) return;
  const index = gestureTrainingIndex;
  gestureExamples = gestureExamples.filter((example) => example.label !== index);
  gestCapture.disabled = true;
  const started = performance.now();
  const preparationEnds = started + 2000;
  const collectionEnds = preparationEnds + 2500;
  gestureTrainingTimer = setInterval(() => {
    const now = performance.now();
    if (now < preparationEnds) {
      gestProgress.textContent = `Get ready: ${Math.max(1, Math.ceil((preparationEnds - now) / 1000))}`;
      return;
    }
    gestureTrainingCollecting = true;
    gestProgress.textContent = 'Hold this gesture.';
    if (now >= collectionEnds) {
      if (gestureTrainingTimer) clearInterval(gestureTrainingTimer);
      gestureTrainingTimer = null;
      gestureTrainingCollecting = false;
      const sampleCount = gestureExamples.filter((example) => example.label === index).length;
      if (sampleCount < 12) {
        gestProgress.textContent = 'Hand was not clear enough. Adjust the framing and capture again.';
        gestCapture.disabled = false;
      } else {
        beginGestureTrainingStage(index + 1);
      }
    }
  }, 80);
}

async function finishGestureTraining(): Promise<void> {
  gestureTrainingCollecting = false;
  trainingGesture = false;
  gestCapture.disabled = true;
  gestLabel.textContent = 'TRAINING';
  gestInstruction.textContent = 'Fitting your personal hand model.';
  gestProgress.textContent = `${gestureExamples.length} frames collected.`;
  setStatus('Training gesture NN...');
  try {
    await trainGestureModel();
    trainGestBtn.textContent = 'Retrain Hand Controls';
    gestLabel.textContent = 'READY';
    gestInstruction.textContent = 'Index finger moves the ARIA cursor. Pinch produces a selection signal.';
    gestProgress.textContent = `${gestureExamples.length} personal frames saved.`;
    gestClose.textContent = 'Done';
    setStatus(`Hand controls trained - ${gestureExamples.length} examples`);
    ariaDesktop.log('hand-training-end', { examples: gestureExamples.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    gestLabel.textContent = 'RETRY';
    gestProgress.textContent = message;
    gestClose.textContent = 'Close';
    ariaDesktop.log('hand-training-error', { error: message });
  }
}

async function startGestureTraining(): Promise<void> {
  if (trainingGesture) return;
  await initMediaPipe();
  await startVision();
  if (!camStream && !fallbackCameraActive) {
    setStatus('Camera is unavailable for hand training');
    return;
  }
  trainingGesture = true;
  gestureExamples = [];
  gestOverlay.classList.add('visible');
  ariaDesktop.moveCursor({ x: cursorX, y: cursorY, visible: false });
  ariaDesktop.log('hand-training-start');
  beginGestureTrainingStage(0);
}

/* ══════════════════════════════════════════════
   REINFORCEMENT LEARNING FEEDBACK
   ══════════════════════════════════════════════ */

interface LastDecision { command: string; actionType: string; source: string }
let lastDecision: LastDecision | null = null;
let rlPendingRetrain = false;

function onReward(): void {
  if (!lastDecision) { setStatus('No recent action to reward'); return; }
  storeVoiceExample(lastDecision.command, lastDecision.actionType);
  setStatus(`Rewarded "${lastDecision.actionType}" for "${lastDecision.command.slice(0,20)}"`);
  scheduleRetrain();
}

function onPunish(): void {
  if (!lastDecision) { setStatus('No recent action to punish'); return; }
  // Record the wrong prediction as a negative example (isCorrect=false).
  // This trains the model that this command+action pair is incorrect,
  // helping it learn what NOT to predict for similar inputs.
  storeVoiceExample(lastDecision.command, lastDecision.actionType, false);
  setStatus(`Punished: "${lastDecision.command.slice(0,20)}" is not ${lastDecision.actionType}`);
  scheduleRetrain();
}

let retrainTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRetrain(): void {
  if (rlPendingRetrain) return;
  rlPendingRetrain = true;
  if (retrainTimer) clearTimeout(retrainTimer);
  // Micro-retrain 5 s after the last feedback signal
  retrainTimer = setTimeout(async () => {
    setStatus('Auto-retraining intent NN…');
    const acc = await trainIntentModel(getStoredVoiceExamples());
    setStatus(`NN updated — accuracy ${Math.round(acc * 100)}%`);
    rlPendingRetrain = false;
  }, 5000);
}

/* ══════════════════════════════════════════════
   CURSOR OVERLAY (gaze / fingertip → screen coords)
   ══════════════════════════════════════════════ */

let cursorX = 0; let cursorY = 0;
let dwellStart = 0; let dwellActive = false;
const DWELL_MS = 800;

function moveCursor(nx: number, ny: number, state: 'eye' | 'hand'): void {
  const sw = window.screen.width; const sh = window.screen.height;
  cursorX = nx * sw; cursorY = ny * sh;

  if (!dwellActive) {
    ariaDesktop.moveCursor({ x: cursorX, y: cursorY, visible: true, state, dwell: 0 });
    return;
  }
  const elapsed = Date.now() - dwellStart;
  const progress = Math.min(elapsed / DWELL_MS, 1);
  ariaDesktop.moveCursor({ x: cursorX, y: cursorY, visible: true, state, dwell: progress });
  if (progress >= 1) { triggerDwellClick(state); }
}

function triggerDwellClick(state: 'eye' | 'hand'): void {
  dwellActive = false; dwellStart = 0;
  ariaDesktop.moveCursor({ x: cursorX, y: cursorY, visible: true, state, dwell: 0, clicking: true });
  setResult(`Dwell click at (${Math.round(cursorX)}, ${Math.round(cursorY)})`);
  lastDecision = { command: `dwell click at ${Math.round(cursorX)},${Math.round(cursorY)}`, actionType: 'click', source: state };
}

let lastCursorPos: [number, number] = [0, 0];
const DWELL_THRESHOLD_PX = 60;

function updateDwell(sx: number, sy: number): void {
  const dist = Math.hypot(sx - lastCursorPos[0], sy - lastCursorPos[1]);
  if (dist > DWELL_THRESHOLD_PX) {
    lastCursorPos = [sx, sy]; dwellStart = Date.now(); dwellActive = true;
  }
}

/* ══════════════════════════════════════════════
   MEDIAPIPE VISION PIPELINE
   ══════════════════════════════════════════════ */

let faceLandmarker: FaceLandmarker | null = null;
let handLandmarker: HandLandmarker | null = null;
let camStream: MediaStream | null = null;
let visionRunning = false;
let mpReady = false;
let fallbackCameraActive = false;
let fallbackFrameReady = false;
const fallbackFrameCanvas = document.createElement('canvas');
const fallbackFrameContext = fallbackFrameCanvas.getContext('2d')!;

function receiveFallbackCameraFrame(frame: { width: number; height: number; data: Uint8Array }): void {
  if (!fallbackCameraActive || frame.data.byteLength !== frame.width * frame.height * 4) return;
  fallbackFrameCanvas.width = frame.width;
  fallbackFrameCanvas.height = frame.height;
  const pixels = Uint8ClampedArray.from(frame.data);
  fallbackFrameContext.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
  fallbackFrameReady = true;
}

async function initMediaPipe(): Promise<void> {
  if (mpReady) return;
  setStatus('Loading MediaPipe…');
  ariaDesktop.log('vision-model-load-start');
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  );
  [faceLandmarker, handLandmarker] = await Promise.all([
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO', numFaces: 1,
      outputFacialTransformationMatrixes: true, outputFaceBlendshapes: false,
    }),
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 1,
    }),
  ]);
  mpReady = true;
  ariaDesktop.log('vision-model-load-end');
}

async function startVision(): Promise<void> {
  if (visionRunning || !cameraEnabled) return;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
    camVideo.srcObject = camStream; await camVideo.play();
    cameraPanel.classList.add('visible'); visionRunning = true;
    requestAnimationFrame(visionLoop);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ariaDesktop.log('vision-camera-error', { error: message });
    const missingDevice = e instanceof DOMException
      ? e.name === 'NotFoundError'
      : /not found|no device/i.test(message);
    if (missingDevice && await ariaDesktop.startCameraFallback()) {
      fallbackCameraActive = true;
      fallbackFrameReady = false;
      camVideo.style.display = 'none';
      cameraPanel.classList.add('visible');
      visionRunning = true;
      setStatus('Using libcamera fallback');
      requestAnimationFrame(visionLoop);
      return;
    }
    setStatus(`Camera error: ${message}`);
  }
}

function stopVision(): void {
  visionRunning = false;
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null; camVideo.srcObject = null;
  if (fallbackCameraActive) void ariaDesktop.stopCameraFallback();
  fallbackCameraActive = false;
  fallbackFrameReady = false;
  camVideo.style.display = '';
  cameraPanel.classList.remove('visible');
  ariaDesktop.moveCursor({ x: 0, y: 0, visible: false });
}

async function visionLoop(): Promise<void> {
  if (!visionRunning) return;
  const now = performance.now();
  const ctx = camCanvas.getContext('2d')!;
  const visionSource = fallbackCameraActive ? fallbackFrameCanvas : camVideo;
  const sourceWidth = fallbackCameraActive ? fallbackFrameCanvas.width : camVideo.videoWidth;
  const sourceHeight = fallbackCameraActive ? fallbackFrameCanvas.height : camVideo.videoHeight;
  if (!sourceWidth || !sourceHeight || (fallbackCameraActive && !fallbackFrameReady)) {
    requestAnimationFrame(visionLoop);
    return;
  }
  camCanvas.width = sourceWidth; camCanvas.height = sourceHeight;
  ctx.clearRect(0, 0, camCanvas.width, camCanvas.height);
  if (fallbackCameraActive) ctx.drawImage(fallbackFrameCanvas, 0, 0);

  if (eyeTrainingActive) {
    const preview = eyeTrainingPreview.getContext('2d')!;
    preview.clearRect(0, 0, eyeTrainingPreview.width, eyeTrainingPreview.height);
    preview.drawImage(visionSource, 0, 0, eyeTrainingPreview.width, eyeTrainingPreview.height);
  }
  if (trainingGesture) {
    const preview = gestPreview.getContext('2d')!;
    preview.clearRect(0, 0, gestPreview.width, gestPreview.height);
    preview.drawImage(visionSource, 0, 0, gestPreview.width, gestPreview.height);
  }

  if (activeMode === 'eye' && faceLandmarker) {
    const r: FaceLandmarkerResult = faceLandmarker.detectForVideo(visionSource, now);
    await processFaceResult(r, ctx);
  } else if (activeMode === 'hand' && handLandmarker) {
    const r: HandLandmarkerResult = handLandmarker.detectForVideo(visionSource, now);
    await processHandResult(r, ctx);
  }
  requestAnimationFrame(visionLoop);
}

/* ─── Eye / face processing ─── */

function eyeAspectRatio(
  landmarks: Array<{ x: number; y: number }>,
  [outer, upperOuter, upperInner, inner, lowerInner, lowerOuter]: [number, number, number, number, number, number],
): number {
  const distance = (a: number, b: number) => Math.hypot(
    landmarks[a].x - landmarks[b].x,
    landmarks[a].y - landmarks[b].y,
  );
  return (distance(upperOuter, lowerOuter) + distance(upperInner, lowerInner))
    / Math.max(0.0001, 2 * distance(outer, inner));
}

async function processFaceResult(result: FaceLandmarkerResult, ctx: CanvasRenderingContext2D): Promise<void> {
  if (!result.faceLandmarks?.length) { latestFaceFeatures = null; return; }
  const lms = result.faceLandmarks[0];
  const rIris = lms[468]; const lIris = lms[473];
  const rOut = lms[33];  const rIn  = lms[133];
  const lOut = lms[263]; const lIn  = lms[362];
  const rW = Math.abs(rOut.x - rIn.x) || 0.01;
  const lW = Math.abs(lOut.x - lIn.x) || 0.01;
  const irisX = ((rIris.x - (rOut.x + rIn.x) / 2) / rW + (lIris.x - (lOut.x + lIn.x) / 2) / lW) / 2;
  const irisY = ((rIris.y - lms[159].y) + (lIris.y - lms[386].y)) / 2;
  // Landmark naming follows the user's left/right side, not the mirrored preview.
  const leftEyeAspectRatio = eyeAspectRatio(lms, [362, 385, 387, 263, 373, 380]);
  const rightEyeAspectRatio = eyeAspectRatio(lms, [33, 160, 158, 133, 153, 144]);
  latestEyeFeatures = [leftEyeAspectRatio, rightEyeAspectRatio];
  if (eyeTrainingActive && eyeTrainingCollecting && eyeTrainingStage >= 0 && performance.now() >= eyeTrainingCollectAfter) {
    const state = EYE_TRAINING_STAGES[eyeTrainingStage].state;
    eyeTrainingSamples[state].push([...latestEyeFeatures]);
  } else {
    processPersonalWink(latestEyeFeatures);
  }
  let roll = 0; let pitch = 0; let yaw = 0;
  if (result.facialTransformationMatrixes?.length) {
    const m = result.facialTransformationMatrixes[0].data;
    pitch = Math.atan2(-m[9], m[10]); yaw = Math.atan2(m[8], Math.sqrt(m[9]**2 + m[10]**2)); roll = Math.atan2(-m[4], m[0]);
  }
  latestFaceFeatures = [irisX, irisY, roll, pitch, yaw];

  const W = camCanvas.width; const H = camCanvas.height;
  ctx.fillStyle = '#2b7fff';
  [[rIris.x * W, rIris.y * H], [lIris.x * W, lIris.y * H]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  });

  if (gazeReady && !eyeTrainingActive) {
    const pos = await predictGaze(latestFaceFeatures);
    if (pos) {
      const sx = pos[0] * window.screen.width;
      const sy = pos[1] * window.screen.height;
      updateDwell(sx, sy);
      moveCursor(pos[0], pos[1], 'eye');
      camLabel.textContent = `gaze (${Math.round(pos[0]*100)}%, ${Math.round(pos[1]*100)}%)`;
    }
  } else if (!eyeTrainingActive) {
    camLabel.textContent = 'eye — calibrate for cursor control';
  }
}

/* ─── Hand / gesture processing ─── */

let pinchWasActive = false;
let pinchCandidateSince = 0;
let gestureCandidate: GestureClass | null = null;
let gestureCandidateSince = 0;
let gestureLatched = false;
let gestureCooldownUntil = 0;

async function processHandResult(result: HandLandmarkerResult, ctx: CanvasRenderingContext2D): Promise<void> {
  if (!result.landmarks?.length) {
    latestHandFeatures = null;
    ariaDesktop.moveCursor({ x: cursorX, y: cursorY, visible: false });
    return;
  }
  const lms = result.landmarks[0];
  latestHandFeatures = normaliseLandmarks(lms);

  // Draw skeleton
  const W = camCanvas.width; const H = camCanvas.height;
  ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5;
  [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
   [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
  ].forEach(([a,b]) => {
    ctx.beginPath(); ctx.moveTo(lms[a].x*W, lms[a].y*H); ctx.lineTo(lms[b].x*W, lms[b].y*H); ctx.stroke();
  });

  if (trainingGesture) {
    if (gestureTrainingCollecting && gestureTrainingIndex >= 0) {
      gestureExamples.push({ features: [...latestHandFeatures], label: gestureTrainingIndex });
    }
    return;
  }

  // Fingertip (index finger = landmark 8) drives the cursor position
  const tip = lms[8];
  const nsx = 1 - tip.x; // mirror
  const nsy = tip.y;
  updateDwell(nsx * window.screen.width, nsy * window.screen.height);
  moveCursor(nsx, nsy, 'hand');

  // Detect pinch (thumb tip #4 ↔ index tip #8 distance < threshold)
  const thumb = lms[4];
  const pinchDist = Math.hypot(thumb.x - tip.x, thumb.y - tip.y);
  const isPinching = pinchDist < 0.06;
  const now = performance.now();
  if (isPinching && pinchCandidateSince === 0) pinchCandidateSince = now;
  if (isPinching && !pinchWasActive && now - pinchCandidateSince >= 140) {
    pinchWasActive = true;
    ariaDesktop.moveCursor({ x: cursorX, y: cursorY, visible: true, state: 'hand', dwell: 0, clicking: true });
    setResult(`Pinch detected at (${Math.round(cursorX)}, ${Math.round(cursorY)}); system pointer unchanged`);
    lastDecision = { command: 'pinch click', actionType: 'click', source: 'hand' };
  } else if (!isPinching) {
    pinchWasActive = false;
    pinchCandidateSince = 0;
  }

  // Classify other gestures → voice-style commands
  const gest = await classifyGesture(latestHandFeatures);
  const stableGesture = gest && gest.confidence >= 0.65 ? gest.gesture : null;
  if (stableGesture !== gestureCandidate) {
    gestureCandidate = stableGesture;
    gestureCandidateSince = now;
    gestureLatched = false;
  }
  if (stableGesture === 'none' || stableGesture === null) gestureLatched = false;
  if (gest && stableGesture && stableGesture !== 'none' && stableGesture !== 'point' && stableGesture !== 'pinch') {
    const cmd = GESTURE_COMMANDS[gest.gesture];
    if (cmd && !gestureLatched && now >= gestureCooldownUntil && now - gestureCandidateSince >= 300) {
      gestureLatched = true;
      gestureCooldownUntil = now + 700;
      commitTranscript(`[hand: ${gest.gesture}] ${cmd}`);
      void handleVoiceCommand(cmd);
    }
    camLabel.textContent = `${gest.gesture} (${Math.round(gest.confidence * 100)}%)`;
  } else {
    camLabel.textContent = gestureReady ? `hand (${isPinching ? 'PINCH' : 'open'})` : 'hand — train gestures';
  }
}

/* ══════════════════════════════════════════════
   VOICE CAPTURE
   ══════════════════════════════════════════════ */

interface AriaSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface AriaSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<AriaSpeechRecognitionResult>;
}
interface AriaSpeechRecognitionErrorEvent { readonly error: string }
interface AriaSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: AriaSpeechRecognitionEvent) => void) | null;
  onerror: ((event: AriaSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type AriaSpeechRecognitionConstructor = new () => AriaSpeechRecognition;
type InputMethod = 'offline' | 'browser' | 'text';
type OfflineTranscriber = (audio: Float32Array, options: Record<string, unknown>) =>
  Promise<{ text?: string } | Array<{ text?: string }>>;

let recognition: AriaSpeechRecognition | null = null;
let isListening = false;
let alwaysListening = false;
let ttsEnabled = true;
let panelPinned = false;
let cameraEnabled = true;
let isSpeaking = false;
let storedSettings: Record<string, unknown> = {};
let inputMethod: InputMethod = 'offline';
let microphoneDeviceId = '';
let browserRestartAllowed = true;
let offlineTranscriberPromise: Promise<OfflineTranscriber> | null = null;
let offlineStream: MediaStream | null = null;
let offlineContext: AudioContext | null = null;
let offlineSource: MediaStreamAudioSourceNode | null = null;
let offlineProcessor: ScriptProcessorNode | null = null;
let offlineSilentGain: GainNode | null = null;
const OFFLINE_MIN_SPEECH_THRESHOLD = 0.0007;
const OFFLINE_PRE_ROLL_CHUNKS = 4;
let offlineSpeechChunks: Float32Array[] = [];
let offlinePreRollChunks: Float32Array[] = [];
let offlineSpeechSamples = 0;
let offlineSilenceSamples = 0;
let offlineNoiseFloor = 0.0005;
let offlineSpeechPeak = 0;
let offlineVadWarmupSamples = 0;
let offlineWarmupLevels: number[] = [];
let offlineSegmentThreshold = OFFLINE_MIN_SPEECH_THRESHOLD;
let offlineQueue: Float32Array[] = [];
let offlineProcessing = false;
let stoppingOffline = false;
let offlineStarting = false;
let listeningRequested = false;
let offlineLevelPeak = 0;
let offlineLastLevelLog = 0;
let voiceTrainingActive = false;
let voiceTrainingIndex = 0;
let voiceTrainingRecorder: MediaRecorder | null = null;
let voiceTrainingStream: MediaStream | null = null;
let voiceTrainingChunks: Blob[] = [];
let pendingTrainingAudio: Uint8Array | null = null;
let pendingTrainingMimeType = '';
let waveformContext: AudioContext | null = null;
let waveformSource: MediaStreamAudioSourceNode | null = null;
let waveformAnalyser: AnalyserNode | null = null;
let waveformFrame = 0;
let waveformOwnedStream: MediaStream | null = null;

function updateMicrophoneWaveform(level: number, active = true): void {
  const normalized = Math.max(0, Math.min(1, level));
  const shape = [0.42, 0.68, 0.86, 1, 0.86, 0.68, 0.42];
  microphoneWaveforms.forEach((waveform) => {
    waveform.classList.toggle('active', active);
    waveform.setAttribute('aria-label', active ? 'Microphone active' : 'Microphone inactive');
    Array.from(waveform.children).forEach((bar, index) => {
      const scale = active ? 0.16 + normalized * 0.84 * shape[index] : 0.16;
      (bar as HTMLElement).style.transform = `scaleY(${scale.toFixed(3)})`;
    });
  });
}

function stopWaveformMonitor(): void {
  cancelAnimationFrame(waveformFrame);
  waveformFrame = 0;
  waveformSource?.disconnect();
  waveformAnalyser?.disconnect();
  waveformOwnedStream?.getTracks().forEach((track) => track.stop());
  void waveformContext?.close();
  waveformSource = null;
  waveformAnalyser = null;
  waveformOwnedStream = null;
  waveformContext = null;
  updateMicrophoneWaveform(0, false);
}

async function startWaveformMonitor(stream: MediaStream, ownsStream = false): Promise<void> {
  stopWaveformMonitor();
  const context = new AudioContext();
  if (context.state === 'suspended') await context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  waveformContext = context;
  waveformSource = source;
  waveformAnalyser = analyser;
  waveformOwnedStream = ownsStream ? stream : null;
  const samples = new Uint8Array(analyser.fftSize);
  const draw = () => {
    if (waveformAnalyser !== analyser) return;
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      energy += centered * centered;
    }
    updateMicrophoneWaveform(Math.sqrt(energy / samples.length) / 0.08);
    waveformFrame = requestAnimationFrame(draw);
  };
  draw();
}

function offlineSpeechThreshold(): number {
  return Math.min(0.006, Math.max(OFFLINE_MIN_SPEECH_THRESHOLD, offlineNoiseFloor * 2));
}

function saveCurrentSettings(): Promise<void> {
  return ariaDesktop.saveSettings({
    ...storedSettings,
    apiKey: apiKeyInput.value.trim(),
    alwaysListening,
    ttsEnabled,
    panelPinned,
    cameraEnabled,
    activeMode,
    inputMethod,
    microphoneDeviceId,
  });
}

function updateAlwaysListenButton(): void {
  alwaysListenBtn.textContent = `Always listen: ${alwaysListening ? 'On' : 'Off'}`;
  alwaysListenBtn.classList.toggle('active', alwaysListening);
}

function updateTtsButton(): void {
  ttsBtn.textContent = `Voice output: ${ttsEnabled ? 'On' : 'Off'}`;
  ttsBtn.classList.toggle('active', ttsEnabled);
}

function updatePinPanelButton(): void {
  pinPanelBtn.textContent = `Pin to top: ${panelPinned ? 'On' : 'Off'}`;
  pinPanelBtn.classList.toggle('active', panelPinned);
}

function updateCameraToggleButton(): void {
  cameraToggleBtn.textContent = `Camera: ${cameraEnabled ? 'On' : 'Off'}`;
  cameraToggleBtn.classList.toggle('active', cameraEnabled);
}

function updateInputMethodUi(): void {
  inputMethodSelect.value = inputMethod;
  typedCommandRow.style.display = inputMethod === 'text' ? 'flex' : 'none';
  speakBtn.style.display = inputMethod === 'text' || activeMode !== 'voice' ? 'none' : '';
  alwaysListenBtn.disabled = inputMethod === 'text';
  microphoneDeviceSelect.disabled = inputMethod !== 'offline';
}

async function refreshMicrophoneDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default');
  const selectedExists = devices.some((device) => device.deviceId === microphoneDeviceId);
  if (microphoneDeviceId && !selectedExists) microphoneDeviceId = '';
  microphoneDeviceSelect.replaceChildren(new Option('System default', ''));
  devices.forEach((device, index) => {
    microphoneDeviceSelect.add(new Option(device.label || `Microphone ${index + 1}`, device.deviceId));
  });
  microphoneDeviceSelect.value = microphoneDeviceId;
  ariaDesktop.log('microphone-devices', {
    count: devices.length,
    labelsAvailable: devices.some((device) => Boolean(device.label)),
    selected: Boolean(microphoneDeviceId),
  });
}

function renderVoiceTrainingPrompt(): void {
  voiceTrainingProgress.textContent = `Prompt ${voiceTrainingIndex + 1} of ${VOICE_TRAINING_PROMPTS.length}`;
  voiceTrainingPrompt.textContent = VOICE_TRAINING_PROMPTS[voiceTrainingIndex];
  voiceTrainingStatus.textContent = 'Read the exact text naturally and clearly.';
  voiceTrainingHeard.textContent = '';
  voiceTrainingActual.value = VOICE_TRAINING_PROMPTS[voiceTrainingIndex];
  voiceTrainingActual.disabled = true;
  voiceTrainingSave.disabled = true;
  pendingTrainingAudio = null;
  pendingTrainingMimeType = '';
  voiceTrainingNext.textContent = 'Skip';
  resizeWindowToVisibleContent();
}

function trainingAudioConstraints(): MediaTrackConstraints {
  return {
    ...(microphoneDeviceId ? { deviceId: { exact: microphoneDeviceId } } : {}),
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  };
}

async function startVoiceTrainingRecording(): Promise<void> {
  if (voiceTrainingRecorder) return;
  pendingTrainingAudio = null;
  pendingTrainingMimeType = '';
  voiceTrainingActual.disabled = true;
  voiceTrainingSave.disabled = true;
  stopListening(true);
  voiceTrainingStatus.textContent = 'Requesting the selected microphone...';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: trainingAudioConstraints() });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    voiceTrainingStream = stream;
    voiceTrainingRecorder = recorder;
    voiceTrainingChunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) voiceTrainingChunks.push(event.data);
    });
    recorder.start(250);
    await startWaveformMonitor(stream);
    voiceTrainingRecord.disabled = true;
    voiceTrainingStop.disabled = false;
    voiceTrainingNext.disabled = true;
    voiceTrainingDone.disabled = true;
    voiceTrainingStatus.textContent = 'Recording. Read the displayed text, then press Stop and compare.';
    ariaDesktop.log('voice-training-record-start', { promptIndex: voiceTrainingIndex });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    voiceTrainingStatus.textContent = `Recording failed: ${message}`;
    ariaDesktop.log('voice-training-record-error', { error: message });
  }
}

async function stopVoiceTrainingRecording(): Promise<void> {
  const recorder = voiceTrainingRecorder;
  if (!recorder || recorder.state === 'inactive') return;
  voiceTrainingStop.disabled = true;
  voiceTrainingStatus.textContent = 'Comparing with Whisper...';
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.stop();
  await stopped;
  stopWaveformMonitor();
  voiceTrainingStream?.getTracks().forEach((track) => track.stop());
  voiceTrainingStream = null;
  voiceTrainingRecorder = null;

  try {
    const blob = new Blob(voiceTrainingChunks, { type: recorder.mimeType });
    const encodedAudio = await blob.arrayBuffer();
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(encodedAudio.slice(0));
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) mono[i] += samples[i] / decoded.numberOfChannels;
    }
    const audio = resampleAudio(mono, decoded.sampleRate);
    await context.close();
    const transcriber = await getOfflineTranscriber();
    const output = await transcriber(audio, {});
    const heard = (Array.isArray(output) ? output[0]?.text : output.text)?.trim() ?? '';
    const wordAccuracy = Math.max(0, 1 - wordErrorRate(VOICE_TRAINING_PROMPTS[voiceTrainingIndex], heard));
    voiceTrainingHeard.textContent = `Reference: ${VOICE_TRAINING_PROMPTS[voiceTrainingIndex]}\nWhisper heard: ${heard || '[no words]'}\nWord match: ${Math.round(wordAccuracy * 100)}%`;
    pendingTrainingAudio = new Uint8Array(encodedAudio);
    pendingTrainingMimeType = recorder.mimeType;
    voiceTrainingActual.value = heard || VOICE_TRAINING_PROMPTS[voiceTrainingIndex];
    voiceTrainingActual.disabled = false;
    voiceTrainingSave.disabled = false;
    voiceTrainingStatus.textContent = 'Correct the words actually spoken, then save the recording.';
    ariaDesktop.log('voice-training-compare-end', {
      promptIndex: voiceTrainingIndex,
      recognizedCharacters: heard.length,
      wordAccuracy: Number(wordAccuracy.toFixed(3)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    voiceTrainingStatus.textContent = `Sample processing failed: ${message}`;
    ariaDesktop.log('voice-training-compare-error', { error: message });
  } finally {
    voiceTrainingChunks = [];
    voiceTrainingRecord.disabled = false;
    voiceTrainingNext.disabled = false;
    voiceTrainingDone.disabled = false;
  }
}

async function saveVoiceTrainingRecording(): Promise<void> {
  const spokenText = voiceTrainingActual.value.trim();
  if (!pendingTrainingAudio || !pendingTrainingMimeType) return;
  if (!spokenText) {
    voiceTrainingStatus.textContent = 'Enter the words actually spoken before saving.';
    voiceTrainingActual.focus();
    return;
  }
  voiceTrainingSave.disabled = true;
  try {
    const saved = await ariaDesktop.saveVoiceTrainingSample({
      audio: pendingTrainingAudio,
      mimeType: pendingTrainingMimeType,
      prompt: VOICE_TRAINING_PROMPTS[voiceTrainingIndex],
      spokenText,
      promptIndex: voiceTrainingIndex,
    });
    pendingTrainingAudio = null;
    pendingTrainingMimeType = '';
    voiceTrainingActual.disabled = true;
    voiceTrainingStatus.textContent = `Sample saved. Dataset now contains ${saved.count} recording${saved.count === 1 ? '' : 's'}.`;
    voiceTrainingNext.textContent = 'Next';
  } catch (error) {
    voiceTrainingSave.disabled = false;
    voiceTrainingStatus.textContent = `Sample save failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function closeVoiceTraining(): void {
  if (voiceTrainingRecorder) return;
  voiceTrainingActive = false;
  voiceTrainingOverlay.classList.remove('visible');
  resizeWindowToVisibleContent();
  if (alwaysListening) startListening();
}

function openVoiceTraining(): void {
  voiceTrainingActive = true;
  stopListening(true);
  window.speechSynthesis.cancel();
  isSpeaking = false;
  renderVoiceTrainingPrompt();
  voiceTrainingOverlay.classList.add('visible');
  resizeWindowToVisibleContent();
}

function speakText(text: string): void {
  if (!ttsEnabled || !text || !('speechSynthesis' in window)) return;
  isSpeaking = true;
  ariaDesktop.log('tts-start');
  if (isListening) stopListening(true);
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  const resumeListening = () => {
    isSpeaking = false;
    ariaDesktop.log('tts-end');
    if (alwaysListening && !voiceTrainingActive) startListening();
  };
  utterance.onend = resumeListening;
  utterance.onerror = resumeListening;
  window.speechSynthesis.speak(utterance);
}

function startBrowserListening(): void {
  if (isListening) return;
  browserRestartAllowed = true;
  const speechWindow = window as unknown as {
    SpeechRecognition?: AriaSpeechRecognitionConstructor;
    webkitSpeechRecognition?: AriaSpeechRecognitionConstructor;
  };
  const SR = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!SR) {
    alwaysListening = false;
    updateAlwaysListenButton();
    void saveCurrentSettings();
    setStatus('Speech recognition is not available');
    ariaDesktop.log('speech-unavailable');
    return;
  }
  recognition = new SR(); recognition.continuous = alwaysListening; recognition.interimResults = true;
  recognition.onstart = () => {
    isListening = true;
    setDot('listening');
    setStatus(alwaysListening ? 'Always listening' : 'Listening...');
    void navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        if (isListening && inputMethod === 'browser') void startWaveformMonitor(stream, true);
        else stream.getTracks().forEach((track) => track.stop());
      })
      .catch(() => updateMicrophoneWaveform(0, true));
    ariaDesktop.log('speech-start', { continuous: alwaysListening });
  };
  recognition.onresult = (e) => {
    let interimTranscript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) {
        ariaDesktop.log('speech-result', { characters: result[0].transcript.length });
        commitTranscript(result[0].transcript);
        void handleVoiceCommand(result[0].transcript);
      } else {
        interimTranscript += result[0].transcript;
      }
    }
    setTranscript(interimTranscript);
  };
  recognition.onerror = (event) => {
    isListening = false;
    setDot('idle');
    ariaDesktop.log('speech-error', { error: event.error });
    if (event.error === 'network') {
      browserRestartAllowed = false;
      setStatus('Browser speech failed. Choose Offline Whisper or Type commands.');
    }
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      browserRestartAllowed = false;
      alwaysListening = false;
      updateAlwaysListenButton();
      void saveCurrentSettings();
      setStatus('Microphone or speech recognition permission was denied');
    }
  };
  recognition.onend = () => {
    isListening = false;
    stopWaveformMonitor();
    const restart = alwaysListening && !isSpeaking && browserRestartAllowed && inputMethod === 'browser';
    ariaDesktop.log('speech-end', { restart });
    if (dotState === 'listening') setDot('idle');
    if (restart) setTimeout(startListening, 500);
  };
  recognition.start();
}

async function getOfflineTranscriber(): Promise<OfflineTranscriber> {
  if (!offlineTranscriberPromise) {
    offlineTranscriberPromise = (async () => {
      setStatus('Loading Offline Whisper model...');
      ariaDesktop.log('offline-model-load-start');
      const transformers = await import('@huggingface/transformers');
      const createPipeline = transformers.pipeline as unknown as
        (...args: unknown[]) => Promise<OfflineTranscriber>;
      const progressCallback = (progress: unknown) => {
        if (!progress || typeof progress !== 'object') return;
        const value = 'progress' in progress && typeof progress.progress === 'number'
          ? progress.progress : null;
        const file = 'file' in progress && typeof progress.file === 'string'
          ? progress.file.split('/').at(-1) : null;
        if (value !== null) {
          const percent = value <= 1 ? value * 100 : value;
          setStatus(`Downloading Offline Whisper: ${Math.round(percent)}%${file ? ` - ${file}` : ''}`);
        }
      };
      const transcriber = await createPipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-base.en',
        {
          dtype: {
            encoder_model: 'fp32',
            decoder_model_merged: 'fp32',
          },
          progress_callback: progressCallback,
        },
      );
      ariaDesktop.log('offline-model-load-end');
      return transcriber;
    })().catch((error: unknown) => {
      offlineTranscriberPromise = null;
      throw error;
    });
  }
  return offlineTranscriberPromise;
}

function resampleAudio(input: Float32Array, sourceRate: number, targetRate = 16000): Float32Array {
  if (sourceRate === targetRate) return input;
  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function flushOfflineSpeech(): void {
  if (!offlineContext || offlineSpeechSamples === 0) return;
  const durationMs = Math.round(offlineSpeechSamples / offlineContext.sampleRate * 1000);
  const combined = new Float32Array(offlineSpeechSamples);
  let offset = 0;
  for (const chunk of offlineSpeechChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  let combinedEnergy = 0;
  for (const sample of combined) combinedEnergy += sample * sample;
  const averageRms = Math.sqrt(combinedEnergy / combined.length);
  const accepted = offlineSpeechPeak >= offlineSegmentThreshold * 1.25
    && averageRms >= offlineSegmentThreshold * 0.55;
  offlineSpeechChunks = [];
  offlineSpeechSamples = 0;
  offlineSilenceSamples = 0;
  ariaDesktop.log('offline-segment', {
    accepted,
    averageRms: Number(averageRms.toFixed(6)),
    durationMs,
    peakRms: Number(offlineSpeechPeak.toFixed(6)),
    queued: accepted ? offlineQueue.length + 1 : offlineQueue.length,
  });
  offlineSpeechPeak = 0;
  if (!accepted) {
    if (isListening) setStatus('Always listening offline');
    return;
  }
  offlineQueue.push(resampleAudio(combined, offlineContext.sampleRate));
  void processOfflineQueue();
}

async function processOfflineQueue(): Promise<void> {
  if (offlineProcessing) return;
  offlineProcessing = true;
  try {
    const transcriber = await getOfflineTranscriber();
    while (offlineQueue.length > 0) {
      const audio = offlineQueue.shift()!;
      setStatus('Transcribing offline...');
      const output = await transcriber(audio, {});
      const transcript = (Array.isArray(output) ? output[0]?.text : output.text)?.trim() ?? '';
      ariaDesktop.log('offline-result', { characters: transcript.length });
      if (transcript) {
        commitTranscript(transcript);
        await handleVoiceCommand(transcript);
      }
      if (!alwaysListening && inputMethod === 'offline') stopOfflineListening();
      else if (isListening) setStatus('Always listening offline');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ariaDesktop.log('offline-error', { error: message });
    setStatus(`Offline Whisper error: ${message}`);
    stopOfflineListening(true);
  } finally {
    offlineProcessing = false;
  }
}

async function startOfflineListening(): Promise<void> {
  if (isListening || offlineStream || offlineStarting) return;
  offlineStarting = true;
  try {
    await getOfflineTranscriber();
    if (!listeningRequested || inputMethod !== 'offline') return;
    setStatus('Requesting microphone...');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(microphoneDeviceId ? { deviceId: { exact: microphoneDeviceId } } : {}),
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    await refreshMicrophoneDevices();
    if (!listeningRequested || inputMethod !== 'offline') {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const context = new AudioContext();
    if (context.state === 'suspended') await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    offlineStream = stream;
    offlineContext = context;
    offlineSource = source;
    offlineProcessor = processor;
    offlineSilentGain = silentGain;
    stoppingOffline = false;
    offlineNoiseFloor = 0.0005;
    offlineVadWarmupSamples = 0;
    offlineWarmupLevels = [];
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    processor.onaudioprocess = (event) => {
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      let energy = 0;
      for (const sample of chunk) energy += sample * sample;
      const rms = Math.sqrt(energy / chunk.length);
      updateMicrophoneWaveform(rms / 0.02);
      offlineLevelPeak = Math.max(offlineLevelPeak, rms);
      const speechThreshold = offlineSpeechThreshold();
      const now = Date.now();
      if (now - offlineLastLevelLog >= 5000) {
        ariaDesktop.log('microphone-level', {
          peakRms: Number(offlineLevelPeak.toFixed(6)),
          noiseFloor: Number(offlineNoiseFloor.toFixed(6)),
          speechThreshold: Number(speechThreshold.toFixed(6)),
          selected: Boolean(microphoneDeviceId),
        });
        offlineLevelPeak = 0;
        offlineLastLevelLog = now;
      }
      if (offlineSpeechSamples === 0) {
        offlinePreRollChunks.push(chunk);
        if (offlinePreRollChunks.length > OFFLINE_PRE_ROLL_CHUNKS) offlinePreRollChunks.shift();
        if (offlineVadWarmupSamples < context.sampleRate * 2) {
          offlineVadWarmupSamples += chunk.length;
          offlineWarmupLevels.push(rms);
          if (offlineVadWarmupSamples >= context.sampleRate * 2) {
            const sortedLevels = [...offlineWarmupLevels].sort((a, b) => a - b);
            offlineNoiseFloor = Math.max(0.0002, sortedLevels[Math.floor(sortedLevels.length * 0.75)] ?? 0.0005);
          }
          return;
        }
        if (rms < speechThreshold) offlineNoiseFloor = offlineNoiseFloor * 0.98 + rms * 0.02;
      }
      if (rms >= speechThreshold && offlineSpeechSamples === 0) {
        setStatus('Speech detected...');
        offlineSegmentThreshold = speechThreshold;
        offlineSpeechChunks = [...offlinePreRollChunks];
        offlineSpeechSamples = offlineSpeechChunks.reduce((total, sample) => total + sample.length, 0);
        offlinePreRollChunks = [];
      } else if (offlineSpeechSamples > 0) {
        offlineSpeechChunks.push(chunk);
        offlineSpeechSamples += chunk.length;
      }
      if (offlineSpeechSamples > 0) {
        offlineSpeechPeak = Math.max(offlineSpeechPeak, rms);
        offlineSilenceSamples = rms < speechThreshold ? offlineSilenceSamples + chunk.length : 0;
      }
      const enoughSilence = offlineSilenceSamples >= context.sampleRate * 0.6;
      const maximumLength = offlineSpeechSamples >= context.sampleRate * 8;
      if (offlineSpeechSamples >= context.sampleRate * 0.7 && (enoughSilence || maximumLength)) {
        flushOfflineSpeech();
      }
    };
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (!stoppingOffline && alwaysListening && inputMethod === 'offline') {
        stopOfflineListening();
        setTimeout(() => void startOfflineListening(), 500);
      }
    });
    isListening = true;
    setDot('listening');
    setStatus(alwaysListening ? 'Always listening offline' : 'Listening offline...');
    ariaDesktop.log('offline-speech-start', { sampleRate: context.sampleRate });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ariaDesktop.log('offline-error', { error: message });
    setStatus(`Offline Whisper error: ${message}`);
  } finally {
    offlineStarting = false;
  }
}

function stopOfflineListening(discardPending = false): void {
  stoppingOffline = true;
  if (offlineSpeechSamples > 0 && !discardPending) flushOfflineSpeech();
  else {
    offlineSpeechChunks = [];
    offlinePreRollChunks = [];
    offlineSpeechSamples = 0;
    offlineSilenceSamples = 0;
    offlineSpeechPeak = 0;
  }
  if (discardPending) offlineQueue = [];
  offlineProcessor?.disconnect();
  offlineSource?.disconnect();
  offlineSilentGain?.disconnect();
  offlineStream?.getTracks().forEach((track) => track.stop());
  void offlineContext?.close();
  offlineProcessor = null;
  offlineSource = null;
  offlineSilentGain = null;
  offlineStream = null;
  offlineContext = null;
  updateMicrophoneWaveform(0, false);
  isListening = false;
  if (dotState === 'listening') setDot('idle');
  ariaDesktop.log('offline-speech-end');
}

function startListening(): void {
  if (voiceTrainingActive) return;
  listeningRequested = inputMethod !== 'text';
  if (inputMethod === 'offline') void startOfflineListening();
  else if (inputMethod === 'browser') startBrowserListening();
  else commandInput.focus();
}

function stopListening(discardPending = false): void {
  listeningRequested = false;
  if (inputMethod === 'offline') stopOfflineListening(discardPending);
  else recognition?.stop();
}

/* ══════════════════════════════════════════════
   CLAUDE FALLBACK
   ══════════════════════════════════════════════ */

async function callClaude(key: string, cmd: string): Promise<{ action: string; speech: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 128,
      system: 'You are ARIA. Reply with ONLY JSON: {"action":"<type>","speech":"<reply>"}. Actions: click,scroll,navigate,read_aloud,summarize,find_on_page,translate,zoom_page,tab_action,browser_nav,bookmark_page,type_into,submit_form,copy_to_clipboard,auto_scroll,focus_timer,shopping_list,media_control,highlight,none.',
      messages: [{ role: 'user', content: cmd }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return JSON.parse(data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')) as { action: string; speech: string };
}

/* ══════════════════════════════════════════════
   ACTION EXECUTION
   ══════════════════════════════════════════════ */

async function executeAction(action: string, cmd: string): Promise<string> {
  switch (action) {
    case 'navigate': {
      const q = cmd.replace(/^(go to|open|navigate to)\s+/i, '').trim();
      const url = /^https?:\/\//.test(q) ? q : (q.includes('.') && !q.includes(' ') ? `https://${q}` : `https://www.google.com/search?q=${encodeURIComponent(q)}`);
      await ariaDesktop.openUrl(url); return `Opening ${url}`;
    }
    case 'copy_to_clipboard': {
      const text = cmd.replace(/^(copy|copy to clipboard)\s*/i, '').trim() || cmd;
      await ariaDesktop.writeClipboard(text);
      return `Copied: ${text}`;
    }
    case 'read_aloud': {
      const text = (await ariaDesktop.readClipboard()).trim();
      return text || 'The clipboard is empty. Copy text first, then ask me to read it.';
    }
    case 'focus_timer': {
      const match = cmd.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i);
      const amount = match ? Number(match[1]) : 25;
      const unit = match?.[2]?.toLowerCase() ?? 'minutes';
      const multiplier = unit.startsWith('hour') || unit.startsWith('hr') ? 3600
        : unit.startsWith('sec') ? 1 : 60;
      const seconds = await ariaDesktop.startTimer(amount * multiplier, `${amount} ${unit} timer finished`);
      return `Timer started for ${seconds < 60 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`}`;
    }
    case 'shopping_list': {
      const key = 'aria_shopping_list';
      const list = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
      if (/\b(clear|empty|delete)\b/i.test(cmd)) {
        localStorage.removeItem(key);
        return 'Shopping list cleared';
      }
      if (/\b(read|show|what)\b/i.test(cmd)) {
        return list.length > 0 ? `Shopping list: ${list.join(', ')}` : 'Shopping list is empty';
      }
      const item = cmd.replace(/^add\s+/i, '').replace(/\s+to\s+(my\s+)?(shopping\s+)?list$/i, '').trim();
      if (!item) return 'Say what you want to add to the shopping list';
      list.push(item);
      localStorage.setItem(key, JSON.stringify(list.slice(-100)));
      return `Added ${item} to the shopping list`;
    }
    case 'none': return 'No action selected';
    default: return `${action.replace(/_/g,' ')} is not available in desktop mode yet`;
  }
}

/* ══════════════════════════════════════════════
   COMMAND PIPELINE
   ══════════════════════════════════════════════ */

async function handleVoiceCommand(cmd: string): Promise<void> {
  if (!cmd.trim()) return;
  const wake = stripAriaWakeWord(cmd);
  const command = wake.command || cmd.trim();
  if (wake.detected) ariaDesktop.log('wake-word', { hasCommand: Boolean(wake.command) });
  if (wake.detected && !wake.command) {
    setDot('listening');
    setStatus('ARIA heard. Listening for your command...');
    setResult('Ready');
    speakText('Yes?');
    return;
  }
  setDot('thinking'); setStatus('Thinking…');

  let actionType = 'none'; let speech = ''; let source = 'offline';

  const explicitIntent = routeExplicitDesktopIntent(command);
  const local = explicitIntent
    ? { actionType: explicitIntent as IntentClass, confidence: 1 }
    : await classifyIntent(command);
  if (local && local.confidence >= INTENT_CONFIDENCE_THRESHOLD && local.actionType !== 'none') {
    actionType = local.actionType; source = 'offline';
    speech = `${actionType.replace(/_/g,' ')} (${Math.round(local.confidence*100)}% offline)`;
  }

  const apiKey = apiKeyInput.value.trim();
  if ((!local || local.confidence < INTENT_CONFIDENCE_THRESHOLD) && apiKey) {
    try {
      source = 'claude'; setStatus('Calling Claude…');
      const r = await callClaude(apiKey, command);
      actionType = r.action; speech = r.speech;
      storeVoiceExample(command, actionType);
    } catch (e) { speech = `Cloud error: ${(e as Error).message}`; }
  } else if (!local || local.confidence < INTENT_CONFIDENCE_THRESHOLD) {
    speech = 'Low confidence. Train the NN or use Cmd/Ctrl+Shift+Y/N to correct me.';
  }

  lastDecision = { command, actionType, source };
  ariaDesktop.log('intent-decision', {
    actionType,
    confidence: Number((local?.confidence ?? 0).toFixed(3)),
    source: explicitIntent ? 'rule' : source,
  });

  setDot('acting');
  const detail = await executeAction(actionType, command);
  const response = source === 'offline' ? detail : speech || detail;
  setResult(response);
  if (actionType !== 'none') speakText(response);
  setStatus(`Done [${source}] — Cmd/Ctrl+Shift+Y=reward, +N=punish`);
  setTimeout(() => { setDot('idle'); }, 3000);
}

/* ══════════════════════════════════════════════
   MODE SWITCHING
   ══════════════════════════════════════════════ */

let activeMode: 'voice' | 'eye' | 'hand' = 'voice';
type DotState = 'idle' | 'listening' | 'thinking' | 'acting';
let dotState: DotState = 'idle';
const transcriptHistory: string[] = [];
let interimTranscript = '';

function setDot(s: DotState): void { dotState = s; logoDot.className = s === 'idle' ? '' : s; }
let windowResizeFrame = 0;
function resizeWindowToVisibleContent(): void {
  cancelAnimationFrame(windowResizeFrame);
  windowResizeFrame = requestAnimationFrame(() => {
    const visibleContent = voiceTrainingActive ? voiceTrainingOverlay : overlay;
    void ariaDesktop.resizeWindow(visibleContent.scrollHeight + 2);
  });
}

function setStatus(t: string): void { statusText.textContent = t; resizeWindowToVisibleContent(); }
function renderTranscript(): void {
  const lines = [...transcriptHistory, ...(interimTranscript ? [`Listening: ${interimTranscript}`] : [])];
  transcriptEl.textContent = lines.join('\n');
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
function setTranscript(t: string): void { interimTranscript = t.trim(); renderTranscript(); }
function commitTranscript(t: string): void {
  const transcript = t.trim();
  if (!transcript) return;
  transcriptHistory.push(`${formatTranscriptTimestamp(new Date())} ${transcript}`);
  if (transcriptHistory.length > 8) transcriptHistory.shift();
  interimTranscript = '';
  renderTranscript();
}
function setResult(t: string): void { resultEl.textContent = t; resizeWindowToVisibleContent(); }

async function setMode(mode: 'voice' | 'eye' | 'hand'): Promise<void> {
  if (mode !== 'eye' && eyeTrainingOverlay.classList.contains('visible')) closeEyeTraining();
  activeMode = mode;
  modePills.forEach((p) => {
    const selected = p.dataset.mode === mode;
    p.classList.toggle('active', selected);
    p.setAttribute('aria-pressed', String(selected));
  });
  calibrateBtn.style.display  = mode === 'eye'  ? '' : 'none';
  trainWinkBtn.style.display  = mode === 'eye'  ? '' : 'none';
  trainGestBtn.style.display  = mode === 'hand' ? '' : 'none';
  updateInputMethodUi();

  if (mode === 'voice') {
    stopVision();
    setStatus('Click Speak or press Ctrl+Space');
  } else {
    if (!mpReady) await initMediaPipe();
    await startVision();
    setStatus(mode === 'eye'
      ? (gazeReady
        ? `Eye mode - gaze active; ${eyeWinkModel ? 'personal winks ready' : 'train winks for clicks'}`
        : 'Eye mode - click Calibrate first')
      : (gestureReady ? 'Hand mode — gesture cursor active' : 'Hand mode — click Train Gestures'));
  }
}

/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */

async function init(): Promise<void> {
  await tf.ready();

  intentModel = buildIntentModel();
  const savedModelVersion = localStorage.getItem(IW_VERSION_KEY);
  intentReady = savedModelVersion === PRETRAINED_INTENT_CACHE_VERSION && await loadModel(intentModel, IW_KEY);
  if (!intentReady) {
    intentReady = applyWeights(intentModel, PRETRAINED_INTENT.weights);
    if (intentReady) {
      await saveModel(intentModel, IW_KEY);
      localStorage.setItem(IW_VERSION_KEY, PRETRAINED_INTENT_CACHE_VERSION);
    }
  }

  gazeModel = buildGazeModel();
  gazeReady = await loadModel(gazeModel, GW_KEY);
  if (gazeReady) { const s = localStorage.getItem(GC_KEY); if (s) calData = JSON.parse(s) as typeof calData; }
  try {
    const savedWinkModel = localStorage.getItem(EYE_WINK_MODEL_KEY);
    if (savedWinkModel) {
      const parsed = JSON.parse(savedWinkModel) as EyeWinkModel;
      if (parsed.version === 1) eyeWinkModel = parsed;
    }
  } catch {
    localStorage.removeItem(EYE_WINK_MODEL_KEY);
  }
  trainWinkBtn.textContent = eyeWinkModel ? 'Retrain Winks' : 'Train Winks';

  gestureModel = buildGestureModel();
  gestureReady = await loadModel(gestureModel, GEW_KEY);
  if (gestureReady) { const s = localStorage.getItem(GEE_KEY); if (s) gestureExamples = JSON.parse(s) as typeof gestureExamples; }
  trainGestBtn.textContent = gestureReady ? 'Retrain Hand Controls' : 'Train Hand Controls';

  setStatus(intentReady ? 'Ready - speak, look, or gesture' : 'Voice model is unavailable');

  const settings = await ariaDesktop.getSettings();
  storedSettings = settings;
  if (typeof settings['apiKey'] === 'string') apiKeyInput.value = settings['apiKey'];
  alwaysListening = settings['alwaysListening'] === true;
  ttsEnabled = settings['ttsEnabled'] !== false;
  panelPinned = settings['panelPinned'] === true;
  cameraEnabled = settings['cameraEnabled'] !== false;
  const savedInputMethod = settings['inputMethod'];
  if (savedInputMethod === 'offline' || savedInputMethod === 'browser' || savedInputMethod === 'text') {
    inputMethod = savedInputMethod;
  }
  if (typeof settings['microphoneDeviceId'] === 'string') {
    microphoneDeviceId = settings['microphoneDeviceId'];
  }
  const savedMode = settings['activeMode'];
  if (savedMode === 'voice' || savedMode === 'eye' || savedMode === 'hand') {
    activeMode = savedMode;
    modePills.forEach((p) => {
      const selected = p.dataset.mode === activeMode;
      p.classList.toggle('active', selected);
      p.setAttribute('aria-pressed', String(selected));
    });
    calibrateBtn.style.display = activeMode === 'eye' ? '' : 'none';
    trainWinkBtn.style.display = activeMode === 'eye' ? '' : 'none';
    trainGestBtn.style.display = activeMode === 'hand' ? '' : 'none';
    speakBtn.style.display = activeMode === 'voice' ? '' : 'none';
  }
  updateAlwaysListenButton();
  updateTtsButton();
  updatePinPanelButton();
  updateCameraToggleButton();
  updateInputMethodUi();
  await refreshMicrophoneDevices();
  ariaDesktop.log('renderer-ready', {
    intentReady,
    alwaysListening,
    ttsEnabled,
    activeMode,
    inputMethod,
    speechAvailable: Boolean((window as unknown as {
      SpeechRecognition?: AriaSpeechRecognitionConstructor;
      webkitSpeechRecognition?: AriaSpeechRecognitionConstructor;
    }).SpeechRecognition ?? (window as unknown as {
      webkitSpeechRecognition?: AriaSpeechRecognitionConstructor;
    }).webkitSpeechRecognition),
  });

  // Wire controls
  speakBtn.addEventListener('click', () => { if (isListening || listeningRequested) stopListening(); else startListening(); });
  inputMethodSelect.addEventListener('change', async () => {
    stopListening(true);
    inputMethod = inputMethodSelect.value as InputMethod;
    updateInputMethodUi();
    await saveCurrentSettings();
    if (alwaysListening && inputMethod !== 'text') startListening();
  });
  microphoneDeviceSelect.addEventListener('change', async () => {
    stopListening(true);
    microphoneDeviceId = microphoneDeviceSelect.value;
    await saveCurrentSettings();
    if (alwaysListening && inputMethod === 'offline') startListening();
  });
  navigator.mediaDevices?.addEventListener('devicechange', () => void refreshMicrophoneDevices());
  const runTypedCommand = () => {
    const command = commandInput.value.trim();
    if (!command) return;
    commandInput.value = '';
    commitTranscript(command);
    void handleVoiceCommand(command);
  };
  runCommandBtn.addEventListener('click', runTypedCommand);
  commandInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runTypedCommand();
  });
  alwaysListenBtn.addEventListener('click', async () => {
    alwaysListening = !alwaysListening;
    updateAlwaysListenButton();
    await saveCurrentSettings();
    if (alwaysListening) startListening();
    else stopListening();
  });
  ttsBtn.addEventListener('click', async () => {
    ttsEnabled = !ttsEnabled;
    updateTtsButton();
    if (!ttsEnabled) {
      window.speechSynthesis.cancel();
      isSpeaking = false;
      if (alwaysListening) startListening();
    }
    await saveCurrentSettings();
  });
  pinPanelBtn.addEventListener('click', async () => {
    panelPinned = !panelPinned;
    updatePinPanelButton();
    await ariaDesktop.setPanelPinned(panelPinned);
    await saveCurrentSettings();
  });
  cameraToggleBtn.addEventListener('click', async () => {
    cameraEnabled = !cameraEnabled;
    updateCameraToggleButton();
    if (cameraEnabled) {
      if (activeMode === 'eye' || activeMode === 'hand') await startVision();
    } else {
      stopVision();
    }
    await saveCurrentSettings();
  });
  voiceTrainingBtn.addEventListener('click', openVoiceTraining);
  voiceTrainingRecord.addEventListener('click', () => void startVoiceTrainingRecording());
  voiceTrainingStop.addEventListener('click', () => void stopVoiceTrainingRecording());
  voiceTrainingSave.addEventListener('click', () => void saveVoiceTrainingRecording());
  voiceTrainingNext.addEventListener('click', () => {
    voiceTrainingIndex = (voiceTrainingIndex + 1) % VOICE_TRAINING_PROMPTS.length;
    renderVoiceTrainingPrompt();
  });
  voiceTrainingFolder.addEventListener('click', () => void ariaDesktop.openVoiceTrainingFolder());
  voiceTrainingDone.addEventListener('click', closeVoiceTraining);
  voiceTrainingActual.addEventListener('input', () => {
    voiceTrainingActual.style.height = 'auto';
    voiceTrainingActual.style.height = `${voiceTrainingActual.scrollHeight}px`;
    resizeWindowToVisibleContent();
  });
  trainNNBtn.addEventListener('click', async () => {
    const examples = getStoredVoiceExamples();
    if (examples.length === 0) {
      setStatus(`Pretrained NN ready - ${Math.round(PRETRAINED_INTENT.metrics.validationAccuracy * 100)}% validation accuracy`);
      return;
    }
    trainNNBtn.disabled = true;
    setStatus(`Fine-tuning NN with ${examples.length} corrections...`);
    ariaDesktop.log('intent-finetune-start', { examples: examples.length });
    try {
      const acc = await trainIntentModel(examples);
      setStatus(`NN fine-tuned - ${Math.round(acc * 100)}% training accuracy`);
      ariaDesktop.log('intent-finetune-end', { examples: examples.length, accuracy: acc });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`NN fine-tune failed: ${message}`);
      ariaDesktop.log('intent-finetune-error', { error: message });
    } finally {
      trainNNBtn.disabled = false;
    }
  });
  calibrateBtn.addEventListener('click', startCalibration);
  trainWinkBtn.addEventListener('click', () => void startEyeTraining());
  eyeTrainingCapture.addEventListener('click', captureEyeTrainingStage);
  eyeTrainingCancel.addEventListener('click', closeEyeTraining);
  trainGestBtn.addEventListener('click', () => void startGestureTraining());
  gestCapture.addEventListener('click', captureGestureTrainingStage);
  gestClose.addEventListener('click', closeGestureTraining);
  minimizeBtn.addEventListener('click', () => void ariaDesktop.minimizeWindow());
  closeBtn.addEventListener('click', () => void ariaDesktop.hideWindow());
  apiKeyInput.addEventListener('change', () => void saveCurrentSettings());
  modePills.forEach((p) => p.addEventListener('click', async () => {
    await setMode(p.dataset.mode as 'voice' | 'eye' | 'hand');
    await saveCurrentSettings();
  }));

  // RL shortcuts (global, registered in main via globalShortcut)
  ariaDesktop.onRlReward(onReward);
  ariaDesktop.onRlPunish(onPunish);
  ariaDesktop.onActivate(() => { if (activeMode === 'voice') startListening(); });
  rendererInitialized = true;
  if (eyeTrainingRequested) {
    await openEyeTraining();
  } else if (handTrainingRequested) {
    await openHandTraining();
  } else if (activeMode === 'voice') {
    if (alwaysListening) startListening();
  } else {
    await setMode(activeMode);
  }
}

// Register before async model initialization so a startup request cannot be missed.
ariaDesktop.onOpenVoiceTraining(openVoiceTraining);
ariaDesktop.onOpenEyeTraining(requestEyeTraining);
ariaDesktop.onOpenHandTraining(requestHandTraining);
ariaDesktop.onCameraFallbackFrame(receiveFallbackCameraFrame);
ariaDesktop.onCameraFallbackError((error) => {
  fallbackCameraActive = false;
  visionRunning = false;
  setStatus(`Camera fallback error: ${error}`);
});
new MutationObserver(resizeWindowToVisibleContent).observe(document.body, {
  childList: true,
  characterData: true,
  subtree: true,
});
void init();
