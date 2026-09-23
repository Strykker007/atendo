import { BadRequestException, Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import type { AiCompletion, AiProvider, AiRequest } from '../ai.types';

/** Anthropic Messages API. Docs: https://docs.anthropic.com/en/api/messages */
@Injectable()
export class AnthropicProvider implements AiProvider {
  readonly kind = 'anthropic';
  readonly defaultModel = env.AI_MODEL || 'claude-haiku-4-5-20251001';

  async complete(req: AiRequest): Promise<AiCompletion> {
    const model = req.model || this.defaultModel;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(req.timeoutMs),
      headers: { 'x-api-key': env.AI_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new BadRequestException(json?.error?.message ?? `Anthropic ${res.status}`);
    const text = (json.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim();
    return { text, model: json.model ?? model, tokensIn: json.usage?.input_tokens ?? 0, tokensOut: json.usage?.output_tokens ?? 0 };
  }
}
