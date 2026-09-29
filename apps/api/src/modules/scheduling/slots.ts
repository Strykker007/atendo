import { localToUtc, toLocal } from '../../common/time';

export interface Slot {
  startAt: Date;
  endAt: Date;
  label: string;
}

export interface ComputeSlotsInput {
  tz: string;
  /** intervalos de trabalho do profissional (weekday 0=domingo, "HH:MM") */
  hours: { weekday: number; start: string; end: string }[];
  /** agendamentos que ocupam a agenda (já filtrados por profissional e status) */
  busy: { startAt: Date; endAt: Date }[];
  durationMin: number;
  slotMinutes: number;
  from: Date;
  days: number;
  limit: number;
  /** "agora" — parametrizado para teste */
  now?: Date;
}

/**
 * Horários livres, puro (sem banco). Regra: dentro dos intervalos de trabalho do dia,
 * passo = slotMinutes, a duração do serviço cabe até o fim do intervalo, não colide com
 * agendamento existente e nunca é no passado.
 */
export function computeSlots(i: ComputeSlotsInput): Slot[] {
  const slots: Slot[] = [];
  const notBefore = new Date(Math.max(i.from.getTime(), (i.now ?? new Date()).getTime()));
  const durMs = i.durationMin * 60_000;
  const stepMs = i.slotMinutes * 60_000;
  // percorre dia a dia no fuso do tenant
  for (let dayOffset = 0; dayOffset <= i.days && slots.length < i.limit; dayOffset++) {
    const dayRef = new Date(i.from.getTime() + dayOffset * 86_400_000);
    const { ymd, weekday } = toLocal(dayRef, i.tz);
    for (const h of i.hours.filter((x) => x.weekday === weekday)) {
      let cursor = localToUtc(ymd, h.start, i.tz);
      const end = localToUtc(ymd, h.end, i.tz);
      while (cursor.getTime() + durMs <= end.getTime() && slots.length < i.limit) {
        const s = cursor;
        const e = new Date(cursor.getTime() + durMs);
        const collides = i.busy.some((b) => b.startAt < e && b.endAt > s);
        if (s > notBefore && !collides) slots.push({ startAt: s, endAt: e, label: toLocal(s, i.tz).label });
        cursor = new Date(cursor.getTime() + stepMs);
      }
    }
  }
  return slots;
}
