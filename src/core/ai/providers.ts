import { createFireworks } from '@ai-sdk/fireworks';
import { createOpenAI } from '@ai-sdk/openai';
import {
  extractReasoningMiddleware,
  LanguageModelV1,
  wrapLanguageModel,
} from 'ai';
import { getEncoding } from 'js-tiktoken';

import { RecursiveCharacterTextSplitter } from './text-splitter';

export interface ModelSettings {
  openaiKey?: string;
  openaiEndpoint?: string;
  customModel?: string;
  fireworksKey?: string;
  contextSize?: number;
  /** Model name for fast tasks (extraction, summarization). Falls back to primary model. */
  fastModel?: string;
  /** Endpoint for fast model if different from primary. Defaults to openaiEndpoint. */
  fastModelEndpoint?: string;
}

/**
 * Create a language model from explicit settings.
 * Falls back to process.env when no settings provided (CLI backward compat).
 */
export function getModel(settings?: ModelSettings): LanguageModelV1 {
  const openaiKey = settings?.openaiKey ?? process.env.OPENAI_KEY;
  const openaiEndpoint =
    settings?.openaiEndpoint ?? process.env.OPENAI_ENDPOINT;
  const customModelName =
    settings?.customModel ?? process.env.CUSTOM_MODEL;
  const fireworksKey =
    settings?.fireworksKey ?? process.env.FIREWORKS_KEY;

  const openai = openaiKey
    ? createOpenAI({
        apiKey: openaiKey,
        baseURL: openaiEndpoint || 'https://api.openai.com/v1',
      })
    : undefined;

  const customModel = customModelName
    ? openai?.(customModelName, { structuredOutputs: true })
    : undefined;

  if (customModel) {
    return customModel;
  }

  const fireworks = fireworksKey
    ? createFireworks({ apiKey: fireworksKey })
    : undefined;

  const deepSeekR1Model = fireworks
    ? wrapLanguageModel({
        model: fireworks(
          'accounts/fireworks/models/deepseek-r1',
        ) as LanguageModelV1,
        middleware: extractReasoningMiddleware({ tagName: 'think' }),
      })
    : undefined;

  const o3MiniModel = openai?.('o3-mini', {
    reasoningEffort: 'medium',
    structuredOutputs: true,
  });

  const model = deepSeekR1Model ?? o3MiniModel;
  if (!model) {
    throw new Error(
      'No model found. Configure OPENAI_KEY or FIREWORKS_KEY, or set CUSTOM_MODEL with OPENAI_ENDPOINT.',
    );
  }

  return model as LanguageModelV1;
}

export type ModelRole = 'thinking' | 'fast';

/**
 * Return a model appropriate for the given role.
 * - 'thinking': planning, query generation, reasoning, report synthesis → primary model
 * - 'fast': extraction, summarization → fastModel if configured, else primary model
 */
export function getModelForRole(
  settings: ModelSettings | undefined,
  role: ModelRole,
): LanguageModelV1 {
  if (role === 'fast' && settings?.fastModel) {
    const apiKey = settings.openaiKey ?? process.env.OPENAI_KEY;
    const endpoint =
      settings.fastModelEndpoint ||
      settings.openaiEndpoint ||
      process.env.OPENAI_ENDPOINT ||
      'https://api.openai.com/v1';
    if (!apiKey) return getModel(settings); // fallback if no key
    const provider = createOpenAI({ apiKey, baseURL: endpoint });
    return provider(settings.fastModel, {
      structuredOutputs: true,
    }) as LanguageModelV1;
  }
  return getModel(settings);
}

const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 128_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  return trimPrompt(trimmedPrompt, contextSize);
}
