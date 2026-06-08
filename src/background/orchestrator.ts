/**
 * Voice-loop orchestrator. Owns the agent runtime state machine:
 *
 *   WAKE → listening → transcript → thinking → (confidence check) → acting → idle
 *
 * Now also:
 * - Maintains session context (last 5 commands) sent with every Claude call.
 * - Checks confidence threshold; speaks uncertainty before acting.
 * - Maintains a 10-entry history for the history panel.
 * - Handles redo commands.
 */
import { callClaude } from './claude';
import { classify } from './command-classifier';
import { recordExample } from './trainer';
import { getCachedResponse, setCachedResponse } from './response-cache';
import { parseAliasCommand, saveAlias, resolveAlias } from './aliases';
import { SessionContext, recordCommandFrequency } from './session-context';
import { recordUsage, canRunCommand } from '@shared/usage-tracker';
import {
  MacroRecorder,
  findMacro,
  isStartRecording,
  parseRunMacro,
  parseStopRecording,
} from './macros';
import { ensureOffscreen, releaseOffscreen } from './offscreen-manager';
import {
  requestTab,
  waitForTabLoad,
  sendRuntime,
  sendToTab,
  type VisionFrameData,
} from '@shared/messages';
import { loadSettings, loadPicovoiceKey } from '@shared/settings';
import type { AgentStatus, CursorState, InputMode } from '@shared/types';
import type { AgentAction } from '@shared/actions';

const STT_WINDOW_MS = 3000;
const LOW_CONFIDENCE_THRESHOLD_DEFAULT = 0.6;

/** Split a chained command on "then" into sub-commands. */
function splitChainedCommand(cmd: string): string[] {
  const parts = cmd.split(/\s+then\s+/i).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [];
}

/** Words that trigger undo. */
function isUndoCommand(cmd: string): boolean {
  return /^(undo\s*(that|last)?|go\s*back)$/i.test(cmd.trim());
}

/** Words that trigger repeat. */
function isRepeatCommand(cmd: string): boolean {
  return /^(do\s*that\s*again|repeat\s*(that|last)?|again)$/i.test(cmd.trim());
}

export class Orchestrator {
  private status: AgentStatus = {
    state: 'idle',
    mode: 'voice',
    lastCommand: null,
    lastAction: null,
    lastError: null,
    lastConfidence: null,
    wakeWordReady: false,
  };

  private busy = false;
  private sessionContext = new SessionContext();
  private macroRecorder = new MacroRecorder();

  // Pending low-confidence action awaiting user confirmation.
  private pendingAction: { resolve: (confirmed: boolean) => void } | null = null;

  // Last command for undo/repeat.
  private lastCommand: string | null = null;
  private lastActionType: string | null = null;

  // Last detected STT language (BCP-47).
  private lastLang: string = 'en-US';

  getStatus(): AgentStatus {
    return { ...this.status };
  }

  async enable(): Promise<void> {
    const settings = await loadSettings();
    this.status.mode = settings.mode;
    await ensureOffscreen();

    if (settings.mode === 'voice') {
      const pvKey = await loadPicovoiceKey();
      // pvKey is optional - if absent, offscreen falls back to soft SpeechRecognition wake word.
      sendRuntime({
        type: 'START_LISTENING',
        target: 'offscreen',
        accessKey: pvKey ?? '',
        wakePhrase: settings.wakeWord ?? 'hey aria',
      });
    } else if (settings.mode === 'eye') {
      // Show loading message in active tab while WASM loads.
      this.toActiveTab((tabId) =>
        sendToTab(tabId, { type: 'HUD_UPDATE', target: 'content', status: 'Loading eye tracking…', visible: true }),
      );
      sendRuntime({ type: 'START_VISION', target: 'offscreen', tracker: 'face' });
    } else if (settings.mode === 'hand') {
      this.toActiveTab((tabId) =>
        sendToTab(tabId, { type: 'HUD_UPDATE', target: 'content', status: 'Loading hand tracking…', visible: true }),
      );
      sendRuntime({ type: 'START_VISION', target: 'offscreen', tracker: 'hand' });
    }
  }

  async disable(): Promise<void> {
    sendRuntime({ type: 'STOP_LISTENING', target: 'offscreen' });
    sendRuntime({ type: 'STOP_VISION', target: 'offscreen' });
    await releaseOffscreen();
    this.status.wakeWordReady = false;
    this.setState('idle');
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  }

