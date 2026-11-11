import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { AI_KEY_PROVIDERS } from '@atendo/shared';
import { RedisService } from '../../../common/redis/redis.service';
import type { AiCompletion, AiProvider, AiRequest } from '../ai.types';
import { AiBusyError, modelChain, parseGeminiQuota } from '../ai-busy';
import { postWithRetry, providerError } from './retry';

/** Endpoint oficial do Google no formato da OpenAI — fixo (chave do cliente nunca escolhe endereço). */
const OFFICIAL = 'https://generativelanguage.googleapis.com/v1beta/openai';
/** 429 aqui é cota (minuto/dia), não sobrecarga: não adianta repetir em 0,7s — troca de modelo. */
const RETRYABLE = new Set([500, 502, 503]);

const keyId = (apiKey: string) => createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
const coolKey = (apiKey: string, model: string) => `ai:gemini:cool:${keyId(apiKey)}:${model}`;
const dailyKey = (apiKey: string, model: string) => `ai:gemini:daily:${keyId(apiKey)}:${model}`;

/**
 * Gemini pela chave própria do cliente (docs/15-ia.md#gemini-e-o-plano-grátis). Para o plano
 * grátis do AI Studio ser viável:
 * - cada modelo tem cota própria: bateu o limite em um, tenta o próximo da lista na mesma rodada;
 * - o modelo que estourou fica "esfriando" no Redis pelo tempo que o Google pediu (ou até a
 *   meia-noite do Pacífico, se foi a cota do dia), e as rodadas seguintes nem tentam nele;
 * - todos no limite: lança `AiBusyError` com quanto esperar — o bloco Agente reagenda a rodada.
 */
@Injectable()
export class GeminiProvider implements AiProvider {
  readonly kind = 'gemini';
  readonly defaultModel = AI_KEY_PROVIDERS.gemini.defaultModel;

  constructor(private readonly redis: RedisService) {}

  async complete(req: AiRequest): Promise<AiCompletion> {
    const apiKey = req.apiKey;
    if (!apiKey) throw new BadRequestException('Gemini só funciona com a chave própria da empresa.');
    const deadline = Date.now() + req.timeoutMs;
    let wait = Infinity;
    let allDaily = true;

    for (const model of modelChain(req.model || this.defaultModel, AI_KEY_PROVIDERS.gemini.models)) {
      const [coolMs, isDaily] = await Promise.all([this.redis.pttl(coolKey(apiKey, model)), this.redis.exists(dailyKey(apiKey, model))]);
      if (coolMs > 0) { wait = Math.min(wait, coolMs); allDaily &&= isDaily === 1; continue; }
      const left = deadline - Date.now();
      if (left < 2000) break;

      const { res, json } = await postWithRetry(
        `${OFFICIAL}/chat/completions`,
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: req.maxTokens, temperature: req.temperature, messages: [{ role: 'system', content: req.system }, ...req.messages] }),
        },
        left,
        RETRYABLE,
      );
      if (res.ok) {
        return {
          text: String(json.choices?.[0]?.message?.content ?? '').trim(),
          model: json.model ?? model,
          tokensIn: json.usage?.prompt_tokens ?? 0,
          tokensOut: json.usage?.completion_tokens ?? 0,
        };
      }
      if (res.status !== 429) throw new BadRequestException(keyRefused(res.status, json) ?? providerError(json).message ?? `Gemini ${res.status}`);

      const quota = parseGeminiQuota(json);
      await this.redis.set(coolKey(apiKey, model), '1', 'PX', quota.retryAfterMs);
      if (quota.daily) await this.redis.set(dailyKey(apiKey, model), '1', 'PX', quota.retryAfterMs);
      wait = Math.min(wait, quota.retryAfterMs);
      allDaily &&= quota.daily;
    }
    // sobrou pouco do prazo, sem ter batido limite: espera curta e tenta de novo
    if (wait === Infinity) { wait = 10_000; allDaily = false; }
    throw new AiBusyError(wait, allDaily);
  }

  /** Situação de cada modelo para a tela: livre, no limite do minuto ou do dia (e até quando). */
  async state(apiKey: string, chosen?: string) {
    return Promise.all(
      modelChain(chosen || this.defaultModel, AI_KEY_PROVIDERS.gemini.models).map(async (model) => {
        const [ms, daily] = await Promise.all([this.redis.pttl(coolKey(apiKey, model)), this.redis.exists(dailyKey(apiKey, model))]);
        const state: 'free' | 'minute' | 'daily' = ms > 0 ? (daily ? 'daily' : 'minute') : 'free';
        return { model, state, until: ms > 0 ? new Date(Date.now() + ms).toISOString() : null };
      }),
    );
  }

  async verify(apiKey: string, model?: string) {
    const res = await fetch(`${OFFICIAL}/models${model ? `/${encodeURIComponent(model)}` : ''}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return;
    const json = (await res.json().catch(() => ({}))) as unknown;
    const refused = keyRefused(res.status, json);
    if (refused) throw new BadRequestException(refused);
    if (res.status === 404 && model) throw new BadRequestException(`O modelo "${model}" não existe ou não está liberado para esta chave.`);
    throw new BadRequestException(providerError(json).message ?? `Gemini ${res.status}`);
  }
}

/** O Google responde chave inválida com 400 "API key not valid" (e às vezes 401/403). */
function keyRefused(status: number, json: unknown): string | null {
  const msg = providerError(json).message ?? '';
  if (status === 401 || status === 403 || /api key/i.test(msg)) {
    return 'Chave do Gemini recusada. Crie a chave em aistudio.google.com/apikey, copie inteira e confira se a API Generative Language está ativa no projeto.';
  }
  return null;
}
