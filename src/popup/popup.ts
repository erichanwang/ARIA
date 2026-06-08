/**
 * Popup controller - tabbed settings page.
 * Reads/writes AriaSettings, renders live agent status, manages history tab.
 */
import {
  AriaMessage,
  isForMe,
  requestRuntime,
  sendRuntime,
} from '@shared/messages';

import {
  loadPicovoiceKey,
  loadSettings,
  patchSettings,
  savePicovoiceKey,
} from '@shared/settings';
import type { AgentStatus, HistoryEntry, VoiceShorthand } from '@shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// Header
const toggle = $('toggle') as HTMLInputElement;
const agentNameDisplay = $('agent-name-display');

// Status
const statePill = $('state-pill');
const modePill = $('mode-pill');
const confPill = $('conf-pill');
const wakePill = $('wake-pill');

// Tab system
const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');

// General tab
const accentColorInput = $('accent-color') as HTMLInputElement;
const agentNameInput = $('agent-name') as HTMLInputElement;
const apiKeyInput = $('api-key') as HTMLInputElement;
const pvKeyInput = $('pv-key') as HTMLInputElement;
const toggleKeyBtn = $('toggle-key') as HTMLButtonElement;
const modeSelect = $('mode') as HTMLSelectElement;
const confThreshInput = $('conf-threshold') as HTMLInputElement;
const confThreshVal = $('conf-thresh-val');
const confirmActingInput = $('confirm-acting') as HTMLInputElement;
const safeModeInput = $('safe-mode') as HTMLInputElement;
const readingLevelSelect = $('reading-level') as HTMLSelectElement;

// Voice tab
const wakeWordInput = $('wake-word') as HTMLInputElement;
const ttsVoiceSelect = $('tts-voice') as HTMLSelectElement;
const ttsRateInput = $('tts-rate') as HTMLInputElement;
const ttsRateVal = $('tts-rate-val');
const ttsVolInput = $('tts-volume') as HTMLInputElement;
const ttsVolVal = $('tts-vol-val');
const earconsInput = $('earcons') as HTMLInputElement;

// Eye tab
const eyeSensInput = $('eye-sensitivity') as HTMLInputElement;
const eyeSensVal = $('eye-sens-val');
const eyeSmoothInput = $('eye-smoothing') as HTMLInputElement;
const eyeSmoothVal = $('eye-smooth-val');
const browThreshInput = $('brow-threshold') as HTMLInputElement;
const browThreshVal = $('brow-thresh-val');
const dwellInput = $('dwell-time') as HTMLInputElement;
const dwellVal = $('dwell-val');

// Hand tab
const handSensInput = $('hand-sens') as HTMLInputElement;
const handSensVal = $('hand-sens-val');

// Tasks tab
const lastCommand = $('last-command');
const lastAction = $('last-action');
const lastError = $('last-error');
const errorRow = $('error-row');

// History tab
const histList = $('hist-list');
const exportHistoryBtn = $('export-history') as HTMLButtonElement;

// Footer
const connDot = $('conn-dot');
const connText = $('conn-text');

let historyEntries: HistoryEntry[] = [];

void init();

