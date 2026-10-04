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
 * Horário avulso de uma regra antiga da Condição (`business_hours` com `hours` próprio, do formato
 * antigo). O expediente do cliente agora é o quadro de horários (`schedules.service.ts`,
 * docs/horarios.md); isto só continua para não mudar o resultado dos fluxos salvos assim.
 *
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
