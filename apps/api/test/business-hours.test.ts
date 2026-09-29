import { describe, expect, it } from 'vitest';
import { DEFAULT_HOURS, isOpenAt, type BusinessInterval } from '../src/modules/tenants/business-hours';

const TZ = 'America/Sao_Paulo';
// 2026-09-29 é uma terça-feira
const em = (iso: string) => new Date(iso);
const aberto = (now: Date, hours: BusinessInterval[], attendanceActive?: boolean) => isOpenAt({ now, timezone: TZ, hours, attendanceActive });

const COMERCIAL: BusinessInterval[] = [{ weekday: 2, start: '09:00', end: '18:00' }];

describe('isOpenAt', () => {
  it('dentro do expediente, aberto', () => {
    expect(aberto(em('2026-09-29T13:00:00Z'), COMERCIAL)).toBe(true); // 10:00 local
  });

  it('antes e depois do expediente, fechado', () => {
    expect(aberto(em('2026-09-29T11:00:00Z'), COMERCIAL)).toBe(false); // 08:00
    expect(aberto(em('2026-09-29T22:00:00Z'), COMERCIAL)).toBe(false); // 19:00
  });

  it('as bordas: abre no minuto inicial, fecha no final', () => {
    expect(aberto(em('2026-09-29T12:00:00Z'), COMERCIAL)).toBe(true);  // 09:00 em ponto
    expect(aberto(em('2026-09-29T21:00:00Z'), COMERCIAL)).toBe(false); // 18:00 em ponto
    expect(aberto(em('2026-09-29T20:59:00Z'), COMERCIAL)).toBe(true);  // 17:59
  });

  it('dia sem expediente cadastrado é fechado', () => {
    expect(aberto(em('2026-09-30T13:00:00Z'), COMERCIAL)).toBe(false); // quarta
  });

  it('usa o fuso do tenant, não o da máquina', () => {
    const d = em('2026-09-29T11:30:00Z'); // 08:30 em SP, 11:30 em UTC
    expect(isOpenAt({ now: d, timezone: TZ, hours: COMERCIAL })).toBe(false);
    expect(isOpenAt({ now: d, timezone: 'UTC', hours: COMERCIAL })).toBe(true);
  });

  it('vários intervalos no mesmo dia (almoço fechado)', () => {
    const h: BusinessInterval[] = [
      { weekday: 2, start: '09:00', end: '12:00' },
      { weekday: 2, start: '14:00', end: '18:00' },
    ];
    expect(aberto(em('2026-09-29T14:00:00Z'), h)).toBe(true);  // 11:00
    expect(aberto(em('2026-09-29T16:00:00Z'), h)).toBe(false); // 13:00, almoço
    expect(aberto(em('2026-09-29T18:00:00Z'), h)).toBe(true);  // 15:00
  });

  it('intervalo que vira a meia-noite', () => {
    const h: BusinessInterval[] = [{ weekday: 2, start: '18:00', end: '02:00' }];
    expect(aberto(em('2026-09-29T23:00:00Z'), h)).toBe(true);  // 20:00 terça
    expect(aberto(em('2026-09-29T03:00:00Z'), h)).toBe(true);  // 00:00 terça
    expect(aberto(em('2026-09-29T17:00:00Z'), h)).toBe(false); // 14:00 terça
  });

  it('sem expediente cadastrado, sempre aberto — quem não configurou não fica travado', () => {
    expect(aberto(em('2026-09-29T04:00:00Z'), [])).toBe(true);
  });

  it('atendimento desativado fecha tudo, mesmo dentro do horário', () => {
    expect(aberto(em('2026-09-29T13:00:00Z'), COMERCIAL, false)).toBe(false);
    expect(aberto(em('2026-09-29T13:00:00Z'), [], false)).toBe(false);
  });

  it('o padrão sugerido é seg a sex, 8h às 18h', () => {
    expect(DEFAULT_HOURS.map((h) => h.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(aberto(em('2026-09-29T13:00:00Z'), DEFAULT_HOURS)).toBe(true);   // terça 10:00
    expect(aberto(em('2026-10-03T13:00:00Z'), DEFAULT_HOURS)).toBe(false);  // sábado
  });
});
