import { BadRequestException, GatewayTimeoutException, HttpException } from '@nestjs/common';

/**
 * Erro de provider em texto legível. Meta e Evolution devolvem o motivo em formatos
 * diferentes (string, array de strings, objeto aninhado) — sem isto, um erro estruturado
 * virava "[object Object]" no chat e no log, que não ajuda ninguém a resolver nada.
 */
export function describeProviderError(raw: unknown, fallback: string): string {
  const text = flatten(raw);
  return text || fallback;
}

function flatten(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth > 3) return '';
  if (Array.isArray(value)) return value.map((v) => flatten(v, depth + 1)).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    // campos que os providers usam para o texto do erro, do mais específico ao mais genérico
    for (const k of ['message', 'error', 'description', 'detail', 'reason', 'title']) {
      if (k in o) {
        const t = flatten(o[k], depth + 1);
        if (t) return t;
      }
    }
    // último recurso: o JSON, que ao menos é diagnosticável
    try {
      const json = JSON.stringify(o);
      return json === '{}' ? '' : json.slice(0, 300);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Erros da Cloud API que o atendente precisa entender para agir — o texto da Meta vem em inglês
 * e genérico ("Re-engagement message"). Fora daqui, vale o texto original.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const META_ERROR_TEXT: Record<number, string> = {
  190: 'Token da Meta expirado ou inválido. Gere um token permanente do System User e atualize o número.',
  368: 'A Meta bloqueou temporariamente este número por violação de política.',
  131021: 'Não dá para enviar mensagem para o próprio número.',
  131026: 'Mensagem não entregue: o telefone não tem WhatsApp ou não aceitou a mensagem (app desatualizado ou termos não aceitos).',
  131031: 'A conta WhatsApp Business foi bloqueada pela Meta.',
  131042: 'Problema de pagamento na conta WhatsApp Business. Confira a forma de pagamento no Gerenciador de Negócios.',
  131047: 'O contato não escreve há mais de 24 horas: na API oficial, só sai template aprovado.',
  131049: 'A Meta não entregou esta mensagem de marketing para preservar o engajamento do contato. Tente mais tarde.',
  131050: 'O contato optou por não receber mensagens de marketing.',
  131051: 'Tipo de mensagem não suportado pela Meta.',
  131053: 'A Meta não conseguiu processar a mídia (formato ou tamanho não aceitos).',
  132000: 'O número de variáveis não confere com o template aprovado.',
  132001: 'O template não existe neste idioma (ou ainda não foi aprovado).',
  132005: 'O texto do template ficou grande demais depois de preencher as variáveis.',
  132007: 'O conteúdo do template viola a política da Meta.',
  132012: 'Variável do template em formato inválido.',
  132015: 'O template foi pausado pela Meta por baixa qualidade.',
  132016: 'O template foi desativado pela Meta por baixa qualidade.',
  133010: 'O número ainda não está registrado na Cloud API. Registre-o no Gerenciador do WhatsApp (ou pela API /register).',
};

/** Texto do erro da Meta: o nosso, em português, quando o código é conhecido; senão o da API. */
export function describeMetaError(error: { code?: unknown; message?: unknown; title?: unknown; error_data?: { details?: unknown } } | undefined, fallback: string): string {
  const code = typeof error?.code === 'number' ? error.code : Number(error?.code);
  if (Number.isFinite(code) && META_ERROR_TEXT[code]) return META_ERROR_TEXT[code];
  return describeProviderError(error?.error_data?.details ?? error, fallback);
}

/**
 * Erro HTTP do provider, com o status (e o código da Meta, quando há) para a fila decidir se
 * vale tentar de novo. Continua sendo 400 para quem chama pela API (conectar, reagir…).
 */
export class ProviderSendError extends BadRequestException {
  constructor(message: string, readonly providerStatus: number, readonly providerCode?: number) {
    super(message);
  }
}

/**
 * O provider não respondeu no prazo. Ambíguo: a operação pode ter sido feita (no envio, a
 * mensagem pode ter saído). Nunca é transitório — repetir um envio assim duplica a mensagem
 * para o contato. 504 para quem chama pela API.
 */
export class ProviderTimeoutError extends GatewayTimeoutException {
  readonly ambiguous = true;
}

/**
 * Códigos da Meta que são temporários mesmo vindo com HTTP 400: limite de taxa
 * (4, 80007, 130429, 131048, 131056) e indisponibilidade (1, 2, 131000, 131016, 133004).
 */
const META_TRANSIENT_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

/**
 * Transitório = tentar de novo pode dar certo (rede, timeout, 5xx, 429, sessão caiu).
 * Permanente = repetir dá o mesmo erro (número inválido, mídia recusada, tipo não suportado,
 * credencial errada) — a mensagem vira falha na hora, sem gastar tentativas.
 */
export function isTransientSendError(err: unknown): boolean {
  // sem resposta no prazo: pode ter saído — repetir duplicaria
  if (err instanceof ProviderTimeoutError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (/connection closed|timed? ?out|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(msg)) return true;
  if (err instanceof ProviderSendError) {
    if (err.providerCode !== undefined && META_TRANSIENT_CODES.has(err.providerCode)) return true;
    const s = err.providerStatus;
    return s === 408 || s === 425 || s === 429 || s >= 500;
  }
  // validação nossa ou do provider sem status HTTP (ex.: "Tipo não suportado")
  if (err instanceof HttpException) return false;
  // fetch falhou, JSON inválido de um 502, storage fora do ar…: problema de infraestrutura
  return true;
}

/**
 * Espera antes da tentativa `attempt` (1 = primeiro retry): exponencial a partir de `baseMs`,
 * com até `jitter` (fração) de variação para os retries de vários jobs não saírem juntos.
 */
export function retryDelayMs(attempt: number, opts: { baseDelayMs: number; maxDelayMs: number; jitter: number }, random: () => number = Math.random) {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const spread = exp * opts.jitter;
  return Math.max(0, Math.round(exp - spread + random() * spread * 2));
}
