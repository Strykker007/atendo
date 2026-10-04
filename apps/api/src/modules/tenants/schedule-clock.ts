import {
  addOpenMinutesLocal,
  describeNextOpen,
  minutesToHm,
  nextOpenLocal,
  normalizeLocal,
  resolveSchedule,
  type LocalTime,
  type ScheduleConfig,
  type ScheduleState,
} from '@atendo/shared';
import { localToUtc, partsIn } from '../../common/time';

/**
 * Ponte entre o quadro de horários (puro, em hora local — `packages/shared/schedule.ts`) e
 * instantes reais: converte no fuso do quadro. Isolado (sem Nest/Prisma) para testar fuso e
 * virada de dia sem banco.
 */
export interface ScheduleSource {
  timezone: string;
  config: ScheduleConfig;
  /** chave "atendimento ativo" de Configurações: desligada = Fechado */
  attendanceActive: boolean;
  /** quando a chave mudou (cada desligamento é um período próprio) */
  attendanceChangedAt?: Date | null;
}

/**
 * Cliente sem quadro cadastrado: sempre aberto (como era "sem expediente cadastrado"), Fechado
 * sem resposta — só vale com "atendimento ativo" desligado.
 */
export const ALWAYS_OPEN: ScheduleConfig = {
  bands: [{ id: 'open', name: 'Aberto', open: true, behavior: 'normal', reply: 'message', items: [] }],
  closed: { behavior: 'normal', reply: 'message', items: [] },
  week: [0, 1, 2, 3, 4, 5, 6].map((d) => [{ id: `a${d}`, start: '00:00', end: '00:00', bandId: 'open' }]),
  exceptions: [],
};

export function localOf(date: Date, timezone: string): LocalTime {
  const p = partsIn(date, timezone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { ymd: `${p.y}-${pad(p.m)}-${pad(p.d)}`, minute: p.hh * 60 + p.mm };
}

export function instantOf(t: LocalTime, timezone: string): Date {
  const n = normalizeLocal(t);
  return localToUtc(n.ymd, minutesToHm(n.minute), timezone);
}

export interface ScheduleNow extends ScheduleState {
  local: LocalTime;
  /** próxima abertura (agora, se já estiver aberto); null = não abre nos próximos 14 dias ou atendimento desligado */
  nextOpen: Date | null;
  /** "hoje às 14:00", "amanhã às 08:00"… — variável `{{proxima_abertura}}` */
  nextOpenLabel: string;
}

export function scheduleAt(src: ScheduleSource, at: Date): ScheduleNow {
  const local = localOf(at, src.timezone);
  const state = resolveSchedule(src.config, local, { attendanceActive: src.attendanceActive, inactiveSince: src.attendanceChangedAt?.toISOString() });
  const next = src.attendanceActive ? nextOpenLocal(src.config, local) : null;
  return { ...state, local, nextOpen: next ? instantOf(next, src.timezone) : null, nextOpenLabel: describeNextOpen(local, next) };
}

/**
 * Primeiro instante em horário de atendimento a partir de `from`. Atendimento desligado ou
 * horário que não abre em 14 dias devolvem `from`: prender o contato num atraso sem fim é pior
 * do que seguir o fluxo (mesma regra do antigo `nextOpenAt`).
 */
export function nextOpenFrom(src: ScheduleSource, from: Date): Date {
  if (!src.attendanceActive) return from;
  const local = localOf(from, src.timezone);
  const next = nextOpenLocal(src.config, local);
  // já aberto (ou não abre em 14 dias) = o próprio `from`
  if (!next || (next.ymd === local.ymd && next.minute === local.minute)) return from;
  return instantOf(next, src.timezone);
}

/**
 * `from` + `minutes` contando só o tempo em horário de atendimento (tempo limite do Salvar/Menu).
 * Atendimento desligado ou horário que nunca abre: conta o tempo corrido (não prende a espera).
 */
export function addOpenMinutes(src: ScheduleSource, from: Date, minutes: number): Date {
  const plain = new Date(from.getTime() + minutes * 60_000);
  if (!src.attendanceActive) return plain;
  const end = addOpenMinutesLocal(src.config, localOf(from, src.timezone), minutes);
  if (!end) return plain;
  const at = instantOf(end, src.timezone);
  return at.getTime() < from.getTime() ? plain : at;
}
