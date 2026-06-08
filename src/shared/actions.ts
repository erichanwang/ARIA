/**
 * The Claude API action contract - the single source of truth for what the
 * agent is allowed to do. Claude returns one of these objects; the content
 * script executes it.
 *
 * Contract (from the build spec):
 *   { action, target?, text?, url?, direction?, speech }
 *   actions: answer | click | scroll | navigate | read_aloud | highlight | none
 *
 * We model this as a Zod discriminated union so each action only carries the
 * fields it actually needs, and validation rejects malformed Claude output
 * before it ever reaches the DOM executor.
 */
import { z } from 'zod';

export const ScrollDirection = z.enum(['up', 'down', 'top', 'bottom']);
export const ScrollAmount = z.enum(['small', 'medium', 'large']);

// Every action MUST carry a `speech` string - the natural-language sentence
// the agent speaks aloud. This is what makes ARIA feel responsive.
const speech = z.string().min(1, 'speech is required');

export const AnswerAction = z.object({
  action: z.literal('answer'),
  text: z.string().min(1),
  speech,
});

export const ClickAction = z.object({
  action: z.literal('click'),
  // Natural-language description of the element, e.g. "the login button".
  target: z.string().min(1),
  speech,
});

export const ScrollAction = z.object({
  action: z.literal('scroll'),
  direction: ScrollDirection,
  amount: ScrollAmount.optional().default('medium'),
  speech,
});

export const NavigateAction = z.object({
  action: z.literal('navigate'),
  url: z.string().min(1),
  speech,
});

export const ReadAloudAction = z.object({
  action: z.literal('read_aloud'),
  // Optional CSS-ish hint for where the main content lives.
  selector: z.string().optional(),
  speech,
});

export const HighlightAction = z.object({
  action: z.literal('highlight'),
  // Exact text to find + highlight on the page.
  text: z.string().min(1),
  speech,
});

export const NoneAction = z.object({
  action: z.literal('none'),
  speech,
});

export const SummarizeAction = z.object({
  action: z.literal('summarize'),
  speech,
});

export const ExplainAction = z.object({
  action: z.literal('explain'),
  selection: z.string().min(1),
  explanation: z.string().min(1),
  speech,
});

