/**
 * Provider dispatch: picks the hosted Anthropic path or the local Ollama
 * path based on settings.inferenceProvider. Default is 'anthropic', so
 * existing users see no behavior change until they opt into local inference.
 */
import { callClaude , requestClaude } from './claude';
import { callOllama, requestOllamaRaw } from './ollama';
import type { ClaudeResult, RawClaudeResult } from './claude';
import type { AriaSettings } from '@shared/types';
import type { PageContext, VoiceShorthand } from '@shared/types';

export async function callAgent(
  settings: AriaSettings,
  command: string,
  page: PageContext,
  sessionContext = '',
  shorthands: VoiceShorthand[] = [],
): Promise<ClaudeResult> {
  if (settings.inferenceProvider === 'ollama') {
    return callOllama(
      command,
      page,
      sessionContext,
      shorthands,
      settings.agentName ?? 'ARIA',
      settings.readingLevel ?? 'standard',
      settings.ollamaModel || 'llama3.2',
      settings.ollamaUrl || 'http://localhost:11434',
    );
  }
  return callClaude(
    settings.apiKey,
    command,
    page,
    sessionContext,
    shorthands,
    settings.agentName ?? 'ARIA',
    settings.readingLevel ?? 'standard',
  );
}

/**
 * Provider-aware counterpart to requestClaude(): a single system+user exchange
 * returning raw text, routed to whichever backend the user selected.
 *
 * The task modules used to call requestClaude() directly, which meant that
 * selecting the local provider silently did nothing for them - page text still
 * went to the hosted API. Routing through here keeps that promise honest.
 */
export async function requestAgentRaw(
  settings: AriaSettings,
  system: string,
  userContent: string,
): Promise<RawClaudeResult> {
  if (settings.inferenceProvider === 'ollama') {
    return requestOllamaRaw(
      system,
      userContent,
      settings.ollamaModel ?? 'llama3.2',
      settings.ollamaUrl ?? 'http://localhost:11434',
    );
  }
  return requestClaude(settings.apiKey, system, userContent);
}
