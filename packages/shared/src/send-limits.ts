/**
 * Controle de envio — valores padrão centralizados (docs/envio.md).
 *
 * Tudo que sai para o WhatsApp passa pela fila `wa-outbound`, que aplica estes limites.
 * Os limites por conexão podem ser trocados no cartão do número (`WhatsAppNumber.sendLimits`);
 * o que não for configurado cai no padrão do provider. Evolution é mais conservador que a
 * Meta porque é o QR que bane por ritmo.
 */

export type SendProvider = 'meta' | 'evolution';

export interface SendLimits {
  /** máximo de envios por minuto neste número (janela deslizante de 60 s) */
  ratePerMinute: number;
  /** intervalo mínimo entre duas mensagens seguidas na mesma conversa, em segundos */
  convMinIntervalSec: number;
  /** rajada: no máximo `convBurstMax` mensagens por conversa a cada `convBurstWindowSec` */
  convBurstMax: number;
  convBurstWindowSec: number;
  /** mensagem que ficou na fila mais que isso (ex.: número desconectado) expira como falha */
  maxQueueAgeMin: number;
  /** envio AUTOMÁTICO (fluxo, boas-vindas, lembrete…) por hora no número; resposta do atendente não conta */
  autoPerHour: number;
}

export const SEND_LIMIT_DEFAULTS: Record<SendProvider, SendLimits> = {
  evolution: { ratePerMinute: 40, convMinIntervalSec: 1, convBurstMax: 6, convBurstWindowSec: 30, maxQueueAgeMin: 30, autoPerHour: 80 },
  meta: { ratePerMinute: 80, convMinIntervalSec: 1, convBurstMax: 10, convBurstWindowSec: 30, maxQueueAgeMin: 30, autoPerHour: 5000 },
};

/** Faixas aceitas na configuração (API valida, tela usa como min/max dos campos). */
export const SEND_LIMIT_RANGES: Record<keyof SendLimits, [number, number]> = {
  ratePerMinute: [1, 600],
  convMinIntervalSec: [0, 60],
  convBurstMax: [1, 100],
  convBurstWindowSec: [5, 600],
  maxQueueAgeMin: [1, 1440],
  autoPerHour: [1, 5000],
};

export const SEND_LIMIT_LABEL: Record<keyof SendLimits, string> = {
  ratePerMinute: 'Máximo por minuto (número)',
  convMinIntervalSec: 'Intervalo mínimo na conversa (s)',
  convBurstMax: 'Rajada: mensagens por conversa',
  convBurstWindowSec: 'Rajada: janela (s)',
  maxQueueAgeMin: 'Expirar na fila após (min)',
  autoPerHour: 'Automáticas por hora (número)',
};

/**
 * Espaçamento do envio AUTOMÁTICO no QR (docs/envio.md#envio-automático): sorteado a
 * cada mensagem, conta do último envio do número (de qualquer origem). Resposta do atendente não
 * espera isto — só o perfil do número.
 */
export const AUTO_GAP_MS: [number, number] = [4_000, 10_000];

/** Padrão do provider + o que a conexão sobrescreveu. Valor fora da faixa é ignorado. */
export function resolveSendLimits(provider: SendProvider, overrides?: Partial<SendLimits> | null): SendLimits {
  const out = { ...(SEND_LIMIT_DEFAULTS[provider] ?? SEND_LIMIT_DEFAULTS.evolution) };
  if (!overrides) return out;
  for (const k of Object.keys(SEND_LIMIT_RANGES) as (keyof SendLimits)[]) {
    const v = overrides[k];
    const [min, max] = SEND_LIMIT_RANGES[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) out[k] = v;
  }
  return out;
}

/** Retry do envio: só erro transitório, backoff exponencial com variação aleatória. */
export const SEND_RETRY = { attempts: 5, baseDelayMs: 3_000, maxDelayMs: 120_000, jitter: 0.5 };

/**
 * Velocidade de digitação de cada atendente — o "digitando…" simulado das mensagens que ele não
 * digitou de verdade (resposta rápida, texto colado, encaminhada, agendada). Caracteres por
 * segundo, sorteado dentro da faixa a cada mensagem. Mensagem automática (fluxo, boas-vindas)
 * usa `normal`.
 */
export const TYPING_SPEEDS = {
  slow: { label: 'Devagar', cps: [2, 3.5] },
  normal: { label: 'Normal', cps: [3.5, 6] },
  fast: { label: 'Rápido', cps: [6, 9] },
} as const;
export type TypingSpeed = keyof typeof TYPING_SPEEDS;
export const TYPING_SPEED_KEYS = Object.keys(TYPING_SPEEDS) as TypingSpeed[];

/** Teto do "digitando…" simulado: texto longo não segura a mensagem mais que isso. */
export const TYPING_MAX_MS = 10_000;

/**
 * Número QR pode falar primeiro com até N contatos frios (sem mensagem dele nas últimas
 * 24 h) por dia — janela deslizante de 24 h, só envio do atendente. Ver docs/envio.md#envio-frio.
 */
export const COLD_CONTACTS_PER_DAY = 10;
