import { BadRequestException, Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import type { AiCompletion, AiProvider, AiRequest } from '../ai.types';
import { baseUrlOr } from './base-url';
import { postWithRetry, providerError } from './retry';

const OFFICIAL = 'https://api.openai.com/v1';
const baseUrl = (ownKey?: string) => (ownKey ? OFFICIAL : baseUrlOr(OFFICIAL));

/**
 * Chat Completions no formato da OpenAI. `AI_BASE_URL` aponta para qualquer endpoint
 * compatível (Ollama local, Groq, OpenRouter, Gemini no modo compatível).
 * Docs: https://platform.openai.com/docs/api-reference/chat
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly kind = 'openai';
  readonly defaultModel = env.AI_MODEL || 'gpt-4o-mini';

  async complete(req: AiRequest): Promise<AiCompletion> {
    const model = req.model || this.defaultModel;
    const { res, json } = await postWithRetry(
      `${baseUrl(req.apiKey)}/chat/completions`,
      {
        headers: { Authorization: `Bearer ${req.apiKey ?? env.AI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
        }),
      },
      req.timeoutMs,
    );
    if (!res.ok) throw new BadRequestException(providerError(json).message ?? `IA ${res.status}${res.status === 503 ? ' (fornecedor sobrecarregado, tente de novo)' : ''}`);
    return {
      text: String(json.choices?.[0]?.message?.content ?? '').trim(),
      model: json.model ?? model,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    };
  }

  async verify(apiKey: string, model?: string) {
    const res = await fetch(`${OFFICIAL}/models${model ? `/${encodeURIComponent(model)}` : ''}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return;
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.status === 401) throw new BadRequestException('Chave da OpenAI recusada. Confira se copiou a chave inteira e se ela não foi revogada.');
    if (res.status === 404 && model) throw new BadRequestException(`O modelo "${model}" não existe ou não está liberado para esta chave.`);
    throw new BadRequestException(providerError(json).message ?? `OpenAI ${res.status}`);
  }
}
