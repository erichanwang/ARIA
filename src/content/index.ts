/**
 * Content script entry. Injected on every page. Owns the on-page presence:
 * the agent cursor, the HUD, TTS, and the DOM action executor. Listens on the
 * message bus for commands from the background service worker.
 *
 * Vanilla TS only (no framework) - keeps the bundle tiny and dodges page CSP
 * issues with injected runtimes.
 */
import { AgentCursor } from './cursor';
import { Hud } from './hud';
import { Speech } from './speech';
import { ActionExecutor } from './dom-actions';
import { getPageContext, setLastGazePos } from './page-context';
import { GazeDriver, updateGazeSettings } from './gaze-driver';
import { HandDriver } from './hand-driver';
import { HistoryPanel } from './history-panel';
import { playEarcon } from './earcons';
import { maybeShowOnboarding } from './onboarding';
import { runMcq } from './tasks/mcq';
import { runSummarizer } from './tasks/summarize';
import { runAccessibilityAudit } from './tasks/accessibility-audit';
import { runScreenshotDescribe } from './screenshot';
import { exportSessionTranscript } from './session-export';
import { toggleShortcutsHelp } from './shortcuts-help';
import { openCommandPalette } from './command-palette';
import { runFormFill } from './tasks/formfill';
import { TriviaGame } from './tasks/trivia';
import { toggleFocusMode, applyAccentColor } from './overlay';
import { showPageSuggestion } from './page-suggestions';
import { togglePageOutline } from './page-outline';
import { toggleAutoScroll } from './auto-scroll';
import { mountElementInspector } from './element-inspector';
import { mountReadingProgress } from './reading-progress';
import { loadPageAnnotations } from './annotations';
import { showSttFallback } from './stt-fallback';
import { checkPriceOnLoad } from './price-watcher';
import { toggleFloatingTranscript, addTranscriptEntry } from './floating-transcript';
import { startNoiseIndicator, stopNoiseIndicator } from './noise-indicator';
import { applyCursorSkin } from './cursor-skins';
import { feedGestureToTrainer } from './tasks/gesture-trainer';
import { recordOutcome, applyMoodToSpeech } from './aria-mood';
import { showToast } from './toast-notifications';
import {
  AriaMessage,
  isForMe,
  PageContextResponse,
  sendRuntime,
} from '@shared/messages';
import { loadSettings, onSettingsChanged } from '@shared/settings';
import { loadSiteProfile } from '@shared/site-profiles';

// Guard against double-injection (SPA navigations, re-injection on update).
// __ariaUrl tracks the URL at mount time; on SPA navigation we re-mount.
type AriaGlobal = { __ariaMounted?: boolean; __ariaUrl?: string };
const _g = window as unknown as AriaGlobal;

function maybeMount(): void {
  const currentUrl = location.href;
  if (_g.__ariaMounted && _g.__ariaUrl === currentUrl) return;
  _g.__ariaMounted = true;
  _g.__ariaUrl = currentUrl;
  void mount();
}

maybeMount();

// Re-run on SPA client-side navigations.
window.addEventListener('popstate', () => setTimeout(maybeMount, 100));
const _origPushState = history.pushState.bind(history);
history.pushState = (...args) => { _origPushState(...args); setTimeout(maybeMount, 100); };

