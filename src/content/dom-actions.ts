/**
 * Executes a validated AgentAction against the live page. Coordinates the
 * cursor (animate-to-target before acting), TTS (speak the `speech` field),
 * and the HUD. The six action types map 1:1 to methods here.
 */
import type { AgentAction, PlanStep } from '@shared/actions';
import { findElement, isVisible, teachTarget } from './dom-finder';
import { extractMainText } from './page-context';
import { clickElement } from './synthetic-click';
import { previewAction } from './action-preview';
import { sendRuntime } from '@shared/messages';
import { showInteractiveElements } from './element-highlighter';
import { watchCurrentPrice } from './price-watcher';
import { diffPageSnapshot } from './page-diff';
import { addCurrentProductToList, readShoppingList, clearShoppingList, exportShoppingList } from './shopping-list';
import { startFocusTimer, stopFocusTimer } from './focus-timer';
import { runFlashcardMode } from './tasks/flashcard';
import { runDebateMode } from './tasks/debate';
import { runEssayCritic } from './tasks/essay-critic';
import { runInterviewPrep } from './tasks/interview-prep';
import { runDailyBriefing } from './tasks/daily-briefing';
import { runLanguageTutor } from './tasks/language-tutor';
import { runGestureTrainer } from './tasks/gesture-trainer';
import { runDocQA, answerDocQuestion } from './tasks/doc-qa';
import { toggleFloatingTranscript } from './floating-transcript';
import { maybeShowTutorial } from './feature-tutorial';
import { showToast } from './toast-notifications';
import type { AgentCursor } from './cursor';
import type { Hud } from './hud';
import type { Speech } from './speech';

export interface ActionDeps {
  cursor: AgentCursor;
  hud: Hud;
  speech: Speech;
  /** Background owns chrome.tabs; navigation is delegated up the bus. */
  navigate: (url: string) => void;
  /** Feature flags from settings (optional - safe to omit). */
  dangerZoneDetection?: boolean;
  selfNarration?: boolean;
  focusBlocklist?: string[];
  ariaMoodEnabled?: boolean;
}

export interface ActionOutcome {
  success: boolean;
  detail: string | null;
}

export class ActionExecutor {
  private teachPending: { target: string; cleanup: () => void } | null = null;
  private aborted = false;

  constructor(private deps: ActionDeps) {
    injectHighlightStyle();
    // Cancel cleanly if the page navigates or unloads during an action.
    window.addEventListener('beforeunload', () => { this.aborted = true; }, { once: true });
    window.addEventListener('pagehide', () => { this.aborted = true; }, { once: true });
  }

  async execute(action: AgentAction): Promise<ActionOutcome> {
    this.aborted = false;
    switch (action.action) {
      case 'answer':
        return this.answer(action.speech);
      case 'highlight':
        return this.highlight(action.text, action.speech);
      case 'click':
        return this.click(action.target, action.speech);
      case 'scroll':
        return this.scroll(action.direction, action.amount, action.speech);
      case 'navigate':
        return this.navigateTo(action.url, action.speech);
      case 'read_aloud':
        return this.readAloud(action.speech);
      case 'summarize':
        return this.summarize(action.speech);
      case 'explain':
        return this.explain(action.selection, action.explanation, action.speech);
      case 'multi_step':
        return this.multiStep(action.steps, action.speech);
      case 'open_tab':
        return this.openTab(action.url, action.speech);
      case 'paste_clipboard':
        return this.pasteClipboard(action.target ?? null, action.speech);
      case 'type_into':
        return this.typeInto(action.target, action.text, action.clear ?? false, action.speech);
      case 'select_text':
        return this.selectText(action.text, action.speech);
      case 'submit_form':
        return this.submitForm(action.target ?? null, action.speech);
      case 'press_key':
        return this.pressKey(action.key, action.modifiers ?? [], action.speech);
      case 'media_control':
        return this.mediaControl(action.command, action.speech);
      case 'zoom_page':
        return this.zoomPage(action.direction, action.speech);
      case 'translate':
        return this.translate(action.translation, action.speech);
      case 'navigate_heading':
        return this.navigateHeading(action.direction, action.level ?? null, action.speech);
      case 'speak_selection':
        return this.speakSelection(action.speech);
      case 'find_on_page':
        return this.findOnPage(action.query, action.speech);
      case 'dictate':
        return this.startDictation(action.target ?? null, action.speech);
      case 'tab_action':
        return this.tabAction(action.command, action.speech);
      case 'browser_nav':
        return this.browserNav(action.command, action.speech);
      case 'bookmark_page':
        return this.bookmarkPage(action.speech);
      case 'auto_scroll':
        return this.autoScroll(action.command, action.speech);
      case 'copy_to_clipboard':
        return this.copyToClipboard(action.text ?? null, action.speech);
      case 'open_outline':
        return this.openOutline(action.speech);
      case 'group_tabs':
        return this.groupTabs(action.hostname ?? null, action.speech);
      case 'scroll_to_percent':
        return this.scrollToPercent(action.percent, action.speech);
      case 'annotate':
        return this.annotate(action.note, action.speech);
      case 'none':
        await this.deps.speech.speak(action.speech);
        return { success: true, detail: 'no-op' };

      // ── Feature Explosion actions ──────────────────────────────────────────

      case 'page_mood':
        return this.pageMood(action.mood, action.suggestion, action.speech);

      case 'highlight_interactive':
        return this.highlightInteractive(action.speech);

      case 'watch_price':
        return this.watchPrice(action.speech);

      case 'check_links':
        return this.checkLinks(action.speech);

      case 'page_diff':
        return this.pageDiff(action.speech);

      case 'flashcard_mode':
        void runFlashcardMode(this.deps.speech, this.deps.hud);
        return { success: true, detail: 'flashcard session started' };

      case 'debate_mode':
        void runDebateMode(action.topic, this.deps.speech, this.deps.hud);
        return { success: true, detail: `debate: ${action.topic}` };

      case 'essay_critic':
        void runEssayCritic(this.deps.speech, this.deps.hud);
        return { success: true, detail: 'essay critique started' };

      case 'interview_mode':
        void runInterviewPrep(action.role, this.deps.speech, this.deps.hud);
        return { success: true, detail: `interview prep: ${action.role}` };

      case 'focus_timer':
        return this.focusTimer(action.command, action.minutes, action.speech);

      case 'shopping_list':
        return this.shoppingList(action.command, action.speech);

      case 'daily_briefing':
        void runDailyBriefing(this.deps.speech, this.deps.hud);
        return { success: true, detail: 'briefing started' };

      case 'mini_mode':
        return this.miniMode(action.enabled, action.speech);

      case 'show_transcript':
        toggleFloatingTranscript();
        await this.deps.speech.speak(action.speech);
        void maybeShowTutorial('show_transcript', 'Session Transcript', 'This panel shows everything said this session. Export it to save your conversation.');
        return { success: true, detail: 'transcript toggled' };

      case 'spotlight_element':
        return this.spotlightElement(action.target, action.speech);

      case 'comparison_shop':
        return this.comparisonShop(action.speech);

      case 'language_tutor':
        void runLanguageTutor(action.targetLang, this.deps.speech, this.deps.hud);
        return { success: true, detail: `language tutor: ${action.targetLang}` };

      case 'gesture_trainer':
        void runGestureTrainer(this.deps.speech, this.deps.hud);
        return { success: true, detail: 'gesture trainer started' };

      case 'doc_qa':
        if (action.question) {
          void answerDocQuestion(action.question, this.deps.speech, this.deps.hud);
          return { success: true, detail: `doc q&a: ${action.question.slice(0, 50)}` };
        }
        void runDocQA(this.deps.speech, this.deps.hud);
        return { success: true, detail: 'doc q&a started' };
    }
  }

