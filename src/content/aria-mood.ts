/**
 * ARIA Mood System
 * Subtle emotional state driven by interaction patterns.
 * Injects mood-appropriate phrasing prefixes into speech.
 * State resets on new session (page reload).
 */

export type AriaMood = 'confident' | 'careful' | 'apologetic' | 'excited';

interface MoodState {
  mood: AriaMood;
  successStreak: number;
  failStreak: number;
  totalCommands: number;
}

const state: MoodState = {
  mood: 'confident',
  successStreak: 0,
  failStreak: 0,
  totalCommands: 0,
};

export function recordOutcome(success: boolean): void {
  state.totalCommands++;
  if (success) {
    state.successStreak++;
    state.failStreak = 0;
  } else {
    state.failStreak++;
    state.successStreak = 0;
  }
  updateMood();
}

function updateMood(): void {
  if (state.failStreak >= 3) {
    state.mood = 'apologetic';
  } else if (state.failStreak >= 1) {
    state.mood = 'careful';
  } else if (state.successStreak >= 5) {
    state.mood = 'excited';
  } else {
    state.mood = 'confident';
  }
}

export function getCurrentMood(): AriaMood {
  return state.mood;
}

/** Optionally prepend a mood-flavored phrase to a speech string. */
export function applyMoodToSpeech(speech: string): string {
  // Only apply occasionally to avoid becoming annoying.
  if (Math.random() > 0.3) return speech;

  const mood = state.mood;
  const prefix = pickPrefix(mood);
  if (!prefix) return speech;
  return `${prefix} ${speech}`;
}

function pickPrefix(mood: AriaMood): string {
  const prefixes: Record<AriaMood, string[]> = {
    confident: ["Got it.", "Sure!", "On it."],
    excited: ["Absolutely!", "Great choice!", "Love it!"],
    careful: ["Let me be careful here.", "Just to be safe —", "I'll take it slow."],
    apologetic: ["I'm sorry about the trouble.", "Let me try again —", "My apologies —"],
  };
  const list = prefixes[mood];
  return list[Math.floor(Math.random() * list.length)];
}
