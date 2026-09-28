import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../../config/env';
import type { AiProvider } from './ai.types';
import { isLocalEndpoint } from './providers/base-url';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';

/**
 * Qual fornecedor de IA está em uso. Trocar = mudar `AI_PROVIDER` no ambiente;
 * nada além do adapter sabe a diferença (mesmo desenho dos providers de WhatsApp).
 */
@Injectable()
export class AiProviderRegistry {
  constructor(
    private readonly anthropic: AnthropicProvider,
    private readonly openai: OpenAiProvider,
  ) {}

  /** true quando há fornecedor e chave — endpoint local (Ollama) dispensa chave. */
  get configured() {
    return env.AI_PROVIDER !== 'none' && (!!env.AI_API_KEY || isLocalEndpoint());
  }

  get(): AiProvider {
    if (!this.configured) throw new ServiceUnavailableException('IA não configurada neste ambiente (AI_PROVIDER/AI_API_KEY).');
    return env.AI_PROVIDER === 'openai' ? this.openai : this.anthropic;
  }
}