  /* ------------------------------- answer -------------------------------- */
  private async answer(speech: string): Promise<ActionOutcome> {
    await this.deps.speech.speak(speech);
    return { success: true, detail: null };
  }

  /* ------------------------------ highlight ------------------------------ */
  private async highlight(text: string, speech: string): Promise<ActionOutcome> {
    clearHighlights();
    const range = findTextRange(text);
    if (!range) {
      await this.deps.speech.speak(speech);
      return { success: false, detail: 'text not found on page' };
    }
    const mark = document.createElement('mark');
    mark.className = 'aria-highlight';
    try {
      range.surroundContents(mark);
    } catch {
      // Range spans multiple block elements; fall back to scroll only.
    }
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.deps.cursor.moveToElement(mark);
    await this.deps.speech.speak(speech);
    return { success: true, detail: null };
  }

  /* -------------------------------- click -------------------------------- */
  private async click(target: string, speech: string): Promise<ActionOutcome> {
    let el = findElement(target);

    if (!el) {
      // Error recovery: wait 400ms for SPA DOM to settle, then retry once.
      await delay(400);
      el = findElement(target);
    }

    if (!el) {
      await this.deps.speech.speak(
        `I couldn't find ${target} on this page. Click it and I'll remember.`,
      );
      this.armTeach(target);
      this.deps.cursor.setState('error');
      return { success: false, detail: 'element not found — teach armed' };
    }

    // Danger Zone Detection - warn before destructive actions.
    if (this.deps.dangerZoneDetection !== false) {
      const elText = ((el.textContent ?? '') + ' ' + (el.getAttribute('aria-label') ?? '')).toLowerCase();
      const DANGER = /\b(delete|cancel|remove|unsubscribe|log.?out|sign.?out|deactivate|disable|reset|clear|purge|drop)\b/;
      if (DANGER.test(elText)) {
        this.deps.cursor.setState('error'); // orange-adjacent warning signal
        const confirmed = await previewAction(`This looks like a destructive action: "${elText.slice(0, 60).trim()}". Proceed?`);
        if (!confirmed) {
          this.deps.cursor.setState('idle');
          return { success: false, detail: 'danger zone — cancelled' };
        }
      }
    }

    // Focus Spotlight - dim page and highlight target before clicking.
    await this.showSpotlightFor(el);

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.deps.cursor.moveToElement(el);
    this.deps.cursor.setState('acting');
    if (this.deps.selfNarration) void this.deps.speech.speak(`Clicking ${describe(el)}…`);
    clickElement(el);
    this.dismissSpotlight();
    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: describe(el) };
  }

  /* -------------------------------- scroll ------------------------------- */
  private async scroll(
    direction: 'up' | 'down' | 'top' | 'bottom',
    amount: 'small' | 'medium' | 'large',
    speech: string,
  ): Promise<ActionOutcome> {
    const page = window.innerHeight;
    const dist = { small: page * 0.4, medium: page * 0.85, large: page * 1.6 }[amount];
    switch (direction) {
      case 'up':
        window.scrollBy({ top: -dist, behavior: 'smooth' });
        break;
      case 'down':
        window.scrollBy({ top: dist, behavior: 'smooth' });
        break;
      case 'top':
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'bottom':
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        break;
    }
    await this.deps.speech.speak(speech);
    return { success: true, detail: `${direction} ${amount}` };
  }

  /* ------------------------------ navigate ------------------------------- */
  private async navigateTo(url: string, speech: string): Promise<ActionOutcome> {
    const normalized = normalizeUrl(url);
    if (speech) await this.deps.speech.speak(speech);
    const confirmed = await previewAction(`Navigate to ${normalized}`);
    if (!confirmed) return { success: false, detail: 'cancelled by user' };
    this.deps.navigate(normalized);
    return { success: true, detail: normalized };
  }

  /* ----------------------------- read_aloud ------------------------------ */
  private async readAloud(speech: string): Promise<ActionOutcome> {
    const text = extractMainText();
    if (!text) {
      await this.deps.speech.speak("I couldn't find readable content on this page.");
      return { success: false, detail: 'no content' };
    }

    // Reading Time Estimator.
    const wordCount = text.split(/\s+/).length;
    const readMins = Math.max(1, Math.round(wordCount / 238));
    if (speech) await this.deps.speech.speak(`${speech} This is about a ${readMins}-minute read.`);
    else await this.deps.speech.speak(`Starting to read. This is about a ${readMins}-minute read.`);

    const sentences = text.match(/[^.!?]+[.!?]+|\S+$/g) ?? [text];
    const total = sentences.length;
    const milestones = new Set([Math.round(total * 0.25), Math.round(total * 0.5), Math.round(total * 0.75)]);

    for (let i = 0; i < Math.min(sentences.length, 120); i++) {
      const trimmed = sentences[i].trim();
      if (!trimmed) continue;

      // Scroll Progress Narrator.
      if (milestones.has(i + 1)) {
        const pct = Math.round(((i + 1) / total) * 100);
        await this.deps.speech.speak(`${pct}% through the article.`);
      }

      await this.deps.speech.speak(trimmed, {
        onWordBoundary: (word) => this.deps.hud.setTranscript(word),
      });
    }
    return { success: true, detail: `${sentences.length} sentences` };
  }

  /* ------------------------------ summarize ------------------------------ */
  private async summarize(speech: string): Promise<ActionOutcome> {
    const text = extractMainText();
    if (!text) {
      await this.deps.speech.speak("I couldn't find readable content to summarize.");
      return { success: false, detail: 'no content' };
    }
    // Show a floating summary card + speak it.
    this.showSummaryCard(speech);
    await this.deps.speech.speak(speech);
    return { success: true, detail: null };
  }

  /* ------------------------------- explain ------------------------------- */
  private async explain(selection: string, explanation: string, speech: string): Promise<ActionOutcome> {
    // Highlight the selection first, then show explanation tooltip.
    clearHighlights();
    const range = findTextRange(selection);
    if (range) {
      const mark = document.createElement('mark');
      mark.className = 'aria-highlight';
      try { range.surroundContents(mark); } catch { /* cross-block */ }
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.deps.cursor.moveToElement(mark);
      this.showExplainTooltip(mark, explanation);
    }
    await this.deps.speech.speak(speech);
    return { success: true, detail: null };
  }

  /* ------------------------------ multi_step ----------------------------- */
  private async multiStep(steps: PlanStep[], speech: string): Promise<ActionOutcome> {
    await this.deps.speech.speak(speech);
    showStepProgress(0, steps.length);
    let failed = 0;
    for (let i = 0; i < steps.length; i++) {
      if (this.aborted) {
        dismissStepProgress();
        void this.deps.speech.speak('The page changed — I stopped.');
        return { success: false, detail: 'aborted: page unload' };
      }
      const step = steps[i];
      this.deps.hud.setCommand(`Step ${i + 1}/${steps.length}: ${step.action}`);
      showStepProgress(i + 1, steps.length);
      const outcome = await this.executeStep(step);
      if (!outcome.success) failed++;
      await delay(350);
    }
    dismissStepProgress();
    return { success: failed === 0, detail: `${steps.length - failed}/${steps.length} steps ok` };
  }

  private async executeStep(step: PlanStep): Promise<ActionOutcome> {
    switch (step.action) {
      case 'click':
        if (!step.target) return { success: false, detail: 'no target' };
        return this.click(step.target, step.speech || '');
      case 'scroll':
        return this.scroll(
          (step.direction as 'up' | 'down' | 'top' | 'bottom') ?? 'down',
          (step.amount as 'small' | 'medium' | 'large') ?? 'medium',
          step.speech || '',
        );
      case 'navigate':
        if (!step.url) return { success: false, detail: 'no url' };
        return this.navigateTo(step.url, step.speech || '');
      case 'highlight':
        if (!step.text) return { success: false, detail: 'no text' };
        return this.highlight(step.text, step.speech || '');
      default:
        return { success: true, detail: 'skip' };
    }
  }

  /* -------------------------------- open_tab ----------------------------- */
  private async openTab(url: string, speech: string): Promise<ActionOutcome> {
    const normalized = normalizeUrl(url);
    if (speech) await this.deps.speech.speak(speech);
    // Content scripts can't use chrome.tabs; send a message to background.
    sendRuntime({ type: 'OPEN_TAB', target: 'background', url: normalized });
    return { success: true, detail: normalized };
  }

  /* -------------------------- paste clipboard ----------------------------- */
  private async pasteClipboard(targetDesc: string | null, speech: string): Promise<ActionOutcome> {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      await this.deps.speech.speak("I can't access the clipboard — please allow clipboard permission.");
      return { success: false, detail: 'clipboard read denied' };
    }
    if (!text) {
      await this.deps.speech.speak('The clipboard is empty.');
      return { success: false, detail: 'clipboard empty' };
    }

    // Find the target field to paste into.
    let el: HTMLElement | null = null;
    if (targetDesc) {
      const found = findElement(targetDesc);
      el = found instanceof HTMLElement ? found : null;
    }
    // Fall back to the currently focused element if it's editable.
    if (!el) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) {
        el = active as HTMLElement;
      }
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el instanceof HTMLElement && el.isContentEditable) {
      document.execCommand('insertText', false, text);
    } else {
      // No editable target - speak the clipboard content.
      await this.deps.speech.speak(text.slice(0, 200));
      return { success: true, detail: 'read clipboard aloud' };
    }

    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: `pasted ${text.length} chars` };
  }

  /* ------------------------------ type into ------------------------------ */
  private async typeInto(targetDesc: string, text: string, clear: boolean, speech: string): Promise<ActionOutcome> {
    const found = findElement(targetDesc);
    const el = found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement ? found : null;
    if (!el) {
      await this.deps.speech.speak(`I couldn't find the ${targetDesc}.`);
      return { success: false, detail: 'element not found' };
    }

    await this.deps.cursor.moveToElement(el);
    el.focus();
    if (clear) el.value = '';

    // Simulate typing char by char for reactive frameworks.
    for (const ch of text) {
      el.value += ch;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      await delay(18);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));

    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: `typed into ${targetDesc}` };
  }

  /* ----------------------------- select text ------------------------------ */
  private async selectText(text: string, speech: string): Promise<ActionOutcome> {
    const range = findTextRange(text);
    if (!range) {
      await this.deps.speech.speak(`I couldn't find "${text.slice(0, 40)}" on the page.`);
      return { success: false, detail: 'text not found' };
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Copy to clipboard if available.
    try { await navigator.clipboard.writeText(text); } catch { /* permission denied — ignore */ }
    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: `selected "${text.slice(0, 40)}"` };
  }

  /* ----------------------------- submit form ------------------------------ */
  private async submitForm(targetDesc: string | null, speech: string): Promise<ActionOutcome> {
    let form: HTMLFormElement | null = null;

    if (targetDesc) {
      const found = findElement(targetDesc);
      if (found instanceof HTMLButtonElement || found instanceof HTMLInputElement) {
        form = found.form;
        if (!form) {
          found.click();
          if (speech) await this.deps.speech.speak(speech);
          return { success: true, detail: 'clicked submit' };
        }
      }
    }

    // Fall back: find the first form on the page.
    if (!form) form = document.querySelector<HTMLFormElement>('form');
    if (!form) {
      await this.deps.speech.speak("I couldn't find a form to submit.");
      return { success: false, detail: 'no form found' };
    }

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"],input[type="submit"]');
    if (submitBtn) {
      await this.deps.cursor.moveToElement(submitBtn);
      submitBtn.click();
    } else {
      form.submit();
    }

    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: 'form submitted' };
  }

  /* ----------------------------- press key -------------------------------- */
  private async pressKey(key: string, modifiers: string[], speech: string): Promise<ActionOutcome> {
    const target = document.activeElement ?? document.body;
    const opts: KeyboardEventInit = {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: modifiers.includes('ctrl'),
      altKey: modifiers.includes('alt'),
      shiftKey: modifiers.includes('shift'),
      metaKey: modifiers.includes('meta'),
    };
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keypress', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: `pressed ${key}` };
  }

  /* ---------------------------- media control ----------------------------- */
  private async mediaControl(command: string, speech: string): Promise<ActionOutcome> {
    const video = document.querySelector<HTMLVideoElement>('video');
    const audio = document.querySelector<HTMLAudioElement>('audio');
    const media = video ?? audio;

    if (!media) {
      await this.deps.speech.speak("I can't find any media on this page.");
      return { success: false, detail: 'no media element' };
    }

    switch (command) {
      case 'play':        media.play(); break;
      case 'pause':       media.pause(); break;
      case 'toggle_play': media.paused ? media.play() : media.pause(); break;
      case 'mute':        media.muted = true; break;
      case 'unmute':      media.muted = false; break;
      case 'volume_up':   media.volume = Math.min(1, media.volume + 0.1); break;
      case 'volume_down': media.volume = Math.max(0, media.volume - 0.1); break;
      case 'fullscreen':
        if (video) await video.requestFullscreen().catch(() => {}); break;
    }

    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: command };
  }

  /* ----------------------------- zoom page -------------------------------- */
  private async zoomPage(direction: 'in' | 'out' | 'reset', speech: string): Promise<ActionOutcome> {
    const body = document.documentElement;
    const current = parseFloat(body.style.zoom || '1') || 1;
    let next: number;
    if (direction === 'reset') {
      next = 1;
    } else if (direction === 'in') {
      next = Math.min(3, parseFloat((current + 0.25).toFixed(2)));
    } else {
      next = Math.max(0.25, parseFloat((current - 0.25).toFixed(2)));
    }
    body.style.zoom = String(next);
    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: `zoom ${Math.round(next * 100)}%` };
  }

  /* -------------------------- speak selection ----------------------------- */
  private async speakSelection(_speech: string): Promise<ActionOutcome> {
    const selected = window.getSelection()?.toString().trim() ?? '';
    if (!selected) {
      await this.deps.speech.speak("Nothing is selected. Try selecting some text first.");
      return { success: false, detail: 'nothing selected' };
    }
    await this.deps.speech.speak(selected);
    return { success: true, detail: `read ${selected.length} chars` };
  }

  /* ------------------------------- tab action ----------------------------- */
  private async tabAction(command: 'close' | 'new' | 'duplicate' | 'reload', speech: string): Promise<ActionOutcome> {
    if (speech) await this.deps.speech.speak(speech);
    sendRuntime({ type: 'TAB_ACTION', target: 'background', command });
    return { success: true, detail: command };
  }

  /* ----------------------------- browser nav ------------------------------ */
  private async browserNav(command: string, speech: string): Promise<ActionOutcome> {
    if (speech) await this.deps.speech.speak(speech);
    switch (command) {
      case 'back':    history.back(); break;
      case 'forward': history.forward(); break;
      case 'reload':  location.reload(); break;
      case 'home':    location.assign('/'); break;
    }
    return { success: true, detail: command };
  }

  /* ----------------------------- bookmark page ---------------------------- */
  private async bookmarkPage(speech: string): Promise<ActionOutcome> {
    // Chrome bookmarks API requires a background extension page - route through background.
    sendRuntime({ type: 'BOOKMARK_PAGE', target: 'background' });
    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: 'bookmark saved' };
  }

  /* ------------------------------ find on page ----------------------------- */
  private async findOnPage(query: string, speech: string): Promise<ActionOutcome> {
    clearHighlights();
    injectHighlightStyle();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let count = 0;
    let firstMark: HTMLElement | null = null;

    const toProcess: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (re.test(node.textContent ?? '')) toProcess.push(node);
    }

    for (const textNode of toProcess) {
      const text = textNode.textContent ?? '';
      let match: RegExpExecArray | null;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      while ((match = re.exec(text)) !== null) {
        if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        const mark = document.createElement('mark');
        mark.className = 'aria-highlight';
        mark.textContent = match[0];
        frag.appendChild(mark);
        if (!firstMark) firstMark = mark;
        count++;
        last = match.index + match[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    if (firstMark) firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const msg = count > 0 ? (speech || `Found ${count} match${count === 1 ? '' : 'es'} for "${query}".`) : `No matches found for "${query}".`;
    await this.deps.speech.speak(msg);
    return { success: count > 0, detail: `${count} matches` };
  }

  /* ------------------------------ dictation ------------------------------- */
  private async startDictation(targetDesc: string | null, speech: string): Promise<ActionOutcome> {
    // Find the target input.
    let el: HTMLInputElement | HTMLTextAreaElement | null = null;
    if (targetDesc) {
      const found = findElement(targetDesc);
      if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement) el = found;
    }
    if (!el) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) el = active;
    }
    if (!el) {
      await this.deps.speech.speak("Please click on an input field first, then say dictate.");
      return { success: false, detail: 'no input focused' };
    }
    const target = el;
    if (speech) await this.deps.speech.speak(speech);

    // Use SpeechRecognition for continuous dictation.
    type Ctor = new () => SpeechRecognitionLike;
    type SpeechRecognitionLike = {
      lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
      start(): void; stop(): void;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null;
      onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
    };
    const Ctor = (window as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: Ctor }).SpeechRecognition;
    if (!Ctor) return { success: false, detail: 'SpeechRecognition unavailable' };

    const rec = new Ctor();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    target.focus();
    let interim = '';
    const baseLen = target.value.length;

    rec.onresult = (e) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim = r[0].transcript;
      }
      target.value = target.value.slice(0, baseLen) + finalText + interim;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rec.onend = () => {
      target.value = target.value.slice(0, baseLen + (target.value.length - baseLen - interim.length));
    };
    rec.onerror = () => rec.stop();

    rec.start();
    // Auto-stop after 15s.
    setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, 15000);
    return { success: true, detail: 'dictating…' };
  }

  /* ------------------------------- translate ------------------------------ */
  private async translate(translation: string, speech: string): Promise<ActionOutcome> {
    showTranslationToast(translation);
    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: null };
  }

  /* -------------------------- navigate heading ---------------------------- */
  private async navigateHeading(direction: string, level: number | null, speech: string): Promise<ActionOutcome> {
    const selector = level ? `h${level}` : 'h1,h2,h3,h4,h5,h6';
    const headings = Array.from(document.querySelectorAll<HTMLElement>(selector));
    if (headings.length === 0) {
      await this.deps.speech.speak("No headings found on this page.");
      return { success: false, detail: 'no headings' };
    }
    let target: HTMLElement;
    if (direction === 'first') {
      target = headings[0];
    } else {
      const scrollY = window.scrollY;
      const viewH = window.innerHeight;
      const currentIdx = headings.findIndex((h) => h.getBoundingClientRect().top + scrollY > scrollY + viewH * 0.1);
      if (direction === 'next') {
        target = headings[Math.max(0, Math.min(headings.length - 1, currentIdx >= 0 ? currentIdx : 0))];
      } else {
        target = headings[Math.max(0, (currentIdx >= 0 ? currentIdx : headings.length) - 1)];
      }
    }
    await this.deps.cursor.moveToElement(target);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus();
    if (speech) await this.deps.speech.speak(speech);
    return { success: true, detail: target.textContent?.slice(0, 60) ?? '' };
  }

  /* ------------------------------ UI helpers ----------------------------- */
  private showSummaryCard(text: string): void {
    const existing = document.getElementById('aria-summary-card');
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.id = 'aria-summary-card';
    card.style.cssText = [
      'position:fixed', 'bottom:90px', 'right:20px', 'max-width:360px', 'z-index:2147483646',
      'background:rgba(14,14,20,0.96)', 'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:12px', 'padding:16px', 'color:#f3f3f7',
      'font-family:ui-sans-serif,system-ui,sans-serif', 'font-size:13px', 'line-height:1.5',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5)', 'backdrop-filter:blur(8px)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#9aa0aa;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center';
    const headerLabel = document.createElement('span');
    headerLabel.textContent = 'Summary';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:14px';
    closeBtn.addEventListener('click', () => card.remove());
    header.append(headerLabel, closeBtn);

    const body = document.createElement('p');
    body.style.cssText = 'margin:0';
    body.textContent = text;

    card.append(header, body);
    document.documentElement.appendChild(card);

    // Auto-dismiss after 15s.
    setTimeout(() => card.remove(), 15000);
  }

  private showExplainTooltip(anchor: Element, explanation: string): void {
    const existing = document.getElementById('aria-explain-tooltip');
    if (existing) existing.remove();

    const tip = document.createElement('div');
    tip.id = 'aria-explain-tooltip';
    const r = anchor.getBoundingClientRect();
    tip.style.cssText = [
      'position:fixed', `top:${Math.max(10, r.bottom + 8 + window.scrollY - window.scrollY)}px`,
      `left:${Math.max(10, r.left)}px`, 'max-width:320px', 'z-index:2147483646',
      'background:rgba(14,14,20,0.97)', 'border:1px solid rgba(255,213,79,0.4)',
      'border-radius:10px', 'padding:12px 14px', 'color:#f3f3f7',
      'font-family:ui-sans-serif,system-ui,sans-serif', 'font-size:13px', 'line-height:1.5',
      'box-shadow:0 6px 24px rgba(0,0,0,0.45)', 'backdrop-filter:blur(6px)',
    ].join(';');
    tip.textContent = explanation;

    const close = document.createElement('button');
    close.style.cssText = 'float:right;background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:13px;margin:-2px -4px 4px 8px';
    close.textContent = '✕';
    close.addEventListener('click', () => tip.remove());
    tip.prepend(close);

    document.documentElement.appendChild(tip);
    setTimeout(() => tip.remove(), 20000);
  }

  /* ----------------------------- auto scroll ----------------------------- */
  private async autoScroll(command: string, speech: string): Promise<ActionOutcome> {
    const { toggleAutoScroll, adjustAutoScrollSpeed, isAutoScrolling } = await import('./auto-scroll');
    if (command === 'start') {
      if (!isAutoScrolling()) toggleAutoScroll((m) => void this.deps.speech.speak(m));
    } else if (command === 'stop' || command === 'pause') {
      if (isAutoScrolling()) toggleAutoScroll();
    } else if (command === 'faster') {
      adjustAutoScrollSpeed(30);
    } else if (command === 'slower') {
      adjustAutoScrollSpeed(-30);
    }
    await this.deps.speech.speak(speech);
    return { success: true, detail: command };
  }

  /* -------------------------- copy to clipboard -------------------------- */
  private async copyToClipboard(text: string | null, speech: string): Promise<ActionOutcome> {
    const content = text ?? window.getSelection()?.toString().trim() ?? '';
    if (!content) {
      await this.deps.speech.speak('Nothing to copy.');
      return { success: false, detail: 'empty selection' };
    }
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return { success: false, detail: 'clipboard write denied' };
    }
    await this.deps.speech.speak(speech);
    return { success: true, detail: content.slice(0, 60) };
  }

  /* -------------------------------- annotate ----------------------------- */
  private async annotate(note: string, speech: string): Promise<ActionOutcome> {
    const { saveAnnotation } = await import('./annotations');
    const pos = this.deps.cursor.position();
    await saveAnnotation(pos.x, pos.y, note);
    await this.deps.speech.speak(speech);
    return { success: true, detail: note.slice(0, 40) };
  }

  /* --------------------------- scroll to percent -------------------------- */
  private async scrollToPercent(percent: number, speech: string): Promise<ActionOutcome> {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const target = Math.round((percent / 100) * maxScroll);
    window.scrollTo({ top: target, behavior: 'smooth' });
    await this.deps.speech.speak(speech);
    return { success: true, detail: `${percent}%` };
  }

  /* ------------------------------ group tabs ----------------------------- */
  private async groupTabs(hostname: string | null, speech: string): Promise<ActionOutcome> {
    sendRuntime({ type: 'GROUP_TABS', target: 'background', hostname: hostname ?? undefined });
    await this.deps.speech.speak(speech);
    return { success: true, detail: hostname ?? 'current domain' };
  }

  /* ------------------------------ open outline --------------------------- */
  private async openOutline(speech: string): Promise<ActionOutcome> {
    const { togglePageOutline } = await import('./page-outline');
    togglePageOutline();
    await this.deps.speech.speak(speech);
    return { success: true, detail: null };
  }

  /* ─────────────────── Feature Explosion handlers ─────────────────────── */

  /* Page Mood Detection */
  private async pageMood(mood: string, suggestion: string, speech: string): Promise<ActionOutcome> {
    showMoodCard(mood, suggestion);
    await this.deps.speech.speak(speech);
    return { success: true, detail: mood.slice(0, 60) };
  }

  /* Element Highlighter Mode */
  private async highlightInteractive(_speech: string): Promise<ActionOutcome> {
    const count = showInteractiveElements();
    const msg = `Highlighted ${count} interactive element${count === 1 ? '' : 's'}. Say "click" followed by a number to activate one, or "hide labels" to dismiss.`;
    await this.deps.speech.speak(msg);
    void maybeShowTutorial('element-highlighter', 'Element Highlighter', 'Numbered labels show every clickable element. Say "click 3" to activate element 3.');
    return { success: true, detail: `${count} elements highlighted` };
  }

  /* Price Watcher */
  private async watchPrice(_speech: string): Promise<ActionOutcome> {
    const result = await watchCurrentPrice();
    await this.deps.speech.speak(result);
    void maybeShowTutorial('price-watcher', 'Price Watcher', "I'll remember this price and tell you if it changes next time you visit.");
    return { success: true, detail: result.slice(0, 60) };
  }

  /* Broken Link Detector */
  private async checkLinks(_speech: string): Promise<ActionOutcome> {
    await this.deps.speech.speak("Checking links on this page — this may take a moment.");
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .filter((a) => a.href && /^https?:\/\//.test(a.href))
      .slice(0, 30);

    if (links.length === 0) {
      await this.deps.speech.speak("No external links found on this page.");
      return { success: true, detail: 'no links' };
    }

    const broken: string[] = [];
    await Promise.allSettled(
      links.map(async (a) => {
        try {
          const res = await fetch(a.href, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
          if (!res.ok && res.status !== 405) {
            broken.push(a.textContent?.trim().slice(0, 40) || a.href.slice(0, 40));
            a.style.outline = '2px solid #ff4444';
          }
        } catch {
          broken.push(a.textContent?.trim().slice(0, 40) || a.href.slice(0, 40));
          a.style.outline = '2px solid #ff4444';
        }
      }),
    );

    const msg = broken.length === 0
      ? `All ${links.length} links look good.`
      : `Found ${broken.length} broken link${broken.length === 1 ? '' : 's'}: ${broken.join(', ')}.`;
    await this.deps.speech.speak(msg);
    return { success: true, detail: msg.slice(0, 80) };
  }

  /* Page Diff Mode */
  private async pageDiff(_speech: string): Promise<ActionOutcome> {
    const result = await diffPageSnapshot();
    if (!result) {
      await this.deps.speech.speak("Saved a snapshot of this page. Come back later and say 'what changed' to see the diff.");
      return { success: true, detail: 'snapshot saved (first visit)' };
    }
    await this.deps.speech.speak(result);
    return { success: true, detail: result.slice(0, 80) };
  }

  /* Focus Timer */
  private async focusTimer(command: string, minutes: number, speech: string): Promise<ActionOutcome> {
    if (command === 'stop') {
      stopFocusTimer();
      await this.deps.speech.speak("Focus mode ended. Good work!");
      return { success: true, detail: 'timer stopped' };
    }
    const blocklist = this.deps.focusBlocklist ?? [];
    startFocusTimer(minutes, blocklist, (msg) => void this.deps.speech.speak(msg));
    await this.deps.speech.speak(speech);
    showToast({ text: `Focus mode: ${minutes} min`, duration: 3000 });
    return { success: true, detail: `focus timer ${minutes}m` };
  }

  /* Shopping List */
  private async shoppingList(command: string, speech: string): Promise<ActionOutcome> {
    const pos = this.deps.cursor.position();
    let result: string;
    switch (command) {
      case 'add':    result = await addCurrentProductToList(pos.x, pos.y); break;
      case 'read':   result = await readShoppingList(); break;
      case 'clear':  result = await clearShoppingList(); break;
      case 'export': result = await exportShoppingList(); break;
      default: result = speech;
    }
    await this.deps.speech.speak(result);
    if (command === 'add') showToast(result.slice(0, 80));
    return { success: true, detail: command };
  }

  /* Mini Mode */
  private async miniMode(enabled: boolean, speech: string): Promise<ActionOutcome> {
    const host = document.getElementById('aria-overlay-host');
    if (host) host.setAttribute('data-mini', enabled ? 'true' : 'false');
    await this.deps.speech.speak(speech);
    return { success: true, detail: enabled ? 'mini mode on' : 'mini mode off' };
  }

  /* Focus Spotlight helpers */
  private spotlightOverlay: HTMLElement | null = null;

  private async showSpotlightFor(el: Element): Promise<void> {
    this.dismissSpotlight();
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const overlay = document.createElement('div');
    overlay.id = 'aria-spotlight-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0',
      'background:rgba(0,0,0,0.55)',
      'z-index:2147483644',
      'pointer-events:none',
      'animation:aria-spotlight-in 0.15s ease',
    ].join(';');

    const hole = document.createElement('div');
    hole.style.cssText = [
      'position:absolute',
      `top:${rect.top - 6}px`,
      `left:${rect.left - 6}px`,
      `width:${rect.width + 12}px`,
      `height:${rect.height + 12}px`,
      'border-radius:6px',
      'box-shadow:0 0 0 9999px rgba(0,0,0,0.55)',
      'border:2px solid rgba(255,255,255,0.7)',
    ].join(';');

    overlay.appendChild(hole);
    document.documentElement.appendChild(overlay);
    this.spotlightOverlay = overlay;

    injectSpotlightStyle();
    await delay(200); // let spotlight render briefly
  }

  private dismissSpotlight(): void {
    this.spotlightOverlay?.remove();
    this.spotlightOverlay = null;
  }

  /* Comparison Shopper */
  private async comparisonShop(speech: string): Promise<ActionOutcome> {
    const { extractPagePrice } = await import('./price-watcher');
    const priceInfo = extractPagePrice();
    const productName = (document.querySelector('[itemprop="name"], h1')?.textContent ?? document.title).trim().slice(0, 80);

    if (!productName) {
      await this.deps.speech.speak("I couldn't identify a product on this page.");
      return { success: false, detail: 'no product found' };
    }

    const priceText = priceInfo ? ` priced at ${priceInfo.raw}` : '';
    await this.deps.speech.speak(`Comparing "${productName}"${priceText}. Opening competitor search…`);

    const query = encodeURIComponent(productName);
    sendRuntime({ type: 'OPEN_TAB', target: 'background', url: `https://www.google.com/search?q=${query}+price+compare` });
    sendRuntime({ type: 'OPEN_TAB', target: 'background', url: `https://www.amazon.com/s?k=${query}` });

    await this.deps.speech.speak(speech);
    return { success: true, detail: `comparing ${productName}` };
  }

  /* Spotlight element by description */
  private async spotlightElement(target: string, speech: string): Promise<ActionOutcome> {
    const el = findElement(target);
    if (!el) {
      await this.deps.speech.speak(`I couldn't find "${target}" to highlight.`);
      return { success: false, detail: 'element not found' };
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.showSpotlightFor(el);
    await this.deps.cursor.moveToElement(el);
    if (speech) await this.deps.speech.speak(speech);
    setTimeout(() => this.dismissSpotlight(), 3000);
    return { success: true, detail: describe(el) };
  }

  /* --------------------------- click-to-teach ---------------------------- */
  private armTeach(target: string): void {
    this.teachPending?.cleanup();
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el || !isVisible(el)) return;
      teachTarget(target, el);
      this.deps.hud.setCommand(`Learned "${target}".`);
      this.deps.speech.speak(`Got it. I'll remember ${target}.`);
      cleanup();
    };
    const cleanup = () => {
      document.removeEventListener('click', onClick, true);
      this.teachPending = null;
    };
    // Capture phase so we learn the target even if the page stops propagation.
    document.addEventListener('click', onClick, true);
    this.teachPending = { target, cleanup };
  }
}

