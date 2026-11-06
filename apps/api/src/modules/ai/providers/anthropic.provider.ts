import { BadRequestException, Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import type { AiCompletion, AiProvider, AiRequest } from '../ai.types';
import { baseUrlOr } from './base-url';
import { postWithRetry, providerError } from './retry';

const OFFICIAL = 'https://api.anthropic.com';
const baseUrl = (ownKey?: string) => (ownKey ? OFFICIAL : baseUrlOr(OFFICIAL));

/**
 * Anthropic Messages API. `AI_BASE_URL` permite apontar para um proxy compatível.
 * Docs: https://docs.anthropic.com/en/api/messages
 */
@Injectable()
export class AnthropicProvider implements AiProvider {
  readonly kind = 'anthropic';
  readonly defaultModel = env.AI_MODEL || 'claude-haiku-4-5-20251001';

  async complete(req: AiRequest): Promise<AiCompletion> {
    const model = req.model || this.defaultModel;
    const { res, json } = await postWithRetry(
      `${baseUrl(req.apiKey)}/v1/messages`,
      {
        headers: { 'x-api-key': req.apiKey ?? env.AI_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      },
      req.timeoutMs,
    );
    if (!res.ok) throw new BadRequestException(providerError(json).message ?? `Anthropic ${res.status}`);
    const text = (json.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim();
    return { text, model: json.model ?? model, tokensIn: json.usage?.input_tokens ?? 0, tokensOut: json.usage?.output_tokens ?? 0 };
  }

  async verify(apiKey: string, model?: string) {
    const res = await fetch(`${OFFICIAL}/v1/models${model ? `/${encodeURIComponent(model)}` : ''}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (res.ok) return;
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.status === 401) throw new BadRequestException('Chave da Anthropic recusada. Confira se copiou a chave inteira e se ela não foi revogada.');
    if (res.status === 404 && model) throw new BadRequestException(`O modelo "${model}" não existe ou não está liberado para esta chave.`);
    throw new BadRequestException(providerError(json).message ?? `Anthropic ${res.status}`);
  }
}
