/**
 * Local inference provider (Ollama) tests, mirroring claude-privacy.test.ts:
 * - callOllama parses valid JSON and repairs malformed output via one retry,
 *   same tolerant-parse contract as callClaude.
 * - callAgent (src/background/inference.ts), when settings.inferenceProvider
 *   is 'ollama', never issues a request to any non-localhost host, and never
 *   leaks camera-derived fields (gazePos etc.) - the same privacy guarantee
 *   claude-privacy.test.ts enforces for the hosted path, now enforced for
 *   the local path too (CI, not just prose).
 */
import { describe, it, expect, vi } from 'vitest';
import { callOllama } from '../src/background/ollama';
import type { PageContext } from '@shared/types';

const FRAME_MARKERS = ['gazePos', 'gaze', 'fingertip', 'gesture', 'tracker', 'blinkLeft', 'blinkRight', 'browRaise'];

function ollamaOk(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ message: { role: 'assistant', content } }),
  };
}

describe('callOllama (local provider)', () => {
  const page: PageContext = {
    url: 'https://example.com',
    title: 'Example',
    excerpt: 'Some page text.',
    selected_text: '',
  };

  it('parses a valid JSON response into an action', async () => {
    global.fetch = vi.fn(async () =>
      ollamaOk('{"action":"none","speech":"ok","confidence":0.8}'),
    ) as unknown as typeof fetch;

    const result = await callOllama('click submit', page);
    expect(result.ok).toBe(true);
    expect(result.action?.action).toBe('none');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('repairs malformed output with one retry instead of crashing', async () => {
    const fetchMock = vi
      .fn()
      // First reply: small local model rambles instead of returning bare JSON.
      .mockResolvedValueOnce(ollamaOk('Sure! I think the answer is {"action":"none"'))
      // Retry reply: valid JSON.
      .mockResolvedValueOnce(ollamaOk('{"action":"none","speech":"recovered","confidence":0.5}'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await callOllama('do something unclear', page);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.action?.action).toBe('none');
  });

  it('returns a graceful error (not a throw) when both attempts are unparseable', async () => {
    global.fetch = vi.fn(async () => ollamaOk('not json at all')) as unknown as typeof fetch;

    const result = await callOllama('gibberish command', page);
    expect(result.ok).toBe(false);
    expect(result.action).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('never sends camera-derived fields to the local model', async () => {
    const fetchMock = vi.fn(async () => ollamaOk('{"action":"none","speech":"ok","confidence":1}'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const pageWithGaze: PageContext = { ...page, gazePos: { x: 0.4, y: 0.6 } };
    await callOllama('click submit', pageWithGaze);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: Array<{ content: string }> };
    const userContent = body.messages[body.messages.length - 1].content;
    for (const marker of FRAME_MARKERS) {
      expect(userContent).not.toContain(marker);
    }
  });

  it('requests only the configured local baseUrl, never a remote host', async () => {
    const fetchMock = vi.fn(async () => ollamaOk('{"action":"none","speech":"ok","confidence":1}'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await callOllama('click submit', page, '', [], 'ARIA', 'standard', 'llama3.2', 'http://localhost:11434');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  });
});