async function init(): Promise<void> {
  const settings = await loadSettings();
  const pvKey = await loadPicovoiceKey();

  // Populate voices asynchronously.
  populateVoices();
  window.speechSynthesis?.addEventListener('voiceschanged', populateVoices);

  // General
  toggle.checked = settings.enabled;
  agentNameDisplay.textContent = settings.agentName || 'ARIA';
  agentNameInput.value = settings.agentName || 'ARIA';
  accentColorInput.value = settings.accentColor ?? '#ff2b2b';
  apiKeyInput.value = settings.apiKey;
  pvKeyInput.value = pvKey;
  modeSelect.value = settings.mode;
  confThreshInput.value = String(settings.confidenceThreshold ?? 0.6);
  confThreshVal.textContent = `${Math.round((settings.confidenceThreshold ?? 0.6) * 100)}%`;
  confirmActingInput.checked = settings.confirmBeforeActing;
  safeModeInput.checked = settings.safeMode ?? false;
  readingLevelSelect.value = settings.readingLevel ?? 'standard';

  // Voice
  wakeWordInput.value = settings.wakeWord || 'Hey ARIA';
  ttsRateInput.value = String(settings.ttsRate);
  ttsRateVal.textContent = `${settings.ttsRate.toFixed(1)}×`;
  ttsVolInput.value = String(settings.ttsVolume ?? 1);
  ttsVolVal.textContent = `${Math.round((settings.ttsVolume ?? 1) * 100)}%`;
  earconsInput.checked = settings.earconsEnabled ?? true;

  // Eye
  eyeSensInput.value = String(settings.eyeSensitivity ?? 1);
  eyeSensVal.textContent = `${(settings.eyeSensitivity ?? 1).toFixed(1)}×`;
  eyeSmoothInput.value = String(settings.eyeSmoothing ?? 0.35);
  eyeSmoothVal.textContent = String(settings.eyeSmoothing ?? 0.35);
  browThreshInput.value = String(settings.browRaiseThreshold ?? 15);
  browThreshVal.textContent = `${settings.browRaiseThreshold ?? 15} px`;
  dwellInput.value = String(settings.dwellTimeMs ?? 800);
  dwellVal.textContent = `${settings.dwellTimeMs ?? 800} ms`;

  // Hand
  handSensInput.value = String(settings.handSensitivity);
  handSensVal.textContent = `${settings.handSensitivity.toFixed(1)}×`;

  modePill.textContent = settings.mode;
  renderConnection(settings.enabled);

  wireEvents(settings.voiceShorthands ?? []);

  const res = await requestRuntime({ type: 'GET_STATUS', target: 'background' });
  if (res) render(res.status);

  chrome.runtime.onMessage.addListener((msg: unknown) => {
    if (!isForMe(msg, 'popup')) return;
    const m = msg as AriaMessage;
    if (m.type === 'STATUS_PUSH') render(m.status);
  });
}

