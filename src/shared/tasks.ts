/**
 * Task-module contracts (MILESTONE 10). These are higher-level flows than the
 * single-step AgentAction: MCQ solving, trivia generation, and form filling.
 * Each makes its own Claude call with a task-specific prompt, validated here.
 */
import { z } from 'zod';

/* ------------------------------- requests --------------------------------- */

export interface McqRequest {
  kind: 'mcq';
  question: string;
  options: string[];
}

export interface TriviaRequest {
  kind: 'trivia';
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  asked: string[]; // questions already used this session (avoid repeats)
}

export interface FormFillField {
  /** Stable handle used to locate the field again (name/id/label). */
  handle: string;
  label: string;
  type: string;
}

export interface FormFillRequest {
  kind: 'formfill';
  fields: FormFillField[];
  /** Free-text the user provided, e.g. "name Jane Doe, email jane@x.com". */
  values: string;
}

export interface SummarizeRequest {
  kind: 'summarize';
  text: string;
  url: string;
}

export type TaskRequest = McqRequest | TriviaRequest | FormFillRequest | SummarizeRequest;

/* ---------------------------- result schemas ------------------------------ */

export const McqResult = z.object({
  answerIndex: z.number().int().min(0),
  speech: z.string().min(1),
});
export type McqResult = z.infer<typeof McqResult>;

export const TriviaResult = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(6),
  answerIndex: z.number().int().min(0),
  explanation: z.string().min(1),
});
export type TriviaResult = z.infer<typeof TriviaResult>;

export const FormFillResult = z.object({
  fills: z.array(z.object({ handle: z.string(), value: z.string() })),
  speech: z.string().min(1),
});
export type FormFillResult = z.infer<typeof FormFillResult>;

export const SummarizeResult = z.object({
  summary: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(1).max(10),
  speech: z.string().min(1),
});
export type SummarizeResult = z.infer<typeof SummarizeResult>;

/** Map a request kind to its result type (used by the background runner). */
export interface TaskResultMap {
  mcq: McqResult;
  trivia: TriviaResult;
  formfill: FormFillResult;
  summarize: SummarizeResult;
}
