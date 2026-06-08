/**
 * The typed Chrome message bus. EVERY cross-context message in ARIA is one of
 * the variants below. This is the contract that keeps background, content,
 * offscreen, and popup in sync.
 *
 * Routing convention - `target` names the intended recipient so a single
 * onMessage listener per context can cheaply ignore traffic meant for others:
 *   - 'background'  → service worker
 *   - 'content'     → content script in a specific tab
 *   - 'offscreen'   → offscreen document (mic / wake word / camera)
 *   - 'popup'       → extension popup (only alive while open)
 */
import type { AgentAction } from './actions';
import type { AgentStatus, AriaSettings, CursorState, HistoryEntry, PageContext } from './types';
import type { TaskRequest } from './tasks';

export type MessageTarget = 'background' | 'content' | 'offscreen' | 'popup';

/* ----------------------------- offscreen → background ---------------------- */

/** Porcupine detected the wake word. */
export interface WakeWordDetectedMsg {
  type: 'WAKE_WORD_DETECTED';
  target: 'background';
}

/** Web Speech STT produced a (final or interim) transcript. */
export interface TranscriptMsg {
  type: 'TRANSCRIPT';
  target: 'background';
  transcript: string;
  isFinal: boolean;
  /** BCP-47 language tag detected by the STT engine (e.g. 'es-MX'). */
  lang?: string;
}

/** Offscreen reporting its own lifecycle / errors. */
export interface OffscreenStatusMsg {
  type: 'OFFSCREEN_STATUS';
  target: 'background';
  wakeWordReady: boolean;
  micActive: boolean;
  error: string | null;
}

/* ----------------------------- background → offscreen ---------------------- */

/** Boot the mic + Porcupine wake-word listener. */
export interface StartListeningMsg {
  type: 'START_LISTENING';
  target: 'offscreen';
  accessKey: string; // Picovoice access key (stored locally)
  wakePhrase?: string; // Custom phrase for soft SpeechRecognition fallback
}

/** Tear down mic + wake word (agent disabled). */
export interface StopListeningMsg {
  type: 'STOP_LISTENING';
  target: 'offscreen';
}

/** Begin a one-shot STT capture window (after wake). */
export interface StartSttMsg {
  type: 'START_STT';
  target: 'offscreen';
  windowMs: number;
}

/* ----------------------------- background → content ------------------------ */

/** Push a new cursor state to the on-page cursor. */
export interface SetCursorStateMsg {
  type: 'SET_CURSOR_STATE';
  target: 'content';
  state: CursorState;
}

/** Execute a validated Claude action. */
export interface ExecuteActionMsg {
  type: 'EXECUTE_ACTION';
  target: 'content';
  action: AgentAction;
}

/** Update the on-page HUD (transcript / status line). */
export interface HudUpdateMsg {
  type: 'HUD_UPDATE';
  target: 'content';
  command?: string;
  transcript?: string;
  status?: string;
  visible?: boolean;
}

/** Ask the content script to speak a sentence (TTS). */
export interface SpeakMsg {
  type: 'SPEAK';
  target: 'content';
  text: string;
}

/* ----------------------------- content → background ------------------------ */

/** Content script reporting it has mounted in a tab. */
export interface ContentReadyMsg {
  type: 'CONTENT_READY';
  target: 'background';
}

/** Result of an action execution, for status display. */
export interface ActionResultMsg {
  type: 'ACTION_RESULT';
  target: 'background';
  action: string;
  success: boolean;
  detail: string | null;
}

/* ----------------------------- background ↔ content (request/response) ------ */

/** Background asks the active tab for its page context (awaited response). */
export interface GetPageContextMsg {
  type: 'GET_PAGE_CONTEXT';
  target: 'content';
}
export interface PageContextResponse {
  context: PageContext;
}

/* ----------------------------- popup ↔ background --------------------------- */

/** Popup requests the current agent status (awaited response). */
export interface GetStatusMsg {
  type: 'GET_STATUS';
  target: 'background';
}
export interface StatusResponse {
  status: AgentStatus;
}

/** Popup pushed a settings change; background re-applies side effects. */
export interface SettingsChangedMsg {
  type: 'SETTINGS_CHANGED';
  target: 'background';
  settings: AriaSettings;
}

/** Popup toggled the agent on/off (convenience over full settings push). */
export interface ToggleAgentMsg {
  type: 'TOGGLE_AGENT';
  target: 'background';
  enabled: boolean;
}

/** Command palette: user typed a command manually (treated like a final transcript). */
export interface ManualCommandMsg {
  type: 'MANUAL_COMMAND';
  target: 'background';
  command: string;
}

/** Tab management (content scripts can't use chrome.tabs directly). */
export interface TabActionMsg {
  type: 'TAB_ACTION';
  target: 'background';
  command: 'close' | 'new' | 'duplicate' | 'reload';
}

