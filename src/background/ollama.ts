/**
 * Local inference provider - resolves commands into actions via a locally
 * running Ollama server instead of the hosted Anthropic API. Same contract
 * as callClaude() (src/background/claude.ts): same system prompt, same
 * action schema, same ClaudeResult return shape. Nothing about a command
 * ever leaves this machine when this provider is selected - the request
 * goes to `ollamaUrl` (default http://localhost:11434) only.
 *
 * Small local models are much worse at strict JSON adherence than a hosted
 * frontier model, so this uses Ollama's `format: "json"` mode (constrains
 * decoding to valid JSON) plus the same tolerant extractFirstJsonObject +
 * retry-once logic callClaude uses, so malformed output degrades to an
 * error result instead of throwing.
 */
import { buildPrompt, tryParseAction, RETRY_PROMPT, type ClaudeResult, type ReadingLevel } from './claude';
import type { PageContext, VoiceShorthand } from '@shared/types';

// Local CPU inference (especially first request, which pays model load time)
// is much slower than a hosted API - give it real room before calling it a
// timeout rather than reusing the 8s hosted budget.
const OLLAMA_TIMEOUT_MS = 30000;

export async function callOllama(
  command: string,
  page: PageContext,
  sessionContext = '',
  shorthands: VoiceShorthand[] = [],
  agentName = 'ARIA',
  readingLevel: ReadingLevel = 'standard',
  model = 'llama3.2',
  baseUrl = 'http://localhost:11434',
): Promise<ClaudeResult> {
  const { system, userMessage } = buildPrompt(command, page, sessionContext, shorthands, agentName, readingLevel);

  const raw = await requestOllama(baseUrl, model, system, [{ role: 'user', content: userMessage }]);
  if (!raw.ok || !raw.text) {
    return { ok: false, action: null, confidence: 0, suggestion: null, error: raw.error ?? 'Empty response.' };
  }

  const { action, confidence, suggestion, error } = tryParseAction(raw.text);
  if (action) return { ok: true, action, confidence, suggestion, error: null };

  // Retry once with a JSON-only follow-up, same as the hosted path.
  const retry = await requestOllama(baseUrl, model, system, [
    { role: 'user', content: userMessage },
    { role: 'assistant', content: raw.text },
    { role: 'user', content: RETRY_PROMPT },
  ]);

  if (!retry.ok || !retry.text) {
    return { ok: false, action: null, confidence: 0, suggestion: null, error: error ?? 'Retry also failed.' };
  }

  const second = tryParseAction(retry.text);
  if (second.action) return { ok: true, action: second.action, confidence: second.confidence, suggestion: second.suggestion, error: null };
  return { ok: false, action: null, confidence: 0, suggestion: null, error: second.error ?? 'Invalid action after retry.' };
}

interface RawOllamaResult {
  ok: boolean;
  text: string | null;
  error: string | null;
  errorKind?: 'timeout' | 'network' | 'api';
}

async function requestOllama(
  baseUrl: string,
  model: string,
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<RawOllamaResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        stream: false,
        format: 'json',
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const isTimeout = (e as Error).name === 'AbortError';
    if (isTimeout) {
      return { ok: false, text: null, error: `Ollama request timed out after ${OLLAMA_TIMEOUT_MS / 1000}s.`, errorKind: 'timeout' };
    }
    return { ok: false, text: null, error: `Could not reach Ollama at ${baseUrl}: ${(e as Error).message}`, errorKind: 'network' };
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, text: null, error: `Ollama API ${res.status}: ${truncate(body, 200)}`, errorKind: 'api' };
  }

  let data: OllamaChatResponse;
  try {
    data = (await res.json()) as OllamaChatResponse;
  } catch {
    return { ok: false, text: null, error: 'Malformed Ollama response.', errorKind: 'api' };
  }

  const text = data.message?.content?.trim();
  return text
    ? { ok: true, text, error: null }
    : { ok: false, text: null, error: 'Empty response from local model.', errorKind: 'api' };
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/* --------------------------- screenshot description ------------------------ */

export interface DescribeScreenshotResult {
  ok: boolean;
  description: string | null;
  error: string | null;
}

/** Checks Ollama's own capability list for `model` - avoids assuming any locally pulled model can see. */
async function modelSupportsVision(baseUrl: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { capabilities?: string[] };
    return (data.capabilities ?? []).includes('vision');
  } catch {
    return false;
  }
}

/**
 * Local-provider screenshot description. Fails closed (does not fall back to
 * the hosted API) when the configured Ollama model has no vision capability -
 * silently sending the screenshot to Anthropic instead would defeat the whole
 * point of picking the local provider.
 */
export async function describeScreenshotOllama(
  baseUrl: string,
  model: string,
  dataUrl: string,
): Promise<DescribeScreenshotResult> {
  if (!(await modelSupportsVision(baseUrl, model))) {
    return {
      ok: false,
      description: null,
      error: `Screenshot description needs a vision-capable model, and "${model}" isn't one. Install a local vision model (e.g. "ollama pull llava") or switch to the hosted provider in settings.`,
    };
  }

  const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: 'Describe what you see on this web page screenshot in 1-2 natural sentences, focusing on the main content.',
          images: [base64],
        }],
        stream: false,
      }),
    });
    if (!res.ok) return { ok: false, description: null, error: `Ollama API ${res.status}.` };
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content?.trim();
    return text
      ? { ok: true, description: text, error: null }
      : { ok: false, description: null, error: 'Empty response from local model.' };
  } catch (e) {
    return { ok: false, description: null, error: `Could not reach Ollama at ${baseUrl}: ${(e as Error).message}` };
  }
}

/**
 * Exported raw counterpart to requestClaude(), reusing the private
 * requestOllama() above. The task modules (mcq, trivia, formfill, summarize)
 * need a single system+user exchange returning text, not an AgentAction.
 */
export async function requestOllamaRaw(
  system: string,
  userContent: string,
  model = 'llama3.2',
  baseUrl = 'http://localhost:11434',
) {
  return requestOllama(baseUrl, model, system, [{ role: 'user', content: userContent }]);
}