/* ------------------------------- utilities -------------------------------- */

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const label = (el.textContent ?? '').trim().slice(0, 40) || el.getAttribute('aria-label') || '';
  return label ? `${tag} "${label}"` : tag;
}

function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[\w-]+(\.[\w-]+)+/.test(url)) return `https://${url}`;
  // Treat as a Google search query.
  return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
}

/** Find a Range wrapping the first occurrence of `text` (case-insensitive). */
function findTextRange(text: string): Range | null {
  const needle = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!needle) return null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const hay = (node.nodeValue ?? '').toLowerCase();
    const idx = hay.indexOf(needle);
    if (idx !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + needle.length);
      return range;
    }
  }
  return null;
}

function clearHighlights(): void {
  document.querySelectorAll('mark.aria-highlight').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function showStepProgress(current: number, total: number): void {
  let bar = document.getElementById('aria-step-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'aria-step-progress';
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
      'height:3px', 'background:rgba(155,107,255,0.15)',
      'pointer-events:none',
    ].join(';');
    const fill = document.createElement('div');
    fill.id = 'aria-step-fill';
    fill.style.cssText = 'height:100%;background:#9b6bff;transition:width 0.3s ease;width:0';
    bar.appendChild(fill);
    document.documentElement.appendChild(bar);
  }
  const fill = document.getElementById('aria-step-fill');
  if (fill) fill.style.width = total > 0 ? `${(current / total) * 100}%` : '0';
}

