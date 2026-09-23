/**
 * Conversões de fuso para a agenda. Isolado (sem Nest/Prisma) porque é a lógica
 * mais fácil de errar do módulo — horário de verão, virada de dia, dia da semana.
 */

export const TZ_DEFAULT = 'America/Sao_Paulo';

/** Partes de uma data num fuso, independente do fuso da máquina. */
export function partsIn(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), hh: Number(get('hour')) % 24, mm: Number(get('minute')), weekday };
}

/** Offset (ms) do fuso naquele instante: quanto somar ao "relógio local lido como UTC" para obter o instante real. */
export function tzOffsetMs(date: Date, tz: string) {
  const p = partsIn(date, tz);
  return date.getTime() - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, 0);
}

/** Data local (no fuso do tenant) + "HH:MM" → instante UTC. */
export function localToUtc(dateYmd: string, hm: string, tz: string) {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // offset avaliado no próprio instante (lida com horário de verão)
  return new Date(naive + tzOffsetMs(new Date(naive), tz));
}

export const WEEKDAY_PT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

export function toLocal(date: Date, tz: string) {
  const p = partsIn(date, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { ymd: `${p.y}-${pad(p.m)}-${pad(p.d)}`, hm: `${pad(p.hh)}:${pad(p.mm)}`, weekday: p.weekday, label: `${WEEKDAY_PT[p.weekday]} ${pad(p.d)}/${pad(p.m)} ${pad(p.hh)}:${pad(p.mm)}` };
}
