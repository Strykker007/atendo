/** Contrato único de IA. Fora do adapter ninguém sabe se é OpenAI, Anthropic ou outro. */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  /** instruções de sistema: papel, limites, o que não pode inventar */
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  temperature?: number;
  model?: string;
  /** aborta a chamada: o contato está esperando no WhatsApp */
  timeoutMs: number;
}

export interface AiCompletion {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  readonly kind: string;
  readonly defaultModel: string;
  complete(req: AiRequest): Promise<AiCompletion>;
}