  async relayVisionFrame(data: VisionFrameData): Promise<void> {
    const tabId = await this.activeTabId();
    if (tabId !== null) {
      sendToTab(tabId, { type: 'VISION_FRAME', target: 'content', data });
    }
  }

  setMode(mode: InputMode): void {
    this.status.mode = mode;
  }

  /* ----------------------- message-driven transitions -------------------- */

  onOffscreenStatus(wakeWordReady: boolean, error: string | null): void {
    this.status.wakeWordReady = wakeWordReady;
    if (error) this.status.lastError = error;
    this.pushStatus();
  }

  onWake(): void {
    if (this.busy) return;
    this.busy = true;
    this.setState('listening');
    this.toActiveTab((tabId) =>
      sendToTab(tabId, { type: 'HUD_UPDATE', target: 'content', status: 'Listening…', visible: true }),
    );
    sendRuntime({ type: 'START_STT', target: 'offscreen', windowMs: STT_WINDOW_MS });
  }

  onTranscript(transcript: string, isFinal: boolean, lang?: string): void {
    if (lang) this.lastLang = lang;
    this.toActiveTab((tabId) =>
      sendToTab(tabId, { type: 'HUD_UPDATE', target: 'content', transcript }),
    );
    if (isFinal) void this.handleCommand(transcript);
  }

  /** Whisper mode triggered from content script. */
  onWhisperStart(): void {
    if (this.busy) return;
    this.busy = true;
    this.setState('listening');
    sendRuntime({ type: 'START_STT', target: 'offscreen', windowMs: 10000 });
  }

  onWhisperStop(): void {
    // STT will auto-stop after windowMs; this is just a UI update.
    this.toActiveTab((tabId) =>
      sendToTab(tabId, { type: 'HUD_UPDATE', target: 'content', status: 'Processing…' }),
    );
  }

  onActionResult(action: string, success: boolean, detail: string | null): void {
    const command = this.status.lastCommand ?? '';
    const speech = detail ?? '';
    const confidence = this.status.lastConfidence ?? 1.0;

    // Record into session context.
    this.sessionContext.add({ command, action, speech, success, confidence });

    this.status.lastAction = success ? `${action}${detail ? ` — ${detail}` : ''}` : `${action} (failed)`;
    if (!success && detail) this.status.lastError = detail;
    this.setState('idle');
    this.busy = false;
    this.pushStatus();
    this.pushHistory();
  }

  /** User confirmed a low-confidence action. */
  onConfirmAction(): void {
    this.pendingAction?.resolve(true);
  }

  /** User cancelled a low-confidence action. */
  onCancelAction(): void {
    this.pendingAction?.resolve(false);
    this.pendingAction = null;
    this.setState('idle');
    this.busy = false;
    this.pushStatus();
  }

  /** Re-run a previous command by history entry id. */
  async onRedoCommand(entryId: number): Promise<void> {
    const entry = this.sessionContext.getById(entryId);
    if (!entry || this.busy) return;
    this.busy = true;
    await this.handleCommand(entry.command);
  }

  /* ------------------------------- core ---------------------------------- */

