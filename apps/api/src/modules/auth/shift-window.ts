/**
 * Janela de turno de uma escala de trabalho (docs/escalas.md). Pura de propósito: é a regra
 * que tranca gente fora do sistema, e virada de dia / ciclo 12x36 precisam ser testáveis sem
 * banco. Trabalha em hora LOCAL (o fuso é convertido antes, em quem chama).
 *
 * Dois jeitos de descrever uma escala:
 *   - **por dias da semana** (comercial 44h, custom sem descanso): o turno começa em `startTime`
 *     nos dias de `workDays`;
 *   - **por ciclo** (12x36, custom com `restHours > 0`): trabalho + descanso se repetem a partir
 *     de `anchorDate`, sem olhar o dia da semana.
 * `endTime <= startTime` = o turno vira a meia-noite (pertence ao dia em que começou).
 * `exitGraceMinutes` = tolerância para sair: a SESSÃO vale até `fim + tolerância` (currentShift /
 * lastShift), mas o turno em si (isWithinShift, quem está no turno) termina no fim exato.
 */

export type WorkScheduleKind = 'FIXED_12X36' | 'COMMERCIAL_44H' | 'CUSTOM';

export interface ShiftRule {
  type: WorkScheduleKind;
  startTime: string;
  endTime: string;
  workDays: number[];
  restHours: number;
  anchorDate: string | null;
  toleranceMinutes: number;
  exitGraceMinutes?: number;
}

/** Instante em hora local: data `AAAA-MM-DD` + minutos desde a meia-noite. */
export interface LocalMoment {
  ymd: string;
  minute: number;
}

const DAY = 1440;
const mod = (a: number, n: number) => ((a % n) + n) % n;

export const hmToMinutes = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

/** Dias desde 1970-01-01 (independe do fuso da máquina). */
export const dayIndex = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** 0 = domingo … 6 = sábado. 1970-01-01 foi quinta-feira. */
export const weekdayOf = (day: number) => mod(day + 4, 7);

/** Duração do turno em minutos; início = fim significa 24h. */
export function shiftDuration(rule: Pick<ShiftRule, 'startTime' | 'endTime'>) {
  const d = mod(hmToMinutes(rule.endTime) - hmToMinutes(rule.startTime), DAY);
  return d === 0 ? DAY : d;
}

const exitGrace = (rule: Pick<ShiftRule, 'exitGraceMinutes'>) => Math.max(0, rule.exitGraceMinutes ?? 0);

/** Escala por ciclo (trabalho + descanso), em vez de dias da semana. */
export const isCyclic = (rule: Pick<ShiftRule, 'type' | 'restHours'>) => rule.type === 'FIXED_12X36' || (rule.type === 'CUSTOM' && rule.restHours > 0);

/**
 * O colaborador está dentro do turno (contando a tolerância antes do início)?
 * O fim é exato: acabou o turno, acabou o acesso.
 */
export function isWithinShift(rule: ShiftRule, now: LocalMoment): boolean {
  const start = hmToMinutes(rule.startTime);
  const duration = shiftDuration(rule);
  const tol = Math.max(0, rule.toleranceMinutes);
  const today = dayIndex(now.ymd);
  const t = today * DAY + now.minute;

  if (isCyclic(rule)) {
    if (!rule.anchorDate) return false;
    const cycle = duration + rule.restHours * 60;
    const anchor = dayIndex(rule.anchorDate) * DAY + start;
    return mod(t - anchor + tol, cycle) < duration + tol;
  }

  // turno de ontem pode avançar madrugada adentro; a tolerância pode puxar o de amanhã
  for (const day of [today - 1, today, today + 1]) {
    if (!rule.workDays.includes(weekdayOf(day))) continue;
    const s = day * DAY + start;
    if (t >= s - tol && t < s + duration) return true;
  }
  return false;
}

/** Turno em minutos locais absolutos (dia × 1440 + minuto), para converter em instante no fuso. */
export interface ShiftSpan {
  start: number;
  /** fim do acesso (já com a tolerância para sair) */
  end: number;
  /** fim real do turno, quando há tolerância para sair: daqui até `end` corre o contador */
  graceFrom?: number;
}

const span = (s: number, duration: number, grace: number): ShiftSpan =>
  grace ? { start: s, end: s + duration + grace, graceFrom: s + duration } : { start: s, end: s + duration };

/**
 * Turno que está valendo agora (contando a tolerância antes do início) — ou null fora dele.
 * É o que dá a hora exata em que a sessão trava (`shiftEndsAt` no token).
 */
export function currentShift(rule: ShiftRule, now: LocalMoment): ShiftSpan | null {
  const start = hmToMinutes(rule.startTime);
  const duration = shiftDuration(rule);
  const tol = Math.max(0, rule.toleranceMinutes);
  const grace = exitGrace(rule);
  const today = dayIndex(now.ymd);
  const t = today * DAY + now.minute;
  if (isCyclic(rule)) {
    if (!rule.anchorDate) return null;
    const cycle = duration + rule.restHours * 60;
    const anchor = dayIndex(rule.anchorDate) * DAY + start;
    const s = anchor + Math.floor((t - anchor + tol) / cycle) * cycle;
    return t >= s - tol && t < s + duration + grace ? span(s, duration, grace) : null;
  }
  for (const day of [today - 1, today, today + 1]) {
    if (!rule.workDays.includes(weekdayOf(day))) continue;
    const s = day * DAY + start;
    if (t >= s - tol && t < s + duration + grace) return span(s, duration, grace);
  }
  return null;
}

/** Último turno que já terminou (até 8 dias para trás); null = nenhum. Define a janela de passagem. */
export function lastShift(rule: ShiftRule, now: LocalMoment): ShiftSpan | null {
  const start = hmToMinutes(rule.startTime);
  const duration = shiftDuration(rule);
  const grace = exitGrace(rule);
  const today = dayIndex(now.ymd);
  const t = today * DAY + now.minute;
  if (isCyclic(rule)) {
    if (!rule.anchorDate) return null;
    const cycle = duration + rule.restHours * 60;
    const anchor = dayIndex(rule.anchorDate) * DAY + start;
    let s = anchor + Math.floor((t - anchor) / cycle) * cycle;
    if (s + duration + grace > t) s -= cycle;
    return span(s, duration, grace);
  }
  for (let day = today; day >= today - 8; day--) {
    if (!rule.workDays.includes(weekdayOf(day))) continue;
    const s = day * DAY + start;
    if (s + duration + grace <= t) return span(s, duration, grace);
  }
  return null;
}

/** Minutos locais absolutos → data `AAAA-MM-DD` + "HH:MM" (para `localToUtc`). */
export function splitLocal(abs: number): { ymd: string; hm: string } {
  const day = Math.floor(abs / DAY);
  const m = mod(abs, DAY);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { ymd: new Date(day * 86_400_000).toISOString().slice(0, 10), hm: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` };
}
