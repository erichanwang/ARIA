/**
 * Service worker entry. The central hub of the extension:
 *  - routes the typed message bus
 *  - owns the Orchestrator (voice loop state machine)
 *  - reacts to settings changes (enable/disable voice mode)
 *  - keeps itself alive with a chrome.alarms ping (MILESTONE 7) so the wake
 *    word listener isn't orphaned by MV3's ~30s SW idle termination.
 */
import { Orchestrator } from './orchestrator';
import { runTask } from './tasks';
import { initTrainer, runTraining, getTrainingStatus, clearExamples } from './trainer';
import {
  AriaMessage,
  isForMe,
  RunTaskResponse,
  StatusResponse,
  TrainModelResponse,
  TrainingStatusResponse,
  sendRuntime,
  sendToTab,
  type DescribeScreenshotResponse,
} from '@shared/messages';
import { loadSettings, loadPicovoiceKey, onSettingsChanged, patchSettings } from '@shared/settings';
import { shouldRearmWakeWord } from './keepalive';

async function describeScreenshot(apiKey: string, dataUrl: string): Promise<DescribeScreenshotResponse> {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
  const mediaType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Describe what you see on this web page screenshot in 1-2 natural sentences, focusing on the main content.' },
          ],
        }],
      }),
    });
    if (!res.ok) return { ok: false, description: null };
    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return text ? { ok: true, description: text } : { ok: false, description: null };
  } catch {
    return { ok: false, description: null };
  }
}

const orchestrator = new Orchestrator();

/* ------------------------------ lifecycle --------------------------------- */

chrome.runtime.onInstalled.addListener((details) => {
  void applyEnabledState();
  ensureKeepAlive();
  // On update, re-inject content scripts into all open tabs so users don't
  // need to manually refresh after an extension update.
  if (details.reason === 'update') {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (!tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/content/index.ts'],
        }).catch(() => {}); // Silently skip restricted pages
      }
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  void applyEnabledState();
  ensureKeepAlive();
});

// Re-apply on every SW wake (the worker may have been killed and respawned).
void applyEnabledState();
ensureKeepAlive();
// Boot the local neural classifier (loads persisted weights if available).
void initTrainer();

/** Bring runtime in line with the persisted `enabled` flag. */
async function applyEnabledState(): Promise<void> {
  const settings = await loadSettings();
  if (settings.enabled) await orchestrator.enable();
  else await orchestrator.disable();
}

// React to settings changes from the popup (toggle, API/PV keys, etc.).
onSettingsChanged((settings) => {
  if (settings.enabled) void orchestrator.enable();
  else void orchestrator.disable();
});