  private async handleCommand(command: string): Promise<void> {
    // Undo last action.
    if (isUndoCommand(command)) {
      const tabId = await this.activeTabId();
      if (tabId) {
        if (this.lastActionType === 'navigate' || this.lastActionType === 'browser_nav') {
          sendToTab(tabId, { type: 'SPEAK', target: 'content', text: 'Going back.' });
          sendToTab(tabId, { type: 'EXECUTE_ACTION', target: 'content', action: { action: 'browser_nav', command: 'back', speech: 'Going back.' } });
        } else if (this.lastActionType === 'type_into' || this.lastActionType === 'dictate') {
          sendToTab(tabId, { type: 'SPEAK', target: 'content', text: "I can't undo typed text, but I cleared what I typed." });
        } else {
          sendToTab(tabId, { type: 'SPEAK', target: 'content', text: "I can't undo that action." });
        }
      }
      this.busy = false;
      return;
    }

    // Repeat last command.
    if (isRepeatCommand(command)) {
      if (this.lastCommand) {
        await this.handleCommand(this.lastCommand);
      } else {
        const tabId = await this.activeTabId();
        if (tabId) sendToTab(tabId, { type: 'SPEAK', target: 'content', text: "I don't have a previous command to repeat." });
        this.busy = false;
      }
      return;
    }

    // Phonetic Alias registration - "alias X as Y".
    const aliasMatch = parseAliasCommand(command);
    if (aliasMatch) {
      await saveAlias(aliasMatch.phonetic, aliasMatch.canonical);
      this.toActiveTab((tabId) =>
        sendToTab(tabId, {
          type: 'SPEAK',
          target: 'content',
          text: `Got it — I'll treat "${aliasMatch.phonetic}" as "${aliasMatch.canonical}" from now on.`,
        }),
      );
      this.busy = false;
      return;
    }

    // Resolve any registered alias before processing.
    command = await resolveAlias(command);

    // Command Chaining - split "do X then do Y".
    const chain = splitChainedCommand(command);
    if (chain.length > 1) {
      this.busy = false;
      for (const sub of chain) {
        this.busy = true;
        await this.handleCommand(sub);
        await new Promise<void>((r) => setTimeout(r, 800));
      }
      return;
    }

    // Macro: start recording.
    if (isStartRecording(command)) {
      this.macroRecorder.start();
      this.toActiveTab((tabId) =>
        sendToTab(tabId, { type: 'SPEAK', target: 'content', text: 'Recording started. Say "stop recording" when done.' }),
      );
      this.busy = false;
      return;
    }

    // Macro: stop recording.
    const stopResult = parseStopRecording(command);
    if (stopResult) {
      const macro = await this.macroRecorder.stop(stopResult.name || 'macro');
      this.toActiveTab((tabId) =>
        sendToTab(tabId, { type: 'SPEAK', target: 'content', text: `Saved macro "${macro.name}" with ${macro.commands.length} steps.` }),
      );
      this.busy = false;
      return;
    }

    // Macro: run by name.
    const macroName = parseRunMacro(command);
    if (macroName) {
      const macro = await findMacro(macroName);
      if (!macro) {
        this.toActiveTab((tabId) =>
          sendToTab(tabId, { type: 'SPEAK', target: 'content', text: `I don't have a macro called "${macroName}".` }),
        );
        this.busy = false;
        return;
      }
      this.busy = false;
      for (const cmd of macro.commands) {
        await new Promise<void>((resolve) => {
          this.busy = true;
          void this.handleCommand(cmd).then(() => resolve());
        });
        await new Promise<void>((r) => setTimeout(r, 600));
      }
      return;
    }

    // Record the command if a macro is in progress.
    this.macroRecorder.record(command);

    // Track frequency for command palette ranking.
    void recordCommandFrequency(command);

    // Usage tracking + free-tier gate.
    const allowed = await canRunCommand();
    if (!allowed) {
      const tabId = await this.activeTabId();
      if (tabId) {
        this.speakError(tabId, "You've reached today's command limit. Upgrade to ARIA Pro for unlimited commands.");
      }
      this.busy = false;
      return;
    }
    void recordUsage();

    const previousActionType = this.lastActionType;
    this.lastCommand = command;
    this.lastActionType = null;

    this.status.lastCommand = command;
    this.status.lastError = null;
    this.setState('thinking');

    const tabId = await this.activeTabId();
    if (tabId === null) {
      this.setError('No active tab to act on.');
      this.busy = false;
      return;
    }

    // KI-05: if the last action navigated this tab, the page (and its content
    // script) may still be loading - wait for it rather than racing the
    // default 3s message timeout, which was too short for slow pages.
    if (previousActionType === 'navigate' || previousActionType === 'browser_nav') {
      await waitForTabLoad(tabId);
    }
    const ctxResponse = await requestTab(tabId, { type: 'GET_PAGE_CONTEXT', target: 'content' });
    if (!ctxResponse) {
      this.speakError(tabId, "I can't read this page.");
      this.busy = false;
      return;
    }

    const settings = await loadSettings();

    // Prepend language hint for non-English commands.
    const isEnglish = this.lastLang.startsWith('en');
    const effectiveCommand = isEnglish
      ? command
      : `[Command language: ${this.lastLang}] ${command}`;

    // If gaze pos is available, inject as spatial hint.
    const gazePos = ctxResponse.context.gazePos;
    const gazeHint = gazePos
      ? `\n[Gaze target: screen ${Math.round(gazePos.x * 100)}% from left, ${Math.round(gazePos.y * 100)}% from top]`
      : '';

    // Check response cache before calling Claude (5-min TTL, same command+URL).
    const cached = getCachedResponse(command, ctxResponse.context.url);
    const result = cached ?? await callClaude(
      settings.apiKey,
      effectiveCommand + gazeHint,
      ctxResponse.context,
      this.sessionContext.getContextString(),
      settings.voiceShorthands ?? [],
      settings.agentName ?? 'ARIA',
      settings.readingLevel ?? 'standard',
    );
    if (!cached && result.ok) setCachedResponse(command, ctxResponse.context.url, result);

    if (!result.ok || !result.action) {
      this.status.lastError = result.error;
      const kind = (result as { errorKind?: string }).errorKind;

      // Offline fallback: try local neural classifier when Claude is unreachable.
      if (kind === 'network' || kind === 'timeout') {
        const localPred = await classify(effectiveCommand);
        const offlineAction = localPred ? buildOfflineAction(localPred.actionType, localPred.confidence) : null;
        if (offlineAction) {
          sendToTab(tabId, { type: 'SPEAK', target: 'content', text: `Offline — ${offlineAction.speech}` });
          sendToTab(tabId, { type: 'SET_CURSOR_STATE', target: 'content', state: 'acting' });
          sendToTab(tabId, { type: 'EXECUTE_ACTION', target: 'content', action: offlineAction });
          this.lastActionType = offlineAction.action;
          this.setState('idle');
          this.busy = false;
          return;
        }
        this.speakError(tabId, "I'm offline and my local model isn't confident enough. Train the model in the AI tab.");
        this.busy = false;
        this.pushStatus();
        return;
      }

      let userMsg = 'I had trouble with that.';
      if (kind === 'auth') {
        userMsg = 'I need a valid API key. Please add one in the ARIA settings.';
        chrome.action.openPopup?.().catch(() => {});
      } else if (kind === 'rate_limit') {
        userMsg = "I'm being rate limited — please try again in a moment.";
      }
      this.speakError(tabId, userMsg);
      this.busy = false;
      this.pushStatus();
      return;
    }

    // Record this successful Claude decision as a training example for the local model.
    if (result.action && result.confidence >= 0.75) {
      void recordExample(command, result.action.action, 'claude');
    }

    this.status.lastConfidence = result.confidence;

    // Confidence check: if below threshold, warn before acting.
    const threshold = settings.confidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD_DEFAULT;
    const needsConfidence = result.confidence < threshold;

    // Safe mode: destructive actions always require confirmation.
    const DESTRUCTIVE = new Set(['submit_form', 'fill_form', 'navigate', 'click', 'delete']);
    const needsSafeMode = settings.safeMode && DESTRUCTIVE.has(result.action.action);

    if (needsConfidence || needsSafeMode) {
      const confirmed = await this.promptConfidence(tabId, result.confidence, result.action.action);
      if (!confirmed) {
        this.busy = false;
        this.pushStatus();
        return;
      }
    }

    this.lastActionType = result.action.action;
    sendToTab(tabId, { type: 'SET_CURSOR_STATE', target: 'content', state: 'acting' });
    sendToTab(tabId, { type: 'EXECUTE_ACTION', target: 'content', action: result.action });

    // Proactive suggestion: delivered after a short delay so it doesn't race the action speech.
    // Use Claude's suggestion if available; fall back to deterministic follow-up hints.
    const suggestion = result.suggestion ?? getFollowUpHint(result.action.action);
    if (suggestion) {
      setTimeout(() => {
        sendToTab(tabId, { type: 'SUGGESTION', target: 'content', text: suggestion });
      }, 2500);
    }
  }

