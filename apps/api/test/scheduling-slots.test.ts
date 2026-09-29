import { describe, expect, it } from 'vitest';
import { computeSlots, type ComputeSlotsInput } from '../src/modules/scheduling/slots';
import { TZ_DEFAULT } from '../src/common/time';

// Terça, 22/09/2026. "Agora" é bem antes do expediente para não cortar horários sem querer.
const NOW = new Date('2026-09-22T09:00:00Z'); // 06:00 em São Paulo
const COMERCIAL = [{ weekday: 2, start: '09:00', end: '12:00' }]; // só terça, 09:00–12:00

function slots(over: Partial<ComputeSlotsInput> = {}) {
  return computeSlots({
    tz: TZ_DEFAULT,
    hours: COMERCIAL,
    busy: [],
    durationMin: 30,
    slotMinutes: 30,
    from: NOW,
    days: 0,
    limit: 100,
    now: NOW,
    ...over,
  });
}
const horas = (s: { label: string }[]) => s.map((x) => x.label.slice(-5));

describe('computeSlots', () => {
  it('gera os horários do expediente no passo configurado', () => {
    expect(horas(slots())).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('não oferece horário que não cabe até o fim do expediente', () => {
    // serviço de 45 min: 11:30 + 45 passaria das 12:00
    expect(horas(slots({ durationMin: 45 }))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('o passo é independente da duração do serviço', () => {
    expect(horas(slots({ durationMin: 60, slotMinutes: 15 }))).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00']);
  });

  it('não oferece horário ocupado', () => {
    const busy = [{ startAt: new Date('2026-09-22T13:00:00Z'), endAt: new Date('2026-09-22T13:30:00Z') }]; // 10:00–10:30 local
    expect(horas(slots({ busy }))).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
  });

  it('bloqueia todo horário que encoste no agendamento existente', () => {
    // 10:00–11:00 ocupado com serviço de 30 min derruba 10:00 e 10:30
    const busy = [{ startAt: new Date('2026-09-22T13:00:00Z'), endAt: new Date('2026-09-22T14:00:00Z') }];
    expect(horas(slots({ busy }))).toEqual(['09:00', '09:30', '11:00', '11:30']);
  });

  it('serviço longo colide com agendamento que começa durante ele', () => {
    // ocupado 11:00–11:30; serviço de 60 min não pode começar 10:30 (terminaria 11:30),
    // mas pode começar 10:00 (termina exatamente quando o outro começa)
    const busy = [{ startAt: new Date('2026-09-22T14:00:00Z'), endAt: new Date('2026-09-22T14:30:00Z') }];
    expect(horas(slots({ durationMin: 60, busy }))).toEqual(['09:00', '09:30', '10:00']);
  });

  it('agendamento que encosta sem sobrepor não bloqueia (10:00 termina quando 10:30 começa)', () => {
    const busy = [{ startAt: new Date('2026-09-22T12:30:00Z'), endAt: new Date('2026-09-22T13:00:00Z') }]; // 09:30–10:00
    expect(horas(slots({ busy }))).toContain('10:00');
  });

  it('nunca oferece horário no passado', () => {
    const agora = new Date('2026-09-22T13:20:00Z'); // 10:20 local
    expect(horas(slots({ now: agora, from: NOW }))).toEqual(['10:30', '11:00', '11:30']);
  });

  it('atende vários intervalos no mesmo dia (almoço no meio)', () => {
    const hours = [
      { weekday: 2, start: '09:00', end: '11:00' },
      { weekday: 2, start: '13:00', end: '15:00' },
    ];
    expect(horas(slots({ hours }))).toEqual(['09:00', '09:30', '10:00', '10:30', '13:00', '13:30', '14:00', '14:30']);
  });

  it('só gera horários nos dias em que o profissional trabalha', () => {
    const hours = [{ weekday: 4, start: '09:00', end: '10:00' }]; // só quinta
    expect(slots({ days: 7 }).length).toBeGreaterThan(0); // controle: terça tem expediente
    const s = slots({ hours, days: 7 });
    expect(s.every((x) => x.label.startsWith('qui.'))).toBe(true);
    expect(horas(s)).toEqual(['09:00', '09:30']); // só a quinta 24/09 cai na janela de 7 dias
  });

  it('profissional sem horário cadastrado não tem disponibilidade', () => {
    expect(slots({ hours: [] })).toEqual([]);
  });

  it('respeita o limite pedido (é o que alimenta o menu do WhatsApp)', () => {
    expect(slots({ days: 30, limit: 6 })).toHaveLength(6);
  });

  it('startAt e endAt fecham com a duração do serviço', () => {
    const [s] = slots({ durationMin: 45 });
    expect(s.endAt.getTime() - s.startAt.getTime()).toBe(45 * 60_000);
    expect(s.startAt.toISOString()).toBe('2026-09-22T12:00:00.000Z');
  });

  it('o rótulo mostrado ao cliente está no fuso do tenant', () => {
    expect(slots()[0].label).toBe('ter. 22/09 09:00');
    // o mesmo expediente num tenant em UTC cai noutro instante: às 09:00Z ("agora") o slot das 09:00 já não vale
    expect(slots({ tz: 'UTC' })[0].label).toBe('ter. 22/09 09:30');
  });
});