/* ------------------------------- routing ---------------------------------- */

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isForMe(msg, 'background')) return;
  const m = msg as AriaMessage;

  // Async handler wrapper - MV3 requires returning true to keep the channel open.
  const handle = async () => {

  switch (m.type) {
    case 'WAKE_WORD_DETECTED':
      orchestrator.onWake();
      return;

    case 'TRANSCRIPT':
      orchestrator.onTranscript(m.transcript, m.isFinal, m.lang);
      return;

    case 'OFFSCREEN_STATUS':
      orchestrator.onOffscreenStatus(m.wakeWordReady, m.error);
      return;

    case 'VISION_FRAME':
      // Relay high-frequency tracking frames from offscreen → active tab.
      void orchestrator.relayVisionFrame(m.data);
      return;

    case 'ACTION_RESULT':
      orchestrator.onActionResult(m.action, m.success, m.detail);
      return;

    case 'CONTENT_READY':
      // A tab mounted the content script; nothing required, but useful hook.
      return;

    case 'GET_STATUS': {
      const response: StatusResponse = { status: orchestrator.getStatus() };
      sendResponse(response);
      return true;
    }

    case 'RUN_TASK': {
      void loadSettings().then(async (settings) => {
        const out = await runTask(settings.apiKey, m.request);
        const response: RunTaskResponse = { ok: out.ok, result: out.result, error: out.error };
        sendResponse(response);
      });
      return true; // async response
    }

    case 'TOGGLE_AGENT':
      void patchSettings({ enabled: m.enabled });
      return;

    case 'SETTINGS_CHANGED':
      return;

    case 'REDO_COMMAND':
      void orchestrator.onRedoCommand(m.entryId);
      return;

    case 'CONFIRM_ACTION':
      orchestrator.onConfirmAction();
      return;

    case 'CANCEL_ACTION':
      orchestrator.onCancelAction();
      return;

    case 'MANUAL_COMMAND':
      // Whisper mode special sentinel commands.
      if (m.command === '__WHISPER_START__') {
        orchestrator.onWhisperStart();
        return;
      }
      if (m.command === '__WHISPER_STOP__') {
        orchestrator.onWhisperStop();
        return;
      }
      // Treat typed command like a final voice transcript - same pipeline.
      orchestrator.onWake();
      orchestrator.onTranscript(m.command, true);
      return;

    case 'TAB_ACTION': {
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (!tab?.id) return;
        switch (m.command) {
          case 'close':     void chrome.tabs.remove(tab.id); break;
          case 'new':       void chrome.tabs.create({}); break;
          case 'duplicate': void chrome.tabs.duplicate(tab.id); break;
          case 'reload':    void chrome.tabs.reload(tab.id); break;
        }
      });
      return;
    }

    case 'BOOKMARK_PAGE': {
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (!tab?.url || !tab.title) return;
        // Requires 'bookmarks' permission in manifest.
        void (chrome as unknown as { bookmarks?: { create: (d: object) => void } }).bookmarks?.create?.({
          title: tab.title,
          url: tab.url,
        });
      });
      return;
    }

    case 'GROUP_TABS': {
      void chrome.tabs.query({ currentWindow: true }).then(async (allTabs) => {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        let targetHost = m.hostname;
        if (!targetHost && activeTab?.url) {
          try { targetHost = new URL(activeTab.url).hostname; } catch { /* ignore */ }
        }
        if (!targetHost) return;
        const matchIds = allTabs
          .filter((t) => {
            if (!t.url || !t.id) return false;
            try { return new URL(t.url).hostname === targetHost; } catch { return false; }
          })
          .map((t) => t.id!);
        if (matchIds.length < 2) return;
        // KI-14: chrome.tabs.group / chrome.tabGroups.update aren't available
        // on every Chromium build; failures here used to fail silently.
        try {
          const tabGroupApi = (chrome as unknown as { tabs: { group?: (o: object) => Promise<number> } }).tabs;
          if (!tabGroupApi.group) throw new Error('tab grouping unsupported');
          const groupId = await tabGroupApi.group({ tabIds: matchIds });
          const tabGroupsApi = (chrome as unknown as { tabGroups?: { update: (id: number, props: object) => void } }).tabGroups;
          tabGroupsApi?.update(groupId, { title: targetHost, color: 'blue' });
        } catch {
          if (activeTab?.id) {
            sendToTab(activeTab.id, { type: 'SPEAK', target: 'content', text: "Tab grouping isn't available in this browser." });
          }
        }
      });
      return;
    }

    case 'OPEN_TAB':
      void chrome.tabs.create({ url: m.url });
      return;

    case 'CAPTURE_SCREENSHOT': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => [undefined as chrome.tabs.Tab | undefined]);
      if (!tab?.id) { sendResponse({ ok: false, dataUrl: null }); return; }
      chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 80 }, (dataUrl) => {
        sendResponse({ ok: !!dataUrl, dataUrl: dataUrl ?? null });
      });
      return;
    }

    case 'DESCRIBE_SCREENSHOT': {
      const settings2 = await loadSettings();
      if (!settings2.apiKey) { sendResponse({ ok: false, description: null }); return; }
      const res = await describeScreenshot(settings2.apiKey, m.dataUrl);
      sendResponse(res);
      return;
    }

    case 'TRAIN_MODEL': {
      try {
        const status = await runTraining();
        const resp: TrainModelResponse = { ok: true, accuracy: status.lastAccuracy, error: null };
        sendResponse(resp);
      } catch (e) {
        const resp: TrainModelResponse = { ok: false, accuracy: null, error: (e as Error).message };
        sendResponse(resp);
      }
      return;
    }

    case 'GET_TRAINING_STATUS': {
      const ts = await getTrainingStatus();
      const resp: TrainingStatusResponse = {
        exampleCount: ts.exampleCount,
        lastTrainedAt: ts.lastTrainedAt,
        modelReady: ts.modelReady,
        lastAccuracy: ts.lastAccuracy,
      };
      sendResponse(resp);
      return;
    }

    case 'CLEAR_TRAINING_DATA': {
      await clearExamples();
      return;
    }
  }
  };

  // For async cases, run the handler and keep response channel open.
  const needsAsync = ['GET_STATUS', 'RUN_TASK', 'CAPTURE_SCREENSHOT', 'DESCRIBE_SCREENSHOT', 'TRAIN_MODEL', 'GET_TRAINING_STATUS'].includes((m as { type: string }).type);
  if (needsAsync) {
    void handle();
    return true;
  }
  void handle();
});

