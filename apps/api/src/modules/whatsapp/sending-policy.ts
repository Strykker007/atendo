/**
 * Proteção contra bloqueio/banimento do número. Lógica pura — o estado (último envio,
 * contador do dia) fica no Redis, aplicado pelo OutboundProcessor.
 *
 * O WhatsApp pune padrão de robô: rajada de mensagens, sempre no mesmo intervalo, e volume
 * alto num número recém-conectado. As três defesas aqui são exatamente contra isso.
 */

export type SendDelayProfile = 'instant' | 'fast' | 'short' | 'moderate' | 'medium' | 'long';

/** Faixas em segundos. O intervalo real é sorteado dentro da faixa a cada envio. */
export const DELAY_RANGES: Record<SendDelayProfile, [number, number]> = {
  instant: [0, 0], // só para a API oficial, que não bane por ritmo
  fast: [1, 2],
  short: [3, 4],
  moderate: [3, 5], // 3000–5000ms
  medium: [25, 60],
  long: [60, 250],
};

export const DELAY_LABEL: Record<SendDelayProfile, string> = {
  instant: 'Imediato (só API oficial)',
  fast: 'Rápido (1–2s)',
  short: 'Curto (3–4s)',
  moderate: 'Moderado (3–5s)',
  medium: 'Médio (25–60s)',
  long: 'Longo (60–250s)',
};

/**
 * Intervalo padrão de um número: a oficial não bane por ritmo (imediato); a não oficial sai no
 * Rápido. Antes o padrão era 7–25s para todos — com vários atendentes no mesmo número
 * a fila virava minutos de espera.
 */
export function defaultSendDelay(provider: string): SendDelayProfile {
  return provider === 'meta' ? 'instant' : 'fast';
}

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

export function dailyLimit(input: { configured: number; warmupStartedAt?: Date | null; provider?: string; now?: Date }): number {
  const configured = Math.max(0, input.configured);
  // a API oficial não bane por volume (a Meta tem os próprios limites de conversa): sem aquecimento
  if (!input.warmupStartedAt || input.provider === 'meta') return configured;
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

/** Mesma janela da Meta: o contato escreveu nas últimas 24h, então o envio é resposta. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * O envio conta para o teto do dia / aquecimento? Só o **proativo** (campanha, primeiro
 * contato, conversa parada há mais de 24h). Responder quem acabou de escrever é o uso normal
 * de qualquer número — barrar isso travava o atendimento de número novo em 20 respostas no dia.
 */
export function countsTowardDailyLimit(lastInboundAt: Date | null | undefined, now = Date.now()): boolean {
  return !lastInboundAt || now - lastInboundAt.getTime() >= REPLY_WINDOW_MS;
}

/** O envio cabe no teto do dia? `limit` 0 = sem teto. */
export function withinDailyLimit(sentToday: number, limit: number): SendDecision {
  if (limit > 0 && sentToday >= limit) {
    return { ok: false, reason: `Limite de ${limit} envios por dia deste número foi atingido. Ele volta a enviar amanhã.` };
  }
  return { ok: true };
}