async function mount(): Promise<void> {
  const settings = await loadSettings();

  const cursor = new AgentCursor(settings.cursorScale);
  cursor.setMode(settings.mode);
  const hud = new Hud();
  const historyPanel = new HistoryPanel();
  const speech = new Speech();
  speech.configure({ rate: settings.ttsRate, voiceURI: settings.ttsVoiceURI });

  const executor = new ActionExecutor({
    cursor,
    hud,
    speech,
    navigate: (url) => location.assign(url),
    dangerZoneDetection: settings.dangerZoneDetection,
    selfNarration: settings.selfNarration,
    focusBlocklist: settings.focusBlocklist,
    ariaMoodEnabled: settings.ariaMoodEnabled,
  });

  // Track active input modes for the HUD's combined-mode indicator.
  const activeInputModes = new Set<string>();
  if (settings.mode !== 'manual') activeInputModes.add(settings.mode);

  // Eye / hand drivers are created lazily on the first vision frame.
  let gazeDriver: GazeDriver | null = null;
  let handDriver: HandDriver | null = null;
  let handSensitivity = settings.handSensitivity;
  let earconsEnabled = settings.earconsEnabled;

  // Apply initial gaze settings.
  updateGazeSettings(settings.eyeSmoothing ?? 0.35, settings.dwellTimeMs ?? 800);

  // Mouse tracking: in voice/manual mode the ARIA cursor shadows the real
  // pointer so voice commands can be aimed at a specific element.
  let currentMode = settings.mode;
  document.addEventListener('mousemove', (e) => {
    if (currentMode === 'voice' || currentMode === 'manual') {
      cursor.jumpTo(e.clientX, e.clientY, 'mouse');
    }
  }, { passive: true });

  // Apply initial accent color.
  applyAccentColor(settings.accentColor ?? '#ff2b2b');

  // Cursor Skins.
  applyCursorSkin(settings.cursorSkin ?? 'default');

  // Auto Page Reader on Load.
  if (settings.autoPageReader && settings.enabled) {
    const linkCount = document.querySelectorAll('a[href]').length;
    const btnCount = document.querySelectorAll('button, [role="button"]').length;
    const hasForm = !!document.querySelector('form');
    const hasArticle = !!document.querySelector('article, [role="article"]');
    const desc = [
      `You're on ${document.title || location.hostname}`,
      `This page has ${linkCount} links, ${btnCount} buttons`,
      hasForm ? 'a form' : '',
      hasArticle ? 'and an article' : '',
    ].filter(Boolean).join(', ') + '.';
    setTimeout(() => void speech.speak(desc), 1500);
  }

  // Price Watcher - check on load if this URL is being tracked.
  if (settings.enabled) {
    void checkPriceOnLoad((msg) => void speech.speak(msg));
  }

  // Mini Mode initial state.
  if (settings.miniMode) {
    const host = document.getElementById('aria-overlay-host');
    if (host) host.setAttribute('data-mini', 'true');
  }

  // React to live settings changes (cursor scale, TTS rate, mode tint).
  onSettingsChanged((s) => {
    earconsEnabled = s.earconsEnabled;
    currentMode = s.mode;
    updateGazeSettings(s.eyeSmoothing ?? 0.35, s.dwellTimeMs ?? 800);
    cursor.setScale(s.cursorScale);
    cursor.setMode(s.mode);
    speech.configure({ rate: s.ttsRate, voiceURI: s.ttsVoiceURI });
    handSensitivity = s.handSensitivity;
    handDriver?.setSensitivity(s.handSensitivity);
    applyAccentColor(s.accentColor ?? '#ff2b2b');
    applyCursorSkin(s.cursorSkin ?? 'default');

    // Mini mode live toggle.
    const host = document.getElementById('aria-overlay-host');
    if (host) host.setAttribute('data-mini', s.miniMode ? 'true' : 'false');
  });

  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (!isForMe(msg, 'content')) return;
    const m = msg as AriaMessage;

    switch (m.type) {
      case 'SET_CURSOR_STATE':
        cursor.setState(m.state);
        hud.setState(m.state);
        if (m.state === 'listening') {
          activeInputModes.add('voice');
          hud.setActiveModes([...activeInputModes]);
          playEarcon('listening', earconsEnabled);
        } else if (m.state === 'idle' || m.state === 'error') {
          activeInputModes.delete('voice');
          hud.setActiveModes([...activeInputModes]);
          if (m.state === 'idle') playEarcon('complete', earconsEnabled);
          if (m.state === 'error') {
            playEarcon('error', earconsEnabled);
            // If this is an STT failure, offer text input fallback.
            if (currentMode === 'voice') showSttFallback();
          }
        }
        return;

      case 'HUD_UPDATE':
        if (m.transcript !== undefined) {
          hud.setTranscript(m.transcript);
          if (m.transcript) addTranscriptEntry('user', m.transcript);
        }
        if (m.command !== undefined) hud.setCommand(m.command);
        if (m.status !== undefined) hud.setCommand(m.status);
        if (m.status === 'Listening…') {
          playEarcon('wake', earconsEnabled);
          // Start noise indicator.
          if (settings.noiseIndicator) {
            const hudEl = document.querySelector('#aria-overlay-host')?.shadowRoot?.getElementById('aria-hud');
            if (hudEl) void startNoiseIndicator(hudEl as HTMLElement);
          }
        }
        if (m.status === 'Ready' || m.status === 'Trouble') {
          stopNoiseIndicator();
        }
        if (m.visible === false) hud.hide();
        else hud.show();
        return;

      case 'TOAST':
        showToast({ text: m.text, duration: m.duration });
        return;

      case 'SPEAK': {
        // Mood system applies phrasing overlay.
        // Self-narration (handled in executor; here we just speak).
        const textToSpeak = settings.ariaMoodEnabled ? applyMoodToSpeech(m.text) : m.text;
        void speech.speak(textToSpeak);
        addTranscriptEntry('aria', m.text);
        return;
      }

      case 'EXECUTE_ACTION':
        void executor.execute(m.action).then((outcome) => {
          cursor.setState('idle');
          hud.setState('idle');
          // Record outcome for mood tracking.
          recordOutcome(outcome.success);
          sendRuntime({
            type: 'ACTION_RESULT',
            target: 'background',
            action: m.action.action,
            success: outcome.success,
            detail: outcome.detail,
          });
        });
        return;

      case 'GET_PAGE_CONTEXT': {
        const response: PageContextResponse = { context: getPageContext() };
        sendResponse(response);
        return true; // keep the channel open for the async-style response
      }

      case 'START_TASK_UI': {
        if (m.task === 'mcq') void runMcq(cursor, hud, speech);
        else if (m.task === 'formfill') void runFormFill(cursor, hud, speech);
        else if (m.task === 'trivia') void new TriviaGame(speech).start();
        else if (m.task === 'summarize') void runSummarizer(speech, hud);
        else if (m.task === 'a11y') void runAccessibilityAudit(speech, hud);
        else if (m.task === 'screenshot') void runScreenshotDescribe(speech, hud);
        return;
      }

      case 'HISTORY_UPDATE':
        historyPanel.update(m.entries);
        return;

      case 'SUGGESTION':
        hud.setCommand(`Suggestion: ${m.text}`);
        hud.show();
        // Auto-dismiss after 6s.
        setTimeout(() => hud.hide(), 6000);
        return;

      case 'CONFIDENCE_PROMPT':
        hud.showConfidencePrompt(
          m.confidence,
          m.actionSummary,
          () => sendRuntime({ type: 'CONFIRM_ACTION', target: 'background' }),
          () => sendRuntime({ type: 'CANCEL_ACTION', target: 'background' }),
        );
        return;

      case 'VISION_FRAME': {
        if (m.data.tracker === 'face') {
          if (!gazeDriver) {
            gazeDriver = new GazeDriver(cursor, hud);
            cursor.setMode('eye');
            void gazeDriver.ensureCalibrated();
            activeInputModes.add('eye');
            hud.setActiveModes([...activeInputModes]);
          }
          // Keep gaze position current for voice+gaze targeting.
          if (m.data.gaze) setLastGazePos(m.data.gaze.x, m.data.gaze.y);
          gazeDriver.onFrame(m.data);
        } else {
          if (!handDriver) {
            handDriver = new HandDriver(cursor, hud);
            handDriver.setSensitivity(handSensitivity);
            cursor.setMode('hand');
            activeInputModes.add('hand');
            hud.setActiveModes([...activeInputModes]);
          }
          handDriver.onFrame(m.data);
          // Feed gesture data to trainer if active.
          if (m.data.gesture) feedGestureToTrainer(m.data.gesture);
        }
        return;
      }

      case 'TOGGLE_AGENT':
        if (!m.enabled) {
          // Tear down vision drivers to release camera/RAF loops.
          gazeDriver?.destroy?.();
          handDriver?.destroy?.();
          gazeDriver = null;
          handDriver = null;
          activeInputModes.clear();
          hud.setActiveModes([]);
          hud.hide();
          speech.cancel();
          cursor.setState('idle');
        }
        return;
    }
  });

  // Whisper Mode - hold Ctrl+Space to talk.
  let whisperActive = false;
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.code === 'Space' && !e.shiftKey && !e.altKey && settings.enabled) {
      if (!whisperActive) {
        whisperActive = true;
        e.preventDefault();
        sendRuntime({ type: 'MANUAL_COMMAND', target: 'background', command: '__WHISPER_START__' });
        hud.setCommand('Whisper mode — speak now');
        hud.show();
      }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && whisperActive) {
      whisperActive = false;
      sendRuntime({ type: 'MANUAL_COMMAND', target: 'background', command: '__WHISPER_STOP__' });
    }
  });

  // Keyboard shortcuts.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyH') {
      e.preventDefault();
      historyPanel.toggle();
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
      e.preventDefault();
      void loadSettings().then((s) => {
        const next = !s.enabled;
        sendRuntime({ type: 'TOGGLE_AGENT', target: 'background', enabled: next });
      });
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyE') {
      e.preventDefault();
      void exportSessionTranscript();
    }
    if (e.ctrlKey && e.shiftKey && (e.code === 'Slash' || e.key === '?')) {
      e.preventDefault();
      toggleShortcutsHelp();
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      void openCommandPalette();
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      toggleFocusMode();
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyO') {
      e.preventDefault();
      togglePageOutline();
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyR') {
      e.preventDefault();
      toggleAutoScroll((msg) => void speech.speak(msg));
    }
    // Toggle floating transcript (Ctrl+Shift+T).
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      toggleFloatingTranscript();
    }
  });

  // Mount element inspector (Ctrl+hover → ARIA attribute tooltip).
  mountElementInspector();

  // Auto-mount reading progress bar on article/blog pages.
  if (document.querySelector('article, [role="article"], .post, .entry-content')) {
    mountReadingProgress();
  }

  // Load persistent page annotations.
  void loadPageAnnotations();

  // Register per-site custom shortcuts from the site profile.
  void loadSiteProfile(location.hostname).then((profile) => {
    if (!profile?.shortcuts?.length) return;
    document.addEventListener('keydown', (e) => {
      for (const shortcut of profile.shortcuts!) {
        const modMatch =
          (shortcut.modifiers.includes('ctrl') === e.ctrlKey) &&
          (shortcut.modifiers.includes('alt') === e.altKey) &&
          (shortcut.modifiers.includes('shift') === e.shiftKey) &&
          (shortcut.modifiers.includes('meta') === e.metaKey);
        if (modMatch && e.key.toLowerCase() === shortcut.key.toLowerCase()) {
          e.preventDefault();
          sendRuntime({ type: 'MANUAL_COMMAND', target: 'background', command: shortcut.command });
        }
      }
    });
  });

  // Show first-launch onboarding if not yet seen.
  void maybeShowOnboarding();

  // Proactively suggest the most useful ARIA action for this page type.
  if (settings.enabled) showPageSuggestion(hud);

  // Announce readiness so the background SW knows this tab is wired.
  sendRuntime({ type: 'CONTENT_READY', target: 'background' });
}