// A step within a multi-step plan - intentionally loose so the discriminated
// union can handle any single-step action type at runtime.
export const PlanStep = z.object({
  action: z.string(),
  target: z.string().optional(),
  url: z.string().optional(),
  direction: z.string().optional(),
  amount: z.string().optional(),
  text: z.string().optional(),
  speech: z.string().default(''),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const MultiStepAction = z.object({
  action: z.literal('multi_step'),
  steps: z.array(PlanStep).min(1).max(10),
  speech,
});

export const OpenTabAction = z.object({
  action: z.literal('open_tab'),
  url: z.string().min(1),
  speech,
});

export const PasteClipboardAction = z.object({
  action: z.literal('paste_clipboard'),
  target: z.string().optional(), // element to paste into (natural-language)
  speech,
});

export const TypeIntoAction = z.object({
  action: z.literal('type_into'),
  target: z.string().min(1), // element description
  text: z.string().min(1),   // text to type
  clear: z.boolean().optional().default(false), // whether to clear existing value first
  speech,
});

export const SelectTextAction = z.object({
  action: z.literal('select_text'),
  text: z.string().min(1), // exact text to select (verbatim from page)
  speech,
});

export const SubmitFormAction = z.object({
  action: z.literal('submit_form'),
  target: z.string().optional(), // form or submit button description
  speech,
});

export const PressKeyAction = z.object({
  action: z.literal('press_key'),
  key: z.string().min(1), // key name: Escape, Enter, Tab, Space, ArrowDown, etc.
  modifiers: z.array(z.enum(['ctrl', 'alt', 'shift', 'meta'])).optional().default([]),
  speech,
});

export const MediaControlAction = z.object({
  action: z.literal('media_control'),
  command: z.enum(['play', 'pause', 'toggle_play', 'mute', 'unmute', 'volume_up', 'volume_down', 'fullscreen']),
  speech,
});

export const ZoomPageAction = z.object({
  action: z.literal('zoom_page'),
  direction: z.enum(['in', 'out', 'reset']),
  speech,
});

export const TranslateAction = z.object({
  action: z.literal('translate'),
  text: z.string().min(1),      // text to translate (usually selected or page excerpt)
  targetLang: z.string().min(1), // language name or code, e.g. "Spanish", "fr"
  translation: z.string().min(1), // the translated text (Claude does the translation)
  speech,
});

export const NavigateHeadingAction = z.object({
  action: z.literal('navigate_heading'),
  direction: z.enum(['next', 'prev', 'first']),
  level: z.number().int().min(1).max(6).optional(), // if omitted, any heading level
  speech,
});

export const SpeakSelectionAction = z.object({
  action: z.literal('speak_selection'),
  speech, // agent reads aloud what's selected
});

export const FindOnPageAction = z.object({
  action: z.literal('find_on_page'),
  query: z.string().min(1), // text to find (all occurrences)
  speech,
});

export const DictateAction = z.object({
  action: z.literal('dictate'),
  target: z.string().optional(), // element to dictate into (optional; uses focused el)
  speech,
});

export const TabAction = z.object({
  action: z.literal('tab_action'),
  command: z.enum(['close', 'new', 'duplicate', 'reload']),
  speech,
});

export const BrowserNavAction = z.object({
  action: z.literal('browser_nav'),
  command: z.enum(['back', 'forward', 'reload', 'home']),
  speech,
});

export const BookmarkAction = z.object({
  action: z.literal('bookmark_page'),
  speech,
});

export const AutoScrollAction = z.object({
  action: z.literal('auto_scroll'),
  command: z.enum(['start', 'stop', 'pause', 'faster', 'slower']),
  speech,
});

export const CopyToClipboardAction = z.object({
  action: z.literal('copy_to_clipboard'),
  text: z.string().optional(), // if omitted, copy current selection
  speech,
});

export const OpenOutlineAction = z.object({
  action: z.literal('open_outline'),
  speech,
});

export const GroupTabsAction = z.object({
  action: z.literal('group_tabs'),
  hostname: z.string().optional(), // group tabs from this domain; defaults to current
  speech,
});

export const ScrollToPercentAction = z.object({
  action: z.literal('scroll_to_percent'),
  percent: z.number().min(0).max(100),
  speech,
});

export const AnnotateAction = z.object({
  action: z.literal('annotate'),
  note: z.string().min(1),
  speech,
});

// ── Feature Explosion actions ────────────────────────────────────────────────

export const PageMoodAction = z.object({
  action: z.literal('page_mood'),
  mood: z.string().min(1),     // short vibe description
  suggestion: z.string().min(1), // proactive follow-up offer
  speech,
});

export const HighlightInteractiveAction = z.object({
  action: z.literal('highlight_interactive'),
  speech,
});

export const WatchPriceAction = z.object({
  action: z.literal('watch_price'),
  speech,
});

export const CheckLinksAction = z.object({
  action: z.literal('check_links'),
  speech,
});

export const PageDiffAction = z.object({
  action: z.literal('page_diff'),
  speech,
});

export const FlashcardModeAction = z.object({
  action: z.literal('flashcard_mode'),
  speech,
});

export const DebateModeAction = z.object({
  action: z.literal('debate_mode'),
  topic: z.string().min(1),
  speech,
});

export const EssayCriticAction = z.object({
  action: z.literal('essay_critic'),
  speech,
});

export const InterviewModeAction = z.object({
  action: z.literal('interview_mode'),
  role: z.string().min(1),
  speech,
});

export const FocusTimerAction = z.object({
  action: z.literal('focus_timer'),
  minutes: z.number().int().min(1).max(120).default(25),
  command: z.enum(['start', 'stop']).default('start'),
  speech,
});

export const ShoppingListAction = z.object({
  action: z.literal('shopping_list'),
  command: z.enum(['add', 'read', 'clear', 'export']),
  speech,
});

export const DailyBriefingAction = z.object({
  action: z.literal('daily_briefing'),
  speech,
});

export const MiniModeAction = z.object({
  action: z.literal('mini_mode'),
  enabled: z.boolean(),
  speech,
});

export const ShowTranscriptAction = z.object({
  action: z.literal('show_transcript'),
  speech,
});

export const SpotlightElementAction = z.object({
  action: z.literal('spotlight_element'),
  target: z.string().min(1),
  speech,
});

export const ComparisonShopAction = z.object({
  action: z.literal('comparison_shop'),
  speech,
});

export const LanguageTutorAction = z.object({
  action: z.literal('language_tutor'),
  targetLang: z.string().min(1),
  speech,
});

export const GestureTrainerAction = z.object({
  action: z.literal('gesture_trainer'),
  speech,
});

export const DocQAAction = z.object({
  action: z.literal('doc_qa'),
  speech,
  /** If provided, immediately answers this question about the current page. */
  question: z.string().optional(),
});

export const AgentAction = z.discriminatedUnion('action', [
  AnswerAction,
  ClickAction,
  ScrollAction,
  NavigateAction,
  ReadAloudAction,
  HighlightAction,
  NoneAction,
  SummarizeAction,
  ExplainAction,
  MultiStepAction,
  OpenTabAction,
  PasteClipboardAction,
  TypeIntoAction,
  SelectTextAction,
  SubmitFormAction,
  PressKeyAction,
  MediaControlAction,
  ZoomPageAction,
  TranslateAction,
  NavigateHeadingAction,
  SpeakSelectionAction,
  FindOnPageAction,
  DictateAction,
  TabAction,
  BrowserNavAction,
  BookmarkAction,
  AutoScrollAction,
  CopyToClipboardAction,
  OpenOutlineAction,
  GroupTabsAction,
  ScrollToPercentAction,
  AnnotateAction,
  PageMoodAction,
  HighlightInteractiveAction,
  WatchPriceAction,
  CheckLinksAction,
  PageDiffAction,
  FlashcardModeAction,
  DebateModeAction,
  EssayCriticAction,
  InterviewModeAction,
  FocusTimerAction,
  ShoppingListAction,
  DailyBriefingAction,
  MiniModeAction,
  ShowTranscriptAction,
  SpotlightElementAction,
  ComparisonShopAction,
  LanguageTutorAction,
  GestureTrainerAction,
  DocQAAction,
]);

export type AgentAction = z.infer<typeof AgentAction>;
export type ActionType = AgentAction['action'];

/**
 * Parse + validate raw text from Claude into a typed action.
 * Claude is instructed to return bare JSON, but models occasionally wrap it in
 * ```json fences or add a stray sentence - we defensively extract the first
 * top-level JSON object before validating.
 */
export function parseAgentAction(raw: string):
  | { ok: true; action: AgentAction }
  | { ok: false; error: string } {
  if (raw.trimStart().startsWith('[')) {
    return { ok: false, error: 'Model output must be a single JSON object.' };
  }
  const json = extractFirstJsonObject(raw);
  if (json === null) {
    return { ok: false, error: 'No JSON object found in model output.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const result = AgentAction.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, action: result.data };
}

/**
 * Scan for the first balanced `{...}` block. Handles models that prepend prose
 * or wrap output in markdown fences. String-aware so braces inside JSON string
 * values don't throw off the brace counter.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
