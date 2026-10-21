/**
 * Privacy regression test for the "on-device inference, no video uploaded"
 * claim: everything that reaches the Claude API over the network is text
 * (command + page url/title/excerpt/selected_text). Camera-derived data
 * (gaze position, hand landmarks, gestures) must never leak into that
 * request body, even though PageContext carries an optional `gazePos` field
 * internally (F30) - callClaude() must keep dropping it when it builds the
 * outbound JSON. This fails loudly if a future change spreads `...page`
 * into the request instead of picking fields explicitly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callClaude } from '../src/background/claude';
import { callAgent } from '../src/background/inference';
import { describeScreenshotOllama } from '../src/background/ollama';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { PageContext } from '@shared/types';

// Fields that only make sense as camera-derived / vision-frame data. If any
// of these ever show up in a network request body, a frame-carrying payload
// has reached the network layer.
const FRAME_MARKERS = ['gazePos', 'gaze', 'fingertip', 'gesture', 'tracker', 'blinkLeft', 'blinkRight', 'browRaise'];

describe('callClaude network payload (privacy)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: '{"action":"none","speech":"ok","confidence":1}' }] }),
    })) as unknown as typeof fetch;
  });

  it('never sends gazePos or any other camera-derived field to the API', async () => {
    const page: PageContext = {
      url: 'https://example.com',
      title: 'Example',
      excerpt: 'Some page text.',
      selected_text: '',
      gazePos: { x: 0.42, y: 0.73 }, // eye-mode is active - this must not leak out
    };

    await callClaude('fake-api-key', 'click submit', page);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');

    // Check only the user-supplied message content, not the whole request
    // body - the static system prompt legitimately mentions action names
    // like "gesture_trainer" and would otherwise false-positive on "gesture".
    const body = JSON.parse(init.body as string) as { messages: Array<{ content: string }> };
    const userContent = body.messages[0].content;
    for (const marker of FRAME_MARKERS) {
      expect(userContent).not.toContain(marker);
    }

    // Sanity check: the text fields we DO expect are actually present, so
    // this test would fail (not vacuously pass) if callClaude stopped
    // sending page context entirely.
    expect(userContent).toContain('example.com');
    expect(userContent).toContain('click submit');
  });
});

describe('callAgent network payload (privacy: local provider)', () => {
  // When settings.inferenceProvider is 'ollama', callAgent must route to the
  // local Ollama server and MUST NOT reach api.anthropic.com or any other
  // non-localhost host - that's what makes "on-device inference" true rather
  // than aspirational. This turns that claim into something CI checks.
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { role: 'assistant', content: '{"action":"none","speech":"ok","confidence":1}' } }),
    })) as unknown as typeof fetch;
  });

  it('never contacts a non-localhost host when the local provider is selected', async () => {
    const settings = { ...DEFAULT_SETTINGS, inferenceProvider: 'ollama' as const, apiKey: '' };
    const page: PageContext = {
      url: 'https://example.com',
      title: 'Example',
      excerpt: 'Some page text.',
      selected_text: '',
      gazePos: { x: 0.42, y: 0.73 },
    };

    await callAgent(settings, 'click submit', page);

    expect(fetch).toHaveBeenCalledTimes(1);
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;
    for (const [url, init] of calls) {
      const hostname = new URL(url).hostname;
      expect(hostname).not.toBe('api.anthropic.com');
      expect(hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);

      const body = JSON.parse(init.body as string) as { messages: Array<{ content: string }> };
      const userContent = body.messages[body.messages.length - 1].content;
      for (const marker of FRAME_MARKERS) {
        expect(userContent).not.toContain(marker);
      }
    }
  });
});

describe('describeScreenshotOllama (privacy: screenshot description, local provider)', () => {
  // Regression test for the bug this fixes: DESCRIBE_SCREENSHOT used to be
  // hardcoded to api.anthropic.com regardless of settings.inferenceProvider,
  // so a user who picked "local only" still had a JPEG of their tab sent to
  // Anthropic. Now the local path must never contact api.anthropic.com (or
  // any non-localhost host), and must fail closed - not silently fall back
  // to the hosted API - when no vision-capable model is installed locally.
  const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  it('fails closed (no fetch to the chat endpoint, no Anthropic call) when the local model has no vision capability', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ capabilities: ['completion', 'tools'] }), // no 'vision' - matches llama3.2:1b / qwen2.5:0.5b today
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await describeScreenshotOllama('http://localhost:11434', 'llama3.2:1b', dataUrl);

    expect(res.ok).toBe(false);
    expect(res.description).toBeNull();
    expect(res.error).toBeTruthy(); // clear user-facing message, not a silent failure
    // Only the capability check (/api/show) happened - no chat/vision request was ever sent.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  });

  it('never contacts api.anthropic.com even when a vision-capable local model is installed', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/show')) {
        return { ok: true, status: 200, json: async () => ({ capabilities: ['completion', 'vision'] }) };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: 'A page with a login form.' } }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await describeScreenshotOllama('http://localhost:11434', 'llava', dataUrl);

    expect(res.ok).toBe(true);
    expect(res.description).toBe('A page with a login form.');
    for (const [url] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      const hostname = new URL(url).hostname;
      expect(hostname).not.toBe('api.anthropic.com');
      expect(hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    }
  });
});

describe('task modules respect the selected provider', () => {
  it('never contacts Anthropic when the local provider is selected', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      seen.push(String(url));
      return new Response(
        JSON.stringify({ message: { content: '{"summary":"ok","bullets":[]}' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { runTask } = await import('../src/background/tasks');
    await runTask(
      {
        apiKey: 'sk-ant-should-never-be-used',
        inferenceProvider: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.2',
      } as never,
      { kind: 'summarize', text: 'private page text', url: 'https://example.com' } as never,
    );

    expect(seen.length).toBeGreaterThan(0);
    for (const url of seen) {
      expect(url).not.toContain('api.anthropic.com');
      expect(url).toMatch(/localhost|127\.0\.0\.1/);
    }
    vi.unstubAllGlobals();
  });
});