  /* ------------------------------ helpers -------------------------------- */

  /** Show confidence prompt in HUD, resolve true/false after 5s or user input. */
  private promptConfidence(tabId: number, confidence: number, actionSummary: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingAction = { resolve };

      sendToTab(tabId, {
        type: 'CONFIDENCE_PROMPT',
        target: 'content',
        confidence,
        actionSummary,
      });

      // Auto-proceed after 5 seconds if user takes no action.
      setTimeout(() => {
        if (this.pendingAction) {
          this.pendingAction = null;
          resolve(true);
        }
      }, 5000);
    });
  }

  /* ------------------------------ helpers -------------------------------- */

  private setState(state: CursorState): void {
    this.status.state = state;
    this.toActiveTab((tabId) =>
      sendToTab(tabId, { type: 'SET_CURSOR_STATE', target: 'content', state }),
    );
    this.pushStatus();
    this.updateBadge(state);
  }

  private updateBadge(state: CursorState): void {
    const colors: Record<CursorState, string> = {
      idle: '#4ade80',
      listening: '#2b7fff',
      thinking: '#9b6bff',
      acting: '#ffffff',
      error: '#ff8c00',
    };
    chrome.action.setBadgeBackgroundColor({ color: colors[state] }).catch(() => {});
    chrome.action.setBadgeText({ text: state === 'idle' ? '' : '●' }).catch(() => {});
  }

  private setError(error: string): void {
    this.status.lastError = error;
    this.status.state = 'error';
    this.pushStatus();
  }

  private speakError(tabId: number, message: string): void {
    sendToTab(tabId, { type: 'SET_CURSOR_STATE', target: 'content', state: 'error' });
    sendToTab(tabId, { type: 'SPEAK', target: 'content', text: message });
    setTimeout(() => {
      sendToTab(tabId, { type: 'SET_CURSOR_STATE', target: 'content', state: 'idle' });
    }, 1500);
  }

  private pushStatus(): void {
    sendRuntime({ type: 'STATUS_PUSH', target: 'popup', status: this.getStatus() });
  }

  private pushHistory(): void {
    const entries = this.sessionContext.getHistory();
    this.toActiveTab((tabId) =>
      sendToTab(tabId, { type: 'HISTORY_UPDATE', target: 'content', entries }),
    );
    // Persist to storage so the popup's History tab can load it.
    void chrome.storage.local.set({ 'aria.history': entries });
  }

  private async activeTabId(): Promise<number | null> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id ?? null;
  }

  private toActiveTab(fn: (tabId: number) => void): void {
    void this.activeTabId().then((id) => {
      if (id !== null) fn(id);
    });
  }
}

