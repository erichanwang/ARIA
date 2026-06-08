/**
 * Trivia mode. A self-contained game independent of the page: Claude generates
 * questions, shown in a floating panel; the user answers (click in the spike;
 * voice answers route through the main voice loop as a follow-up). Score is
 * tracked and the final tally is spoken.
 */
import { getOverlayRoot } from '../overlay';
import type { Speech } from '../speech';
import { requestRuntime } from '@shared/messages';
import type { TriviaResult } from '@shared/tasks';

const ROUNDS = 5;

export class TriviaGame {
  private panel: HTMLDivElement;
  private score = 0;
  private round = 0;
  private asked: string[] = [];
  private topic = 'general knowledge';

  constructor(private speech: Speech) {
    this.panel = this.mountPanel();
  }

  async start(): Promise<void> {
    const topic = window.prompt('Trivia topic?', 'general knowledge');
    if (topic === null) {
      this.destroy();
      return;
    }
    this.topic = topic.trim() || 'general knowledge';
    await this.nextQuestion();
  }

  private async nextQuestion(): Promise<void> {
    if (this.round >= ROUNDS) return this.finish();
    this.round += 1;
    this.renderLoading();

    const res = await requestRuntime({
      type: 'RUN_TASK',
      target: 'background',
      request: { kind: 'trivia', topic: this.topic, difficulty: 'medium', asked: this.asked },
    });

    if (!res?.ok || !res.result) {
      this.renderError();
      return;
    }
    const q = res.result as TriviaResult;
    this.asked.push(q.question);
    this.renderQuestion(q);
  }

  private renderQuestion(q: TriviaResult): void {
    this.panel.innerHTML = `
      <div class="aria-trivia-head">Question ${this.round} / ${ROUNDS} · Score ${this.score}</div>
      <div class="aria-trivia-q">${escapeHtml(q.question)}</div>
      <div class="aria-trivia-opts"></div>`;
    const opts = this.panel.querySelector('.aria-trivia-opts')!;
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'aria-trivia-opt';
      btn.textContent = `${String.fromCharCode(65 + i)}. ${opt}`;
      btn.addEventListener('click', () => this.answer(i, q));
      opts.appendChild(btn);
    });
    void this.speech.speak(q.question);
  }

  private async answer(index: number, q: TriviaResult): Promise<void> {
    const correct = index === q.answerIndex;
    if (correct) this.score += 1;
    const buttons = this.panel.querySelectorAll<HTMLButtonElement>('.aria-trivia-opt');
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === q.answerIndex) b.classList.add('correct');
      else if (i === index) b.classList.add('wrong');
    });
    await this.speech.speak(correct ? `Correct! ${q.explanation}` : `Not quite. ${q.explanation}`);
    setTimeout(() => void this.nextQuestion(), 1200);
  }

  private async finish(): Promise<void> {
    this.panel.innerHTML = `
      <div class="aria-trivia-head">Game over</div>
      <div class="aria-trivia-q">You scored ${this.score} out of ${ROUNDS}.</div>
      <button class="aria-trivia-opt" id="aria-trivia-close">Close</button>`;
    this.panel.querySelector('#aria-trivia-close')!.addEventListener('click', () => this.destroy());
    await this.speech.speak(`That's the game. You scored ${this.score} out of ${ROUNDS}.`);
  }

  private renderLoading(): void {
    this.panel.innerHTML = `<div class="aria-trivia-head">ARIA Trivia</div><div class="aria-trivia-q">Thinking of a question…</div>`;
  }

  private renderError(): void {
    this.panel.innerHTML = `<div class="aria-trivia-head">ARIA Trivia</div><div class="aria-trivia-q">I couldn't load a question. Check your API key.</div>`;
  }

  private mountPanel(): HTMLDivElement {
    const root = getOverlayRoot();
    if (!root.getElementById('aria-trivia-style')) {
      const style = document.createElement('style');
      style.id = 'aria-trivia-style';
      style.textContent = TRIVIA_CSS;
      root.appendChild(style);
    }
    const panel = document.createElement('div');
    panel.id = 'aria-trivia';
    root.appendChild(panel);
    return panel;
  }

  private destroy(): void {
    this.panel.remove();
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

const TRIVIA_CSS = /* css */ `
  #aria-trivia {
    position: fixed; top: 24px; right: 24px; width: 340px;
    background: rgba(18,18,22,0.96); color: #f3f3f7;
    font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px;
    border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 16px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5); pointer-events: auto; z-index: 1;
  }
  #aria-trivia .aria-trivia-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #9aa0aa; margin-bottom: 8px; }
  #aria-trivia .aria-trivia-q { font-weight: 600; line-height: 1.4; margin-bottom: 12px; }
  #aria-trivia .aria-trivia-opts { display: flex; flex-direction: column; gap: 8px; }
  #aria-trivia .aria-trivia-opt {
    text-align: left; padding: 10px 12px; border-radius: 8px; cursor: pointer;
    background: #20202a; color: #f3f3f7; border: 1px solid rgba(255,255,255,0.08); font-size: 13px;
  }
  #aria-trivia .aria-trivia-opt:hover:not(:disabled) { background: #2a2a36; }
  #aria-trivia .aria-trivia-opt.correct { background: rgba(56,214,107,0.25); border-color: #38d66b; }
  #aria-trivia .aria-trivia-opt.wrong { background: rgba(255,90,90,0.25); border-color: #ff5a5a; }
`;
