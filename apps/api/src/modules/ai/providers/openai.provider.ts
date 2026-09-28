import { BadRequestException, Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import type { AiCompletion, AiProvider, AiRequest } from '../ai.types';
import { baseUrlOr } from './base-url';

const baseUrl = () => baseUrlOr('https://api.openai.com/v1');

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
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(req.timeoutMs),
      headers: { Authorization: `Bearer ${env.AI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
      }),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new BadRequestException(json?.error?.message ?? `OpenAI ${res.status}`);
    return {
      text: String(json.choices?.[0]?.message?.content ?? '').trim(),
      model: json.model ?? model,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    };
  }
}
