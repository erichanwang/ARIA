/**
 * Claude action schema validator unit tests.
 * Tests parseAgentAction and extractFirstJsonObject against known good/bad
 * Claude output patterns.
 */
import { describe, it, expect } from 'vitest';
import { parseAgentAction, extractFirstJsonObject } from '../src/shared/actions';

/* ---------- extractFirstJsonObject ---------------------------------------- */
describe('extractFirstJsonObject', () => {
  it('extracts clean JSON', () => {
    const json = '{"action":"click","target":"submit","speech":"Clicking submit","confidence":0.9}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });

  it('extracts JSON preceded by prose', () => {
    const raw = 'Sure, here you go: {"action":"scroll","direction":"down","speech":"Scrolling","confidence":0.8}';
    const result = extractFirstJsonObject(raw);
    expect(result).toContain('"action":"scroll"');
  });

  it('extracts JSON from markdown code fence', () => {
    const raw = '```json\n{"action":"answer","text":"42","speech":"The answer is 42","confidence":1.0}\n```';
    const result = extractFirstJsonObject(raw);
    expect(result).toContain('"action":"answer"');
  });

  it('handles braces inside string values', () => {
    const raw = '{"action":"answer","text":"Use {braces} like this","speech":"Done","confidence":0.9}';
    const result = extractFirstJsonObject(raw);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).text).toBe('Use {braces} like this');
  });

  it('returns null for empty string', () => {
    expect(extractFirstJsonObject('')).toBeNull();
  });

  it('returns null for plain prose with no JSON', () => {
    expect(extractFirstJsonObject('I cannot help with that.')).toBeNull();
  });
});

/* ---------- parseAgentAction: valid actions -------------------------------- */
describe('parseAgentAction — valid inputs', () => {
  it('parses click action', () => {
    const r = parseAgentAction('{"action":"click","target":"the login button","speech":"Clicking login","confidence":0.95}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.action).toBe('click');
  });

  it('parses scroll action with defaults', () => {
    const r = parseAgentAction('{"action":"scroll","direction":"down","speech":"Scrolling down","confidence":0.9}');
    expect(r.ok).toBe(true);
    if (r.ok && r.action.action === 'scroll') {
      expect(r.action.direction).toBe('down');
      expect(r.action.amount).toBe('medium'); // default
    }
  });

  it('parses navigate action', () => {
    const r = parseAgentAction('{"action":"navigate","url":"https://example.com","speech":"Navigating","confidence":0.98}');
    expect(r.ok).toBe(true);
    if (r.ok && r.action.action === 'navigate') {
      expect(r.action.url).toBe('https://example.com');
    }
  });

  it('parses answer action', () => {
    const r = parseAgentAction('{"action":"answer","text":"The capital is Paris","speech":"The capital is Paris","confidence":1.0}');
    expect(r.ok).toBe(true);
    if (r.ok && r.action.action === 'answer') {
      expect(r.action.text).toContain('Paris');
    }
  });

  it('parses none action', () => {
    const r = parseAgentAction('{"action":"none","speech":"I could not help with that","confidence":0.5}');
    expect(r.ok).toBe(true);
  });

  it('parses multi_step action', () => {
    const raw = JSON.stringify({
      action: 'multi_step',
      steps: [
        { action: 'click', target: 'search box', speech: 'Clicking search' },
        { action: 'scroll', direction: 'down', speech: 'Scrolling down' },
      ],
      speech: 'Running two steps',
      confidence: 0.85,
    });
    const r = parseAgentAction(raw);
    expect(r.ok).toBe(true);
    if (r.ok && r.action.action === 'multi_step') {
      expect(r.action.steps).toHaveLength(2);
    }
  });

  it('ignores extra fields (confidence stripped by Zod passthrough)', () => {
    const r = parseAgentAction('{"action":"click","target":"btn","speech":"Clicking","confidence":0.9,"extra":"ignored"}');
    expect(r.ok).toBe(true);
  });
});

/* ---------- parseAgentAction: invalid / malformed inputs ------------------ */
describe('parseAgentAction — invalid inputs', () => {
  it('rejects unknown action type', () => {
    const r = parseAgentAction('{"action":"explode","speech":"Boom","confidence":0.9}');
    expect(r.ok).toBe(false);
  });

  it('rejects missing speech field', () => {
    // speech is missing entirely → Zod issues "Required" (not the custom min message)
    const r = parseAgentAction('{"action":"click","target":"btn","confidence":0.9}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it('rejects invalid scroll direction', () => {
    const r = parseAgentAction('{"action":"scroll","direction":"sideways","speech":"Scrolling","confidence":0.9}');
    expect(r.ok).toBe(false);
  });

  it('rejects completely invalid JSON', () => {
    const r = parseAgentAction('{not json at all}');
    expect(r.ok).toBe(false);
  });

  it('rejects empty string', () => {
    const r = parseAgentAction('');
    expect(r.ok).toBe(false);
  });

  it('rejects plain prose with no JSON', () => {
    const r = parseAgentAction("I'm sorry, I cannot help with that request.");
    expect(r.ok).toBe(false);
  });

  it('rejects truncated JSON from a malformed model response', () => {
    const r = parseAgentAction('{"action":"click","target":"submit","speech":"Clicking');
    expect(r.ok).toBe(false);
  });

  it('rejects a JSON array instead of an action object', () => {
    const r = parseAgentAction('[{"action":"click","target":"submit","speech":"Clicking"}]');
    expect(r.ok).toBe(false);
  });

  it('rejects unknown action types even when their fields look valid', () => {
    const r = parseAgentAction('{"action":"run_javascript","code":"alert(1)","speech":"Done"}');
    expect(r.ok).toBe(false);
  });

  it('rejects click action with empty target', () => {
    const r = parseAgentAction('{"action":"click","target":"","speech":"Clicking","confidence":0.9}');
    expect(r.ok).toBe(false);
  });
});
