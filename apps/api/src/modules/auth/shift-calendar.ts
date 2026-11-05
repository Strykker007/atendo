/**
 * Turnos planejados dia a dia: a regra da escala (shift-window.ts) mais as EXCEÇÕES de um dia
 * (docs/escalas.md#calendário): folga (`off` tira o turno que a regra daria naquele dia) e turno
 * extra (`extra` põe um turno com horário próprio). Troca de turno entre colegas = folga de um +
 * extra do outro. Puro e testado: é o que a trava de login usa quando a pessoa tem exceção.
 *
 * Tudo em minutos locais absolutos (dia × 1440 + minuto), como em shift-window.ts.
 */
import { dayIndex, hmToMinutes, isCyclic, shiftDuration, type LocalMoment, type ShiftRule, type ShiftSpan } from './shift-window';

export type ShiftExceptionKind = 'off' | 'extra';

export interface DayException {
  id?: string;
  /** "AAAA-MM-DD": dia em que o turno COMEÇA */
  date: string;
  kind: ShiftExceptionKind;
  /** só no `extra` */
  startTime?: string | null;
  endTime?: string | null;
}

export interface PlannedShift {
  /** dia em que começa (dias desde 1970-01-01) */
  day: number;
  /** início em minutos locais absolutos */
  start: number;
  /** minutos de turno (sem tolerâncias) */
  duration: number;
  source: 'rule' | 'extra';
  exceptionId?: string;
}

const DAY = 1440;
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Inícios dos turnos da REGRA que começam entre `fromDay` e `toDay` (inclusive). */
export function ruleStarts(rule: ShiftRule, fromDay: number, toDay: number): number[] {
  const start = hmToMinutes(rule.startTime);
  const out: number[] = [];
  if (isCyclic(rule)) {
    if (!rule.anchorDate) return out;
    const cycle = shiftDuration(rule) + rule.restHours * 60;
    const anchor = dayIndex(rule.anchorDate) * DAY + start;
    const from = fromDay * DAY;
    // primeiro início >= meia-noite de fromDay
    let s = anchor + Math.ceil((from - anchor) / cycle) * cycle;
    for (; s < (toDay + 1) * DAY; s += cycle) out.push(s);
    return out;
  }
  for (let day = fromDay; day <= toDay; day++) if (rule.workDays.includes(mod(day + 4, 7))) out.push(day * DAY + start);
  return out;
}

/** Turnos planejados (regra − folgas + extras) que começam entre `fromDay` e `toDay`, em ordem. */
export function plannedShifts(rule: ShiftRule | null, exceptions: DayException[], fromDay: number, toDay: number): PlannedShift[] {
  const folga = new Set(exceptions.filter((e) => e.kind === 'off').map((e) => dayIndex(e.date)));
  const out: PlannedShift[] = [];
  if (rule) {
    const duration = shiftDuration(rule);
    for (const s of ruleStarts(rule, fromDay, toDay)) {
      const day = Math.floor(s / DAY);
      if (!folga.has(day)) out.push({ day, start: s, duration, source: 'rule' });
    }
  }
  for (const e of exceptions) {
    if (e.kind !== 'extra' || !e.startTime || !e.endTime) continue;
    const day = dayIndex(e.date);
    if (day < fromDay || day > toDay) continue;
    out.push({ day, start: day * DAY + hmToMinutes(e.startTime), duration: shiftDuration({ startTime: e.startTime, endTime: e.endTime }), source: 'extra', exceptionId: e.id });
  }
  return out.sort((a, b) => a.start - b.start);
}

const toSpan = (p: PlannedShift, grace: number): ShiftSpan =>
  grace ? { start: p.start, end: p.start + p.duration + grace, graceFrom: p.start + p.duration } : { start: p.start, end: p.start + p.duration };

/**
 * `currentShift` com exceções: o turno valendo agora (com a tolerância de entrada da escala; o
 * extra usa as mesmas tolerâncias) ou null. Sem escala (`rule` null) só vale o extra, com
 * tolerâncias padrão (15 min de entrada, 0 de saída).
 */
export function currentPlannedShift(rule: ShiftRule | null, exceptions: DayException[], now: LocalMoment): ShiftSpan | null {
  const tol = Math.max(0, rule?.toleranceMinutes ?? 15);
  const grace = Math.max(0, rule?.exitGraceMinutes ?? 0);
  const today = dayIndex(now.ymd);
  const t = today * DAY + now.minute;
  // turno de ontem pode avançar madrugada adentro; a tolerância pode puxar o de amanhã
  for (const p of plannedShifts(rule, exceptions, today - 1, today + 1)) {
    if (t >= p.start - tol && t < p.start + p.duration + grace) return toSpan(p, grace);
  }
  return null;
}

/** `lastShift` com exceções: o último turno planejado que já terminou (até 9 dias para trás). */
export function lastPlannedShift(rule: ShiftRule | null, exceptions: DayException[], now: LocalMoment): ShiftSpan | null {
  const grace = Math.max(0, rule?.exitGraceMinutes ?? 0);
  const today = dayIndex(now.ymd);
  const t = today * DAY + now.minute;
  const ended = plannedShifts(rule, exceptions, today - 9, today).filter((p) => p.start + p.duration + grace <= t);
  const last = ended[ended.length - 1];
  return last ? toSpan(last, grace) : null;
}

/** Está no turno agora (fim exato, sem a tolerância de saída)? Para "quem está no turno". */
export function isWithinPlannedShift(rule: ShiftRule | null, exceptions: DayException[], now: LocalMoment): boolean {
  const tol = Math.max(0, rule?.toleranceMinutes ?? 15);
  const today = dayIndex(now.ymd);
  const t = today * DAY + now.minute;
  return plannedShifts(rule, exceptions, today - 1, today + 1).some((p) => t >= p.start - tol && t < p.start + p.duration);
}
