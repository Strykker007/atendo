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
} as const;
export type AiTask = (typeof AiTask)[keyof typeof AiTask];

export const AI_TASK_LABEL: Record<AiTask, string> = {
  flow_answer: 'Resposta da IA no fluxo',
  flow_classify: 'Classificação da IA no fluxo',
  suggest: 'Sugestão de resposta',
  rewrite: 'Reescrita',
  summary: 'Resumo da conversa',
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
};
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
