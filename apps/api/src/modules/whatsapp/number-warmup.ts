/**
 * Aquecimento da sessão (docs/envio.md#aquecimento): número recém-pareado (QR lido) com volume
 * alto logo de cara é o padrão que derrubou a Drogaria Total — duas quedas no primeiro dia,
 * com tráfego saudável. Nas primeiras 72h o número conversa com poucos contatos NOVOS por hora;
 * quem já está na conversa naquela hora continua sendo respondido sem trava.
 *
 * Só no não oficial. Fases contadas desde `sessionStartedAt`.
 */
const HORA = 3_600_000;

export interface WarmupPhase {
  /** 1, 2 ou 3 */
  phase: number;
  /** contatos diferentes por hora (janela deslizante) */
  newConvPerHour: number;
  /** piso entre dois envios do número, de qualquer origem; 0 = sem piso extra */
  minGapMs: number;
  endsAt: Date;
}

const FASES: { ateHoras: number; newConvPerHour: number; minGapMs: number }[] = [
  { ateHoras: 24, newConvPerHour: 20, minGapMs: 8_000 },
  { ateHoras: 48, newConvPerHour: 50, minGapMs: 0 },
  { ateHoras: 72, newConvPerHour: 80, minGapMs: 0 },
];
export const WARMUP_TOTAL_HOURS = 72;

export function warmupPhase(n: { provider: string; sessionStartedAt: Date | null }, now = new Date()): WarmupPhase | null {
  if (n.provider === 'meta' || !n.sessionStartedAt) return null;
  const horas = (now.getTime() - n.sessionStartedAt.getTime()) / HORA;
  if (horas < 0) return null;
  const i = FASES.findIndex((f) => horas < f.ateHoras);
  if (i < 0) return null;
  const f = FASES[i];
  return { phase: i + 1, newConvPerHour: f.newConvPerHour, minGapMs: f.minGapMs, endsAt: new Date(n.sessionStartedAt.getTime() + f.ateHoras * HORA) };
}

/** "Digitando…" antes do automático: 40 ms por caractere, entre 2 e 7 s. */
export function typingMs(textLength: number) {
  return Math.min(7_000, Math.max(2_000, Math.round(textLength * 40)));
}
