/**
 * Task-module Claude runner (MILESTONE 10). Each task uses a focused system
 * prompt and validates the model's JSON against its Zod schema.
 */
import { requestClaude } from './claude';
import { extractFirstJsonObject } from '@shared/actions';
import {
  FormFillResult,
  McqResult,
  SummarizeResult,
  TaskRequest,
  TriviaResult,
} from '@shared/tasks';
import type { z } from 'zod';

export interface TaskRunResult {
  ok: boolean;
  result: unknown | null;
  error: string | null;
}

export async function runTask(apiKey: string, req: TaskRequest): Promise<TaskRunResult> {
  switch (req.kind) {
    case 'mcq':
      return run(apiKey, MCQ_PROMPT, JSON.stringify({ question: req.question, options: req.options }), McqResult);
    case 'trivia':
      return run(
        apiKey,
        TRIVIA_PROMPT,
        JSON.stringify({ topic: req.topic, difficulty: req.difficulty, avoid: req.asked }),
        TriviaResult,
      );
    case 'formfill':
      return run(
        apiKey,
        FORMFILL_PROMPT,
        JSON.stringify({ fields: req.fields, values: req.values }),
        FormFillResult,
      );
    case 'summarize':
      return run(apiKey, SUMMARIZE_PROMPT, JSON.stringify({ text: req.text, url: req.url }), SummarizeResult);
  }
}

async function run<T>(
  apiKey: string,
  system: string,
  user: string,
  schema: z.ZodType<T>,
): Promise<TaskRunResult> {
  const raw = await requestClaude(apiKey, system, user);
  if (!raw.ok || !raw.text) return { ok: false, result: null, error: raw.error };

  const json = extractFirstJsonObject(raw.text);
  if (!json) return { ok: false, result: null, error: 'No JSON in response.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, result: null, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, result: null, error: validated.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, result: validated.data, error: null };
}

/* ------------------------------- prompts ---------------------------------- */

const MCQ_PROMPT = `You are answering a multiple-choice question. You receive {question, options}.
Pick the single best option. Respond with ONLY JSON: {"answerIndex": <0-based index into options>, "speech": "<short spoken justification>"}.
No prose, no markdown.`;

const TRIVIA_PROMPT = `You are a trivia host. You receive {topic, difficulty, avoid}.
Generate ONE fresh question not in "avoid". Respond with ONLY JSON:
{"question":"...","options":["A","B","C","D"],"answerIndex":<0-based>,"explanation":"..."}.
Exactly 4 options. No prose, no markdown.`;

const FORMFILL_PROMPT = `You map user-provided values to form fields. You receive {fields:[{handle,label,type}], values}.
For each field you can confidently fill from "values", emit a fill. Respond with ONLY JSON:
{"fills":[{"handle":"<field handle>","value":"<value>"}],"speech":"<short summary>"}.
Omit fields you can't determine. No prose, no markdown.`;

const SUMMARIZE_PROMPT = `You summarize web page content. You receive {text, url}.
Respond with ONLY JSON: {"summary":"<2-4 sentence plain-English summary>","bullets":["<key point>","<key point>"],"speech":"<one spoken sentence preview>"}.
No prose outside the JSON. No markdown inside the values.`;
