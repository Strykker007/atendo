/**
 * IA: tipos canônicos. Assim como nos providers de WhatsApp, a UI, o banco e as filas
 * só conhecem isto — trocar OpenAI por Anthropic (ou negociar preço com outro fornecedor)
 * não muda nada fora do adapter.
 */

export const AiTask = {
  /** nó de IA do fluxo respondendo ao contato */
  FLOW_ANSWER: 'flow_answer',
  /** nó de IA do fluxo classificando a mensagem para escolher o caminho */
  FLOW_CLASSIFY: 'flow_classify',
  /** copiloto: sugerir a próxima resposta ao atendente */
  SUGGEST: 'suggest',
  /** copiloto: reescrever o que o atendente digitou */
  REWRITE: 'rewrite',
  /** copiloto: resumir a conversa para quem vai assumir */
  SUMMARY: 'summary',
  /** agente de IA com etapas (bloco IA modo Agente e o simulador) — docs/agente-ia.md */
  FLOW_AGENT: 'flow_agent',
  /** documentos do agente: gerar a busca por significado (embeddings) na hora do upload — não conta como interação */
  KNOWLEDGE: 'knowledge',
} as const;
export type AiTask = (typeof AiTask)[keyof typeof AiTask];

export const AI_TASK_LABEL: Record<AiTask, string> = {
  flow_answer: 'Resposta da IA no fluxo',
  flow_classify: 'Classificação da IA no fluxo',
  suggest: 'Sugestão de resposta',
  rewrite: 'Reescrita',
  summary: 'Resumo da conversa',
  flow_agent: 'Agente de IA',
  knowledge: 'Leitura de documentos do agente',
};

export const REWRITE_TONES = {
  formal: 'mais formal',
  friendly: 'mais simpático',
  short: 'mais curto',
  clear: 'mais claro',
} as const;
export type RewriteTone = keyof typeof REWRITE_TONES;

/**
 * Preço por 1.000 tokens em **USD**, como os fornecedores publicam.
 * Quando um deles reajustar, é aqui que se mexe — e a margem sai certa no relatório,
 * porque o ledger guarda o custo calculado no momento da chamada.
 */
export interface AiModelPrice {
  inputPer1k: number;
  outputPer1k: number;
}
export const AI_MODEL_PRICE: Record<string, AiModelPrice> = {
  // Anthropic
  'claude-haiku-4-5-20251001': { inputPer1k: 0.001, outputPer1k: 0.005 },
  'claude-sonnet-5': { inputPer1k: 0.003, outputPer1k: 0.015 },
  // OpenAI
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  // Google (Gemini) — no plano grátis do AI Studio não há cobrança; o valor fica só de referência
  'gemini-2.5-flash': { inputPer1k: 0.0003, outputPer1k: 0.0025 },
  'gemini-2.5-flash-lite': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
};
/**
 * Fornecedores aceitos na **chave própria do cliente** (feature `ai_own_key`). Sempre o endpoint
 * oficial — endereço livre seria porta para a API chamar qualquer servidor (SSRF).
 */
export const AI_KEY_PROVIDERS = {
  openai: { label: 'OpenAI (ChatGPT)', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o'], keyHint: 'sk-…', consoleUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-haiku-4-5-20251001', models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5'], keyHint: 'sk-ant-…', consoleUrl: 'https://console.anthropic.com/settings/keys' },
  /**
   * Gemini (Google AI Studio): tem plano **grátis**, com limite de pedidos por minuto e por dia
   * (por modelo). Os modelos da lista são tentados em ordem quando um bate o limite
   * (docs/15-ia.md#gemini-e-o-plano-grátis).
   */
  gemini: { label: 'Google (Gemini)', defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'], keyHint: 'AIza…', consoleUrl: 'https://aistudio.google.com/apikey' },
} as const;
export type AiKeyProvider = keyof typeof AI_KEY_PROVIDERS;
export const AI_KEY_PROVIDER_IDS = Object.keys(AI_KEY_PROVIDERS) as AiKeyProvider[];

/** `GET /ai/own-key` */
export interface AiOwnKeyStatus {
  /** plano inclui `ai_own_key` */
  feature: boolean;
  connected: boolean;
  /** conectada E o plano inclui: é ela que está sendo usada */
  inUse: boolean;
  provider?: AiKeyProvider;
  model?: string;
  /** últimos 4 caracteres, para conferir qual chave está gravada */
  keyLast4?: string;
  /** último erro do fornecedor (chave revogada, sem crédito); some no próximo sucesso */
  lastError?: string | null;
  lastErrorAt?: string | null;
  updatedAt?: string;
}

/** Preço de um modelo desconhecido: assume o mais caro da tabela, para nunca subestimar custo. */
export function priceOf(model: string): AiModelPrice {
  return (
    AI_MODEL_PRICE[model] ??
    Object.values(AI_MODEL_PRICE).reduce((worst, p) => (p.outputPer1k > worst.outputPer1k ? p : worst))
  );
}

/** Custo em USD de uma chamada. */
export function aiCostUsd(model: string, tokensIn: number, tokensOut: number) {
  const p = priceOf(model);
  return (tokensIn / 1000) * p.inputPer1k + (tokensOut / 1000) * p.outputPer1k;
}
