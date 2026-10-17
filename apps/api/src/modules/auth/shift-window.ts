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