function dismissStepProgress(): void {
  document.getElementById('aria-step-progress')?.remove();
}

function showTranslationToast(text: string): void {
  const existing = document.getElementById('aria-translation-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'aria-translation-toast';
  toast.style.cssText = [
    'position:fixed', 'bottom:90px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:2147483646', 'max-width:480px', 'width:90vw',
    'background:rgba(14,14,22,0.97)', 'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:12px', 'padding:14px 18px',
    'color:#f3f3f7', 'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:14px', 'line-height:1.5',
    'box-shadow:0 12px 40px rgba(0,0,0,0.6)',
  ].join(';');
  const label = document.createElement('div');
  label.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.7px;color:#9aa0aa;margin-bottom:6px';
  label.textContent = 'Translation';
  const body = document.createElement('div');
  body.textContent = text;
  toast.append(label, body);
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 12000);
}

/** Page mood card shown below HUD. */
function showMoodCard(mood: string, suggestion: string): void {
  const existing = document.getElementById('aria-mood-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.id = 'aria-mood-card';
  card.style.cssText = [
    'position:fixed', 'bottom:90px', 'right:20px',
    'max-width:340px', 'z-index:2147483645',
    'background:rgba(14,14,22,0.97)',
    'border:1px solid rgba(155,107,255,0.35)',
    'border-radius:12px', 'padding:14px 16px',
    'color:#f3f3f7',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:13px', 'line-height:1.5',
    'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
    'backdrop-filter:blur(8px)',
  ].join(';');

  const label = document.createElement('div');
  label.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.7px;color:#9b6bff;margin-bottom:6px';
  label.textContent = 'Page Vibe';

  const moodEl = document.createElement('div');
  moodEl.style.cssText = 'font-weight:600;margin-bottom:6px';
  moodEl.textContent = mood;

  const sugEl = document.createElement('div');
  sugEl.style.cssText = 'color:#9aa0aa;font-size:12px';
  sugEl.textContent = suggestion;

  const close = document.createElement('button');
  close.style.cssText = 'float:right;background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:13px';
  close.textContent = '✕';
  close.addEventListener('click', () => card.remove());

  card.append(close, label, moodEl, sugEl);
  document.documentElement.appendChild(card);
  setTimeout(() => card.remove(), 12000);
}

/** Inject spotlight animation style into page. */
function injectSpotlightStyle(): void {
  if (document.getElementById('aria-spotlight-style')) return;
  const style = document.createElement('style');
  style.id = 'aria-spotlight-style';
  style.textContent = `
    @keyframes aria-spotlight-in {
      from { opacity:0; }
      to   { opacity:1; }
    }`;
  document.head.appendChild(style);
}

/** Highlight styling lives in the page (not the shadow root) since <mark> wraps page nodes. */
function injectHighlightStyle(): void {
  if (document.getElementById('aria-highlight-style')) return;
  const style = document.createElement('style');
  style.id = 'aria-highlight-style';
  style.textContent = `
    mark.aria-highlight {
      background: linear-gradient(180deg, rgba(255,213,79,0.9), rgba(255,193,7,0.9));
      color: #1a1a1a; border-radius: 2px; padding: 0 1px;
      box-shadow: 0 0 0 2px rgba(255,193,7,0.5);
    }`;
  document.documentElement.appendChild(style);
}
