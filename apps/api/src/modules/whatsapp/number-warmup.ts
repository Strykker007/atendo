import { TYPING_MAX_MS, TYPING_SPEEDS, type TypingSpeed } from '@atendo/shared';

/**
 * Aquecimento da sessão (docs/envio.md#aquecimento): número recém-pareado (QR lido) com volume
 * alto logo de cara é o padrão que derrubou a Drogaria Total — duas quedas no primeiro dia,
 * com tráfego saudável. Na primeira semana o número conversa com poucos contatos NOVOS por hora
 * e o robô (mensagens sem autor) tem teto por hora menor; quem já está na conversa naquela hora
 * continua sendo respondido pelo atendente sem trava. A Drog. Nova Farma foi restrita em 7 h com
 * ~50 automáticas/h (saudação do fluxo em toda conversa) — daí o teto do robô por fase.
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
  /** teto de mensagens automáticas por hora nesta fase (o menor entre este e o da conexão vale) */
  autoPerHour: number;
  endsAt: Date;
}

const FASES: { ateHoras: number; newConvPerHour: number; minGapMs: number; autoPerHour: number }[] = [
  { ateHoras: 24, newConvPerHour: 20, minGapMs: 8_000, autoPerHour: 30 },
  { ateHoras: 48, newConvPerHour: 50, minGapMs: 0, autoPerHour: 50 },
  { ateHoras: 72, newConvPerHour: 80, minGapMs: 0, autoPerHour: 60 },
  // até o 7º dia: contatos novos já folgados, só o robô ainda abaixo do padrão (80/h)
  { ateHoras: 168, newConvPerHour: 120, minGapMs: 0, autoPerHour: 70 },
];
export const WARMUP_TOTAL_HOURS = 168;
export const WARMUP_PHASES = FASES.length;

export function warmupPhase(n: { provider: string; sessionStartedAt: Date | null }, now = new Date()): WarmupPhase | null {
  if (n.provider === 'meta' || !n.sessionStartedAt) return null;
  const horas = (now.getTime() - n.sessionStartedAt.getTime()) / HORA;
  if (horas < 0) return null;
  const i = FASES.findIndex((f) => horas < f.ateHoras);
  if (i < 0) return null;
  const f = FASES[i];
  return { phase: i + 1, newConvPerHour: f.newConvPerHour, minGapMs: f.minGapMs, autoPerHour: f.autoPerHour, endsAt: new Date(n.sessionStartedAt.getTime() + f.ateHoras * HORA) };
}

/**
 * Quanto uma pessoa levaria para mandar este texto (mensagem automática no não oficial):
 * - **reação** — perceber a mensagem e começar a responder: 1,2–3 s, mais um pouco quanto maior a
 *   resposta (pensar no que escrever), até +2 s. Aplicada contando da última mensagem do contato:
 *   na 2ª mensagem seguida do fluxo ela já passou e não soma;
 * - **digitação** — "digitando…" visível na velocidade do atendente (`TYPING_SPEEDS`; `normal` =
 *   3,5 a 6 caracteres por segundo, gente comum no celular), sorteada por mensagem, entre 1,5 e
 *   10 s (`TYPING_MAX_MS`). O teto existe porque a Evolution segura o worker durante o
 *   "digitando" e a mensagem demora a sair: um texto longo de verdade levaria minutos.
 */
export function humanTiming(textLength: number, random: () => number = Math.random, speed: TypingSpeed = 'normal') {
  const reactMs = Math.round(1_200 + random() * 1_800 + Math.min(2_000, textLength * 10));
  const [min, max] = (TYPING_SPEEDS[speed] ?? TYPING_SPEEDS.normal).cps;
  const cps = min + random() * (max - min);
  const typingMs = Math.round(Math.min(TYPING_MAX_MS, Math.max(1_500, (textLength / cps) * 1_000)));
  return { reactMs, typingMs };
}

/** "Gravando…"/"digitando…" de mídia sem texto: 40 ms por caractere, entre 2 e 7 s. */
export function typingMs(textLength: number) {
  return Math.min(7_000, Math.max(2_000, Math.round(textLength * 40)));
}