const FOLLOW_UP_HINTS: Record<string, string | undefined> = {
  navigate: 'Want me to read this page aloud?',
  read_aloud: 'Say "summarize" for a shorter version.',
  summarize: 'Say "read aloud" to hear the full text.',
  highlight: 'Say "explain this" to get more detail.',
  find_on_page: 'Say "next" to jump to the next match.',
  submit_form: 'Form submitted. Want me to read the response?',
  translate: 'Say "read aloud" to hear the translation.',
  bookmark_page: 'Page bookmarked. Say "open bookmarks" to view all.',
  dictate: 'Dictation started. Say "stop dictating" when done.',
  auto_scroll: 'Auto-scroll active. Press Space to pause.',
};

function getFollowUpHint(action: string): string | null {
  if (action in FOLLOW_UP_HINTS) return FOLLOW_UP_HINTS[action] ?? null;
  return null;
}

/**
 * Build a minimal valid AgentAction from the local NN's predicted action type.
 * Only handles parameter-free or easily inferred actions; returns null for
 * anything that absolutely needs extra context (e.g. click target, navigate URL).
 */
function buildOfflineAction(actionType: string, confidence: number): AgentAction | null {
  if (confidence < 0.5) return null;
  const pct = Math.round(confidence * 100);
  const speech = (label: string) => `${label} (offline, ${pct}% confidence)`;
  switch (actionType) {
    case 'scroll':         return { action: 'scroll', direction: 'down', amount: 'medium', speech: speech('Scrolling down') };
    case 'read_aloud':     return { action: 'read_aloud', speech: speech('Reading aloud') };
    case 'summarize':      return { action: 'summarize', speech: speech('Summarising') };
    case 'auto_scroll':    return { action: 'auto_scroll', command: 'start', speech: speech('Starting auto-scroll') };
    case 'browser_nav':    return { action: 'browser_nav', command: 'back', speech: speech('Going back') };
    case 'zoom_page':      return { action: 'zoom_page', direction: 'in', speech: speech('Zooming in') };
    case 'bookmark_page':  return { action: 'bookmark_page', speech: speech('Bookmarking') };
    case 'open_outline':   return { action: 'open_outline', speech: speech('Opening outline') };
    case 'tab_action':     return { action: 'tab_action', command: 'reload', speech: speech('Reloading tab') };
    case 'media_control':  return { action: 'media_control', command: 'toggle_play', speech: speech('Toggling playback') };
    default:               return null; // needs params we don't have
  }
}