/* --------------------- tab grouping suggestion ----------------------------- */

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then((tab) => {
    if (!tab.url) return;
    let hostname: string;
    try { hostname = new URL(tab.url).hostname; } catch { return; }
    if (!hostname || hostname === 'newtab') return;

    chrome.tabs.query({ currentWindow: true }, (allTabs) => {
      const same = allTabs.filter((t) => {
        if (!t.url || t.id === tabId) return false;
        try { return new URL(t.url).hostname === hostname; } catch { return false; }
      });
      // Only suggest if there are ≥2 other tabs from the same domain and
      // the tab is not already in a group (groupId -1 means ungrouped).
      const ungroupedSame = same.filter((t) => t.groupId === chrome.tabs.TAB_ID_NONE || t.groupId === -1);
      if (ungroupedSame.length < 2) return;

      // Throttle: one suggestion per domain per 5 min.
      const throttleKey = `aria.tabgrp.${hostname}`;
      void chrome.storage.session.get(throttleKey).then((raw) => {
        const lastAt = (raw[throttleKey] as number | undefined) ?? 0;
        if (Date.now() - lastAt < 5 * 60 * 1000) return;
        void chrome.storage.session.set({ [throttleKey]: Date.now() });

        // Surface the suggestion in the active tab's HUD.
        const msg = { type: 'SUGGESTION', target: 'content', text: `You have ${ungroupedSame.length + 1} ${hostname} tabs open. Say "group tabs" to organise them.` };
        chrome.tabs.sendMessage(tabId, msg).catch(() => {});
      });
    });
  });
});

/* --------------------------- SW keepalive (M7) ---------------------------- */

const KEEPALIVE_ALARM = 'aria-keepalive';

function ensureKeepAlive(): void {
  // A 20s alarm wakes the SW periodically so it can re-arm the wake-word
  // listener after MV3 idle-terminates the worker.
  chrome.alarms.get(KEEPALIVE_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.34 });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Touching storage is enough to keep the worker warm and re-sync state.
    void applyEnabledState();
    void rearmWakeWordIfIdle();
  }
});

/**
 * KI-01 mitigation: force-restart the offscreen wake-word listener while
 * idle in voice mode, so a listener silently killed by Chrome's offscreen-
 * document throttling (idle >~30s) gets replaced rather than staying dead.
 * Skipped entirely while listening/thinking/acting so we never interrupt an
 * in-progress command.
 */
async function rearmWakeWordIfIdle(): Promise<void> {
  const settings = await loadSettings();
  const status = orchestrator.getStatus();
  if (!shouldRearmWakeWord(settings.enabled, settings.mode, status.state)) return;
  const pvKey = await loadPicovoiceKey();
  sendRuntime({ type: 'STOP_LISTENING', target: 'offscreen' });
  sendRuntime({
    type: 'START_LISTENING',
    target: 'offscreen',
    accessKey: pvKey ?? '',
    wakePhrase: settings.wakeWord ?? 'hey aria',
  });
}
