/**
 * Shared domain types used across background / content / offscreen / popup.
 * Pure types only - no runtime code that would create cross-context coupling.
 */

/** Visual + behavioral states of the agent cursor. Drives CSS via data-state. */
export type CursorState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'acting'
  | 'error';

/** Which input modality is currently driving the cursor. */
export type InputMode = 'voice' | 'eye' | 'hand' | 'manual';

/** Page context handed to Claude with every command. */
export interface PageContext {
  url: string;
  title: string;
  excerpt: string;
  selected_text: string;
  /** F30: Last known gaze screen position (normalized 0–1), if eye mode is active. */
  gazePos?: { x: number; y: number };
}

/** Persisted settings (chrome.storage.local). API key NEVER leaves local. */
export interface AriaSettings {
  enabled: boolean;
  apiKey: string;
  mode: InputMode;
  wakeWord: string;
  ttsRate: number;
  ttsVoiceURI: string | null;
  ttsVolume: number;
  cursorScale: number;
  confirmBeforeActing: boolean;
  handSensitivity: number;
  agentName: string;
  earconsEnabled: boolean;
  confidenceThreshold: number;
  eyeSensitivity: number;
  eyeSmoothing: number;
  browRaiseThreshold: number;
  dwellTimeMs: number;
  voiceShorthands: VoiceShorthand[];
  readingLevel: 'simple' | 'standard' | 'advanced';
  accentColor: string;
  safeMode: boolean;
  /** 'byok' = user provides their own key. 'hosted' = reserved for future managed key option. */
  keyMode: 'byok' | 'hosted';

  // ── Feature Explosion settings ──────────────────────────────────────────────

  /** F03: Warn before clicking elements with destructive-sounding labels. */
  dangerZoneDetection: boolean;
  /** F05: Automatically announce page info on every navigation. */
  autoPageReader: boolean;
  /** F11: Hold Ctrl+Space to talk instead of using the wake word. */
  whisperMode: boolean;
  /** F20: Show live noise level meter in HUD while listening. */
  noiseIndicator: boolean;
  /** F22: Speak a rest reminder after this many continuous eye-mode minutes. */
  eyeFatigueAlertMins: number;
  /** F38: Domains blocked during Pomodoro focus sessions. */
  focusBlocklist: string[];
  /** F41: Visual theme applied to the agent cursor. */
  cursorSkin: 'default' | 'ghost' | 'hacker' | 'pastel' | 'blueprint' | 'minimal';
  /** F46: Collapse ARIA UI to a small corner pill. */
  miniMode: boolean;
  /** F49: Subtle emotional state in TTS phrasing. */
  ariaMoodEnabled: boolean;
  /** F50: Narrate every agent action aloud as it happens. */
  selfNarration: boolean;
  /** F35: URLs visited in sequence during a daily briefing. */
  dailyBriefingUrls: string[];
}

export const DEFAULT_SETTINGS: AriaSettings = {
  enabled: false,
  apiKey: '',
  mode: 'voice',
  wakeWord: 'Hey ARIA',
  ttsRate: 1.0,
  ttsVoiceURI: null,
  ttsVolume: 1.0,
  cursorScale: 1.0,
  confirmBeforeActing: false,
  handSensitivity: 1.0,
  agentName: 'ARIA',
  earconsEnabled: true,
  confidenceThreshold: 0.6,
  eyeSensitivity: 1.0,
  eyeSmoothing: 0.35,
  browRaiseThreshold: 15,
  dwellTimeMs: 800,
  voiceShorthands: [],
  readingLevel: 'standard',
  accentColor: '#ff2b2b',
  safeMode: false,
  keyMode: 'byok',
  dangerZoneDetection: true,
  autoPageReader: false,
  whisperMode: false,
  noiseIndicator: true,
  eyeFatigueAlertMins: 20,
  focusBlocklist: ['twitter.com', 'x.com', 'reddit.com', 'youtube.com', 'facebook.com'],
  cursorSkin: 'default',
  miniMode: false,
  ariaMoodEnabled: true,
  selfNarration: false,
  dailyBriefingUrls: [],
};

/** User-defined voice shorthand: "home" → "navigate to https://mysite.com" */
export interface VoiceShorthand {
  trigger: string;
  expansion: string;
}

/** One entry in the command history (for the history panel + session context). */
export interface HistoryEntry {
  id: number;
  command: string;
  action: string;
  speech: string;
  success: boolean;
  confidence: number;
  timestamp: number;
}

/** Snapshot of agent runtime state, surfaced in the popup. */
export interface AgentStatus {
  state: CursorState;
  mode: InputMode;
  lastCommand: string | null;
  lastAction: string | null;
  lastError: string | null;
  lastConfidence: number | null;
  wakeWordReady: boolean;
}
