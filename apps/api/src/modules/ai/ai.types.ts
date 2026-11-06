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
  /**
   * Chave do próprio cliente (`ai_credentials`). Presente = endpoint **oficial** do fornecedor,
   * ignorando `AI_BASE_URL` (que é configuração da plataforma, não do cliente).
   */
  apiKey?: string;
}

export interface AiCompletion {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  readonly kind: string;
  /** modelo da plataforma (`AI_MODEL` ou o mais barato do adapter) */
  readonly defaultModel: string;
  complete(req: AiRequest): Promise<AiCompletion>;
  /** confere a chave do cliente (e o modelo, se informado) sem gastar token; lança com a mensagem do fornecedor */
  verify(apiKey: string, model?: string): Promise<void>;
}