function wireEvents(initialShorthands: VoiceShorthand[]): void {
  // Tab switching
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      tabPanels.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(`tab-${btn.dataset.tab}`);
      panel?.classList.add('active');
    });
  });

  // Toggle
  toggle.addEventListener('change', async () => {
    await patchSettings({ enabled: toggle.checked });
    sendRuntime({ type: 'TOGGLE_AGENT', target: 'background', enabled: toggle.checked });
    renderConnection(toggle.checked);
  });

  // General
  agentNameInput.addEventListener('change', async () => {
    const name = agentNameInput.value.trim() || 'ARIA';
    agentNameDisplay.textContent = name;
    await patchSettings({ agentName: name });
  });

  accentColorInput.addEventListener('input', () => void patchSettings({ accentColor: accentColorInput.value }));
  apiKeyInput.addEventListener('change', () => void patchSettings({ apiKey: apiKeyInput.value.trim() }));
  pvKeyInput.addEventListener('change', () => void savePicovoiceKey(pvKeyInput.value.trim()));
  toggleKeyBtn.addEventListener('click', () => {
    const show = apiKeyInput.type === 'password';
    apiKeyInput.type = show ? 'text' : 'password';
    pvKeyInput.type = show ? 'text' : 'password';
  });

  $('test-api-key').addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const hint = $('api-key-hint');
    if (!key) { hint.textContent = 'Enter an API key first.'; hint.style.color = '#ff8c00'; return; }
    hint.textContent = 'Testing…';
    hint.style.color = '#9aa0aa';
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'say hi' }],
        }),
      });
      if (res.ok) {
        hint.textContent = 'Connection successful.';
        hint.style.color = '#4ade80';
      } else {
        const data = await res.json() as { error?: { message?: string } };
        hint.textContent = `Error: ${data.error?.message ?? res.statusText}`;
        hint.style.color = '#ff8c00';
      }
    } catch (e) {
      hint.textContent = `Network error: ${(e as Error).message}`;
      hint.style.color = '#ff8c00';
    }
  });

  modeSelect.addEventListener('change', async () => {
    const mode = modeSelect.value as 'voice' | 'eye' | 'hand' | 'manual';
    modePill.textContent = mode;
    await patchSettings({ mode });
    if (toggle.checked) sendRuntime({ type: 'TOGGLE_AGENT', target: 'background', enabled: true });
  });

  confThreshInput.addEventListener('input', () => {
    const v = Number(confThreshInput.value);
    confThreshVal.textContent = `${Math.round(v * 100)}%`;
  });
  confThreshInput.addEventListener('change', () =>
    void patchSettings({ confidenceThreshold: Number(confThreshInput.value) }),
  );
  confirmActingInput.addEventListener('change', () =>
    void patchSettings({ confirmBeforeActing: confirmActingInput.checked }),
  );
  safeModeInput.addEventListener('change', () =>
    void patchSettings({ safeMode: safeModeInput.checked }),
  );
  readingLevelSelect.addEventListener('change', () =>
    void patchSettings({ readingLevel: readingLevelSelect.value as 'simple' | 'standard' | 'advanced' }),
  );

  // Voice
  wakeWordInput.addEventListener('change', () =>
    void patchSettings({ wakeWord: wakeWordInput.value.trim() || 'Hey ARIA' }),
  );
  ttsVoiceSelect.addEventListener('change', () =>
    void patchSettings({ ttsVoiceURI: ttsVoiceSelect.value || null }),
  );
  ttsRateInput.addEventListener('input', () => { ttsRateVal.textContent = `${Number(ttsRateInput.value).toFixed(1)}×`; });
  ttsRateInput.addEventListener('change', () => void patchSettings({ ttsRate: Number(ttsRateInput.value) }));
  ttsVolInput.addEventListener('input', () => { ttsVolVal.textContent = `${Math.round(Number(ttsVolInput.value) * 100)}%`; });
  ttsVolInput.addEventListener('change', () => void patchSettings({ ttsVolume: Number(ttsVolInput.value) }));
  earconsInput.addEventListener('change', () => void patchSettings({ earconsEnabled: earconsInput.checked }));

  // Eye
  eyeSensInput.addEventListener('input', () => { eyeSensVal.textContent = `${Number(eyeSensInput.value).toFixed(1)}×`; });
  eyeSensInput.addEventListener('change', () => void patchSettings({ eyeSensitivity: Number(eyeSensInput.value) }));
  eyeSmoothInput.addEventListener('input', () => { eyeSmoothVal.textContent = eyeSmoothInput.value; });
  eyeSmoothInput.addEventListener('change', () => void patchSettings({ eyeSmoothing: Number(eyeSmoothInput.value) }));
  browThreshInput.addEventListener('input', () => { browThreshVal.textContent = `${browThreshInput.value} px`; });
  browThreshInput.addEventListener('change', () => void patchSettings({ browRaiseThreshold: Number(browThreshInput.value) }));
  dwellInput.addEventListener('input', () => { dwellVal.textContent = `${dwellInput.value} ms`; });
  dwellInput.addEventListener('change', () => void patchSettings({ dwellTimeMs: Number(dwellInput.value) }));

  // Hand
  handSensInput.addEventListener('input', () => { handSensVal.textContent = `${Number(handSensInput.value).toFixed(1)}×`; });
  handSensInput.addEventListener('change', () => void patchSettings({ handSensitivity: Number(handSensInput.value) }));

  // Tasks
  $('task-mcq').addEventListener('click', () => startTask('mcq'));
  $('task-trivia').addEventListener('click', () => startTask('trivia'));
  $('task-formfill').addEventListener('click', () => startTask('formfill'));
  $('task-summarize').addEventListener('click', () => startTask('summarize'));
  $('task-a11y').addEventListener('click', () => startTask('a11y'));
  $('task-screenshot').addEventListener('click', () => startTask('screenshot'));

  // Voice shorthands
  renderShorthands(initialShorthands);
  $('add-shorthand').addEventListener('click', () => {
    void loadSettings().then((s) => {
      const next = [...(s.voiceShorthands ?? []), { trigger: '', expansion: '' }];
      void patchSettings({ voiceShorthands: next }).then(() => renderShorthands(next));
    });
  });

  // Settings import/export
  $('export-settings').addEventListener('click', () => void exportSettings());
  $('import-settings').addEventListener('click', () => $<HTMLInputElement>('import-file').click());
  $<HTMLInputElement>('import-file').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.settings) void patchSettings(data.settings).then(() => location.reload());
      } catch { /* bad file */ }
    };
    reader.readAsText(file);
  });

  // History
  exportHistoryBtn.addEventListener('click', () => exportHistory());
  $('clear-history').addEventListener('click', async () => {
    await chrome.storage.local.remove('aria.history');
    historyEntries = [];
    renderHistory([]);
  });
}