/** Bookmark the current page via background chrome.bookmarks API. */
export interface BookmarkPageMsg {
  type: 'BOOKMARK_PAGE';
  target: 'background';
}

/** Group all tabs from a given hostname in the current window. */
export interface GroupTabsMsg {
  type: 'GROUP_TABS';
  target: 'background';
  hostname?: string;
}

/** Background → popup live status push (only delivered while popup is open). */
export interface StatusPushMsg {
  type: 'STATUS_PUSH';
  target: 'popup';
  status: AgentStatus;
}

/* ----------------------- task modules (M10) -------------------------------- */

/** content/popup → background: run a higher-level task via Claude (awaited). */
export interface RunTaskMsg {
  type: 'RUN_TASK';
  target: 'background';
  request: TaskRequest;
}
export interface RunTaskResponse {
  ok: boolean;
  result: unknown | null; // narrowed by the caller against TaskResultMap
  error: string | null;
}

/** popup → active tab content: launch a task-module UI/flow. */
export interface StartTaskUiMsg {
  type: 'START_TASK_UI';
  target: 'content';
  task: 'mcq' | 'trivia' | 'formfill' | 'summarize' | 'a11y' | 'screenshot';
}

/* --------------------- vision modes (eye / hand - M8 & M9) ------------------ */

export type VisionTracker = 'face' | 'hand';

/** background → offscreen: start camera + a MediaPipe tracker. */
export interface StartVisionMsg {
  type: 'START_VISION';
  target: 'offscreen';
  tracker: VisionTracker;
}

/** background → offscreen: stop camera + tracker. */
export interface StopVisionMsg {
  type: 'STOP_VISION';
  target: 'offscreen';
}

/**
 * Per-frame tracking features emitted by the offscreen vision pipeline.
 * Sent to 'background', which relays it to the active tab as target 'content'.
 * All coordinates are normalized 0..1 in camera space (x is mirrored so it
 * reads like a mirror, matching user expectation).
 */
export interface VisionFrameData {
  tracker: VisionTracker;
  /** Combined gaze feature (iris offset + head pose), normalized ~0..1. */
  gaze?: { x: number; y: number };
  browRaise?: boolean;
  blinkLeft?: boolean;
  blinkRight?: boolean;
  /** Index fingertip (landmark 8), normalized 0..1. */
  fingertip?: { x: number; y: number };
  /** Classified hand gesture. */
  gesture?: HandGesture;
}

export interface VisionFrameMsg {
  type: 'VISION_FRAME';
  target: 'background' | 'content';
  data: VisionFrameData;
}

export type HandGesture =
  | 'point'
  | 'pinch'
  | 'open_palm'
  | 'fist'
  | 'two_finger'
  | 'peace'
  | 'thumbs_up'
  | 'thumbs_down'
  | 'three_finger'
  | 'none';

/* ----------------------- history panel ------------------------------------ */

/** background → content: push updated command history for the panel. */
export interface HistoryUpdateMsg {
  type: 'HISTORY_UPDATE';
  target: 'content';
  entries: HistoryEntry[];
}

/** content → background: re-run a previous command by id. */
export interface RedoCommandMsg {
  type: 'REDO_COMMAND';
  target: 'background';
  entryId: number;
}

/** content → background: capture the visible tab as a screenshot. */
export interface CaptureScreenshotMsg {
  type: 'CAPTURE_SCREENSHOT';
  target: 'background';
}
export interface CaptureScreenshotResponse {
  ok: boolean;
  dataUrl: string | null;
}

/** content → background: send screenshot dataUrl to Claude for description. */
export interface DescribeScreenshotMsg {
  type: 'DESCRIBE_SCREENSHOT';
  target: 'background';
  dataUrl: string;
}
export interface DescribeScreenshotResponse {
  ok: boolean;
  description: string | null;
}

/** content → background: open a new browser tab. */
export interface OpenTabMsg {
  type: 'OPEN_TAB';
  target: 'background';
  url: string;
}

/** background → content: show a proactive follow-up suggestion in the HUD. */
export interface SuggestionMsg {
  type: 'SUGGESTION';
  target: 'content';
  text: string;
}

/** background → content: show a low-confidence confirmation prompt. */
export interface ConfidencePromptMsg {
  type: 'CONFIDENCE_PROMPT';
  target: 'content';
  confidence: number;
  actionSummary: string;
}

/** content → background: user confirmed a low-confidence action. */
export interface ConfirmActionMsg {
  type: 'CONFIRM_ACTION';
  target: 'background';
}

/** content → background: user cancelled a low-confidence action. */
export interface CancelActionMsg {
  type: 'CANCEL_ACTION';
  target: 'background';
}

/* --------------------------------- union ----------------------------------- */

/** background → content: show a toast notification. */
export interface ToastMsg {
  type: 'TOAST';
  target: 'content';
  text: string;
  duration?: number; // ms, default 4000
}

