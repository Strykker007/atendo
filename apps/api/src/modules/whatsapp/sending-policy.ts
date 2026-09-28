/**
 * Proteção contra bloqueio/banimento do número. Lógica pura — o estado (último envio,
 * contador do dia) fica no Redis, aplicado pelo OutboundProcessor.
 *
 * O WhatsApp pune padrão de robô: rajada de mensagens, sempre no mesmo intervalo, e volume
 * alto num número recém-conectado. As três defesas aqui são exatamente contra isso.
 */

export type SendDelayProfile = 'instant' | 'fast' | 'short' | 'medium' | 'long';

/** Faixas em segundos. O intervalo real é sorteado dentro da faixa a cada envio. */
export const DELAY_RANGES: Record<SendDelayProfile, [number, number]> = {
  instant: [0, 0], // só para a API oficial, que não bane por ritmo
  fast: [1, 7],
  short: [7, 25],
  medium: [25, 60],
  long: [60, 250],
};

export const DELAY_LABEL: Record<SendDelayProfile, string> = {
  instant: 'Imediato (só API oficial)',
  fast: 'Rápido (1–7s)',
  short: 'Curto (7–25s)',
  medium: 'Médio (25–60s)',
  long: 'Longo (60–250s)',
};

/**
 * Intervalo até o próximo envio, em ms. **Sempre aleatório dentro da faixa**: intervalo
 * fixo é assinatura de robô e é justamente o que se quer evitar.
 */
export function delayMs(profile: SendDelayProfile, random: () => number = Math.random) {
  const [min, max] = DELAY_RANGES[profile] ?? DELAY_RANGES.short;
  if (max === 0) return 0;
  return Math.round((min + random() * (max - min)) * 1000);
}

/** Dias inteiros desde o início do aquecimento (o dia da conexão é o dia 1). */
export function warmupDay(startedAt: Date, now: Date) {
  return Math.floor((now.getTime() - startedAt.getTime()) / 86_400_000) + 1;
}

/**
 * Teto de envios do dia. Número recém-conectado começa baixo e dobra a cada dia até
 * alcançar o teto configurado — mandar 1.000 mensagens no primeiro dia de um número novo
 * é o caminho mais rápido para o banimento.
 */
export const WARMUP_DAY1 = 20;
export const WARMUP_DAYS = 7;

export function dailyLimit(input: { configured: number; warmupStartedAt?: Date | null; now?: Date }): number {
  const configured = Math.max(0, input.configured);
  if (!input.warmupStartedAt) return configured;
  const day = warmupDay(input.warmupStartedAt, input.now ?? new Date());
  if (day > WARMUP_DAYS) return configured;
  const ramp = WARMUP_DAY1 * 2 ** Math.max(0, day - 1);
  // sem teto configurado (0) o aquecimento ainda vale — é o período mais arriscado
  return configured === 0 ? ramp : Math.min(configured, ramp);
}

export interface SendDecision {
  ok: boolean;
  reason?: string;
  /** quanto esperar antes de entregar ao provider */
  waitMs?: number;
}

/** O envio cabe no teto do dia? `limit` 0 = sem teto. */
export function withinDailyLimit(sentToday: number, limit: number): SendDecision {
  if (limit > 0 && sentToday >= limit) {
    return { ok: false, reason: `Limite de ${limit} envios por dia deste número foi atingido. Ele volta a enviar amanhã.` };
  }
  return { ok: true };
}