function render(status: AgentStatus): void {
  statePill.textContent = status.state;
  statePill.dataset.state = status.state;
  modePill.textContent = status.mode;
  wakePill.textContent = status.wakeWordReady ? 'ready' : '—';

  if (status.lastConfidence !== null) {
    const pct = Math.round(status.lastConfidence * 100);
    confPill.textContent = `${pct}%`;
    confPill.style.color = pct < 60 ? '#ff8c00' : pct < 80 ? '#ffd580' : '#4ade80';
  }

  lastCommand.textContent = status.lastCommand ?? '—';
  lastAction.textContent = status.lastAction ?? '—';

  if (status.lastError) {
    errorRow.hidden = false;
    // Show vision-specific guidance.
    if (status.lastError.startsWith('vision:')) {
      lastError.textContent = 'Camera/WASM failed to load. Make sure you are not offline and that extension permissions include camera access. Try disabling other camera extensions.';
    } else if (status.lastError.includes('401') || status.lastError.includes('API key')) {
      lastError.textContent = 'Invalid API key — enter a valid sk-ant-… key in the General tab.';
    } else {
      lastError.textContent = status.lastError;
    }
  } else {
    errorRow.hidden = true;
  }
}

function renderConnection(enabled: boolean): void {
  connDot.dataset.on = String(enabled);
  connText.textContent = enabled ? 'active' : 'disabled';
}

async function startTask(task: 'mcq' | 'trivia' | 'formfill' | 'summarize' | 'a11y' | 'screenshot'): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) {
    chrome.tabs.sendMessage(tab.id, { type: 'START_TASK_UI', target: 'content', task }).catch(() => {});
  }
  window.close();
}

function populateVoices(): void {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const current = ttsVoiceSelect.value;
  ttsVoiceSelect.innerHTML = '<option value="">System default</option>';
  voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    ttsVoiceSelect.appendChild(opt);
  });
  if (current) ttsVoiceSelect.value = current;
}

// History tab: populated by STATUS_PUSH carrying history (we re-use the
// existing status push and also cache entries locally via session).
// The popup pulls its initial history snapshot from chrome.storage.local.
const HISTORY_KEY = 'aria.history';