/** content → background: STT transcript language detected. */
export interface LangDetectedMsg {
  type: 'LANG_DETECTED';
  target: 'background';
  lang: string; // BCP-47 e.g. 'es-ES'
}

/* ─────────────────── offline / neural-net training ─────────────────── */

/** popup → background: kick off an offline training cycle. */
export interface TrainModelMsg {
  type: 'TRAIN_MODEL';
  target: 'background';
}
export interface TrainModelResponse {
  ok: boolean;
  accuracy: number | null;
  error: string | null;
}

/** popup → background: request current training status. */
export interface GetTrainingStatusMsg {
  type: 'GET_TRAINING_STATUS';
  target: 'background';
}
export interface TrainingStatusResponse {
  exampleCount: number;
  lastTrainedAt: number | null;
  modelReady: boolean;
  lastAccuracy: number | null;
}

/** popup → background: clear all stored training examples. */
export interface ClearTrainingDataMsg {
  type: 'CLEAR_TRAINING_DATA';
  target: 'background';
}

export type AriaMessage =
  | WakeWordDetectedMsg
  | TranscriptMsg
  | OffscreenStatusMsg
  | StartListeningMsg
  | StopListeningMsg
  | StartSttMsg
  | SetCursorStateMsg
  | ExecuteActionMsg
  | HudUpdateMsg
  | SpeakMsg
  | ContentReadyMsg
  | ActionResultMsg
  | GetPageContextMsg
  | GetStatusMsg
  | SettingsChangedMsg
  | ToggleAgentMsg
  | StatusPushMsg
  | StartVisionMsg
  | StopVisionMsg
  | VisionFrameMsg
  | RunTaskMsg
  | StartTaskUiMsg
  | HistoryUpdateMsg
  | RedoCommandMsg
  | ConfidencePromptMsg
  | ConfirmActionMsg
  | CancelActionMsg
  | SuggestionMsg
  | OpenTabMsg
  | CaptureScreenshotMsg
  | DescribeScreenshotMsg
  | ManualCommandMsg
  | TabActionMsg
  | BookmarkPageMsg
  | GroupTabsMsg
  | ToastMsg
  | LangDetectedMsg
  | TrainModelMsg
  | GetTrainingStatusMsg
  | ClearTrainingDataMsg;

/** Maps request message types to their awaited response payloads. */
export interface ResponseMap {
  GET_PAGE_CONTEXT: PageContextResponse;
  GET_STATUS: StatusResponse;
  RUN_TASK: RunTaskResponse;
  CAPTURE_SCREENSHOT: CaptureScreenshotResponse;
  DESCRIBE_SCREENSHOT: DescribeScreenshotResponse;
  TRAIN_MODEL: TrainModelResponse;
  GET_TRAINING_STATUS: TrainingStatusResponse;
}

/* --------------------------------- helpers --------------------------------- */

const MSG_TIMEOUT_MS = 3000;

/** Race a promise against a timeout; returns null on timeout or error. */
function withTimeout<T>(p: Promise<T>, ms = MSG_TIMEOUT_MS): Promise<T | null> {
  return Promise.race([
    p.catch(() => null as T | null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** Fire-and-forget broadcast to the runtime (background / offscreen / popup). */
export function sendRuntime(msg: AriaMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // No receiver alive (e.g. popup closed). Safe to ignore.
  });
}

/** Fire-and-forget message to a specific tab's content script. */
export function sendToTab(tabId: number, msg: AriaMessage): void {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab may not have the content script (chrome:// pages, etc.).
  });
}

/** Awaited request/response to a tab's content script, with 3s timeout (overridable). */
export async function requestTab<T extends keyof ResponseMap>(
  tabId: number,
  msg: Extract<AriaMessage, { type: T }>,
  ms = MSG_TIMEOUT_MS,
): Promise<ResponseMap[T] | null> {
  return withTimeout(chrome.tabs.sendMessage(tabId, msg) as Promise<ResponseMap[T]>, ms);
}

/**
 * KI-05: resolves once `tabId` finishes loading (status 'complete'), or after
 * `timeoutMs` - whichever comes first. Used before re-querying page context
 * right after a navigate step, so a slow page doesn't race the 3s message
 * timeout while it's still loading.
 */
export function waitForTabLoad(tabId: number, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (updatedTabId: number, changeInfo: { status?: string }): void => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/** Awaited request/response to the background service worker, with 3s timeout. */
export async function requestRuntime<T extends keyof ResponseMap>(
  msg: Extract<AriaMessage, { type: T }>,
): Promise<ResponseMap[T] | null> {
  return withTimeout(chrome.runtime.sendMessage(msg) as Promise<ResponseMap[T]>);
}

/** Narrowing helper for onMessage listeners. */
export function isForMe(msg: unknown, me: MessageTarget): msg is AriaMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'target' in msg &&
    (msg as { target?: unknown }).target === me
  );
}
