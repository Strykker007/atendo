import { partsIn } from '../../common/time';

export interface BusinessInterval {
  /** 0 = domingo */
  weekday: number;
  /** "HH:MM" no fuso do tenant */
  start: string;
  end: string;
}

export const WEEKDAY_LABEL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

const toMinutes = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/**
 * O cliente está dentro do expediente?
 *
 * Regras: sem nenhum intervalo cadastrado, considera-se **sempre aberto** (cliente que não
 * configurou não pode ficar com o atendimento travado). `attendanceActive: false` fecha
 * tudo, independente do horário — é o botão de feriado/férias.
 */
export function isOpenAt(input: { now: Date; timezone: string; hours: BusinessInterval[]; attendanceActive?: boolean }): boolean {
  if (input.attendanceActive === false) return false;
  if (!input.hours.length) return true;
  const p = partsIn(input.now, input.timezone);
  const minutes = p.hh * 60 + p.mm;
  return input.hours.some((h) => {
    if (h.weekday !== p.weekday) return false;
    const start = toMinutes(h.start);
    const end = toMinutes(h.end);
    // intervalo que vira a meia-noite (ex.: 18:00–02:00) conta até o fim do dia
    return end > start ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  });
}

/** Expediente padrão sugerido ao cliente que ainda não configurou: seg–sex, 8h–18h. */
export const DEFAULT_HOURS: BusinessInterval[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '08:00', end: '18:00' }));

/**
 * Primeiro instante, a partir de `from`, em que o cliente está aberto. Usado pelo Atraso
 * inteligente: o prazo que vence às 23h de sexta só segue na segunda de manhã.
 *
 * Anda de 5 em 5 minutos (o expediente é cadastrado em HH:MM) por até 8 dias. Sem
 * expediente cadastrado é sempre aberto; com "atendimento ativo" desligado nunca abre — aí
 * devolve `from`, porque prender o contato num atraso sem fim é pior do que seguir o fluxo.
 */
export function nextOpenAt(input: { from: Date; timezone: string; hours: BusinessInterval[]; attendanceActive?: boolean }): Date {
  const open = (now: Date) => isOpenAt({ now, timezone: input.timezone, hours: input.hours, attendanceActive: input.attendanceActive });
  if (input.attendanceActive === false || open(input.from)) return input.from;
  const step = 5 * 60_000;
  // alinha no múltiplo de 5 min seguinte: a abertura é sempre num HH:MM redondo
  const start = Math.ceil(input.from.getTime() / step) * step;
  for (let t = start, end = input.from.getTime() + 8 * 86_400_000; t <= end; t += step) {
    if (open(new Date(t))) return new Date(t);
  }
  return input.from;
}