async function loadHistory(): Promise<void> {
  const raw = await chrome.storage.local.get(HISTORY_KEY);
  const entries = (raw[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
  historyEntries = entries;
  renderHistory(entries);
}

function renderHistory(entries: HistoryEntry[]): void {
  histList.innerHTML = '';
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'hist-empty';
    li.textContent = 'No commands yet this session.';
    histList.appendChild(li);
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'hist-entry';

    const badge = document.createElement('span');
    badge.className = `hist-badge ${e.success ? 'ok' : 'fail'}`;
    badge.textContent = e.success ? '✓' : '✗';

    const text = document.createElement('div');
    text.className = 'hist-text';

    const cmd = document.createElement('span');
    cmd.className = 'hist-cmd';
    cmd.textContent = e.command;

    const meta = document.createElement('span');
    meta.className = 'hist-meta';
    meta.textContent = `${e.action} · ${Math.round(e.confidence * 100)}% · ${relTime(e.timestamp)}`;

    text.append(cmd, meta);
    li.append(badge, text);
    histList.appendChild(li);
  }
}

void loadHistory();

function exportHistory(): void {
  const blob = new Blob([JSON.stringify(historyEntries, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aria-history-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportSettings(): Promise<void> {
  const settings = await loadSettings();
  const blob = new Blob([JSON.stringify({ settings }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aria-settings-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderShorthands(shorthands: VoiceShorthand[]): void {
  const list = $('shorthand-list');
  list.innerHTML = '';
  shorthands.forEach((s, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center';

    const triggerInput = document.createElement('input');
    triggerInput.type = 'text';
    triggerInput.placeholder = 'trigger';
    triggerInput.value = s.trigger;
    triggerInput.style.cssText = 'flex:1;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:#1d1d25;color:#f3f3f7;font-size:12px;min-width:0';

    const expandInput = document.createElement('input');
    expandInput.type = 'text';
    expandInput.placeholder = 'expansion';
    expandInput.value = s.expansion;
    expandInput.style.cssText = 'flex:2;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:#1d1d25;color:#f3f3f7;font-size:12px;min-width:0';

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:13px;padding:0 4px';
    delBtn.addEventListener('click', () => {
      void loadSettings().then((st) => {
        const next = (st.voiceShorthands ?? []).filter((_, j) => j !== i);
        void patchSettings({ voiceShorthands: next }).then(() => renderShorthands(next));
      });
    });

    const save = () => {
      void loadSettings().then((st) => {
        const next = [...(st.voiceShorthands ?? [])];
        next[i] = { trigger: triggerInput.value.trim(), expansion: expandInput.value.trim() };
        void patchSettings({ voiceShorthands: next });
      });
    };
    triggerInput.addEventListener('change', save);
    expandInput.addEventListener('change', save);

    row.append(triggerInput, expandInput, delBtn);
    list.appendChild(row);
  });
}

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/* ─────────────────── AI / offline neural net tab ─────────────────── */

const nnStatus = $('nn-status');
const nnExamples = $('nn-examples');
const nnTrained = $('nn-trained');
const nnAccuracy = $('nn-accuracy');
const nnLog = $('nn-log');

void loadNNStatus();

async function loadNNStatus(): Promise<void> {
  const res = await requestRuntime({ type: 'GET_TRAINING_STATUS', target: 'background' });
  if (!res) return;
  nnStatus.textContent = res.modelReady ? 'ready' : 'not trained';
  nnStatus.style.color = res.modelReady ? '#4ade80' : '#9aa0aa';
  nnExamples.textContent = String(res.exampleCount);
  nnTrained.textContent = res.lastTrainedAt ? relTime(res.lastTrainedAt) : 'never';
  nnAccuracy.textContent = res.lastAccuracy !== null ? `${Math.round(res.lastAccuracy * 100)}%` : '—';
}

$('nn-train').addEventListener('click', async () => {
  nnLog.textContent = 'Training… (this may take a few seconds)';
  nnLog.style.color = '#9aa0aa';
  const res = await requestRuntime({ type: 'TRAIN_MODEL', target: 'background' });
  if (res?.ok) {
    nnLog.textContent = `Training complete. Accuracy: ${Math.round((res.accuracy ?? 0) * 100)}%`;
    nnLog.style.color = '#4ade80';
    void loadNNStatus();
  } else {
    nnLog.textContent = `Training failed: ${res?.error ?? 'unknown error'}`;
    nnLog.style.color = '#ff8c00';
  }
});

$('nn-clear').addEventListener('click', async () => {
  sendRuntime({ type: 'CLEAR_TRAINING_DATA', target: 'background' });
  nnLog.textContent = 'Training data cleared.';
  nnLog.style.color = '#9aa0aa';
  void loadNNStatus();
});

/* -------------------------------- macros --------------------------------- */

interface MacroEntry { name: string; commands: string[]; createdAt: number }
const MACRO_KEY = 'aria.macros';

void loadMacros();

async function loadMacros(): Promise<void> {
  const raw = await chrome.storage.local.get(MACRO_KEY);
  const macros = (raw[MACRO_KEY] as MacroEntry[] | undefined) ?? [];
  renderMacros(macros);
}

function renderMacros(macros: MacroEntry[]): void {
  const list = $('macro-list');
  list.innerHTML = '';
  if (macros.length === 0) {
    const li = document.createElement('li');
    li.className = 'hist-empty';
    li.textContent = 'No macros saved yet.';
    list.appendChild(li);
    return;
  }
  for (const m of macros) {
    const li = document.createElement('li');
    li.className = 'hist-entry';

    const text = document.createElement('div');
    text.className = 'hist-text';

    const name = document.createElement('span');
    name.className = 'hist-cmd';
    name.textContent = m.name;

    const meta = document.createElement('span');
    meta.className = 'hist-meta';
    meta.textContent = `${m.commands.length} step${m.commands.length !== 1 ? 's' : ''} · ${relTime(m.createdAt)}`;

    const del = document.createElement('button');
    del.textContent = '✕';
    del.style.cssText = 'background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:12px;padding:0 4px;margin-left:auto';
    del.addEventListener('click', async () => {
      const fresh = await chrome.storage.local.get(MACRO_KEY);
      const all = (fresh[MACRO_KEY] as MacroEntry[] | undefined) ?? [];
      const updated = all.filter((x) => x.name !== m.name);
      await chrome.storage.local.set({ [MACRO_KEY]: updated });
      renderMacros(updated);
    });

    text.append(name, meta);
    li.style.cssText = 'display:flex;align-items:center';
    li.append(text, del);
    list.appendChild(li);
  }
}
