import { describe, expect, it } from 'vitest';
import { localToUtc, partsIn, toLocal, tzOffsetMs, TZ_DEFAULT } from '../src/modules/scheduling/time';

const SP = TZ_DEFAULT;

describe('toLocal', () => {
  it('converte UTC para o relógio do tenant', () => {
    const l = toLocal(new Date('2026-09-22T12:00:00Z'), SP);
    expect(l).toEqual({ ymd: '2026-09-22', hm: '09:00', weekday: 2, label: 'ter. 22/09 09:00' });
  });

  it('vira o dia corretamente perto da meia-noite (o erro clássico de agenda)', () => {
    // 01:00 UTC ainda é o dia anterior, 22:00, em São Paulo
    expect(toLocal(new Date('2026-09-23T01:00:00Z'), SP)).toMatchObject({ ymd: '2026-09-22', hm: '22:00', weekday: 2 });
    // 03:00 UTC já é o dia seguinte, 00:00
    expect(toLocal(new Date('2026-09-23T03:00:00Z'), SP)).toMatchObject({ ymd: '2026-09-23', hm: '00:00', weekday: 3 });
  });

  it('usa meia-noite como 00:00 e não 24:00', () => {
    expect(toLocal(new Date('2026-09-23T03:00:00Z'), SP).hm).toBe('00:00');
  });

  it('numera os dias da semana com domingo = 0', () => {
    const domingo = toLocal(new Date('2026-09-20T15:00:00Z'), SP);
    expect(domingo.weekday).toBe(0);
    expect(domingo.label.startsWith('dom.')).toBe(true);
  });

  it('respeita o fuso do tenant, não o da máquina', () => {
    const d = new Date('2026-09-22T12:00:00Z');
    expect(toLocal(d, 'America/Sao_Paulo').hm).toBe('09:00');
    expect(toLocal(d, 'America/Manaus').hm).toBe('08:00');
    expect(toLocal(d, 'UTC').hm).toBe('12:00');
  });
});

describe('localToUtc', () => {
  it('converte o horário escolhido na agenda para o instante real', () => {
    expect(localToUtc('2026-09-22', '09:00', SP).toISOString()).toBe('2026-09-22T12:00:00.000Z');
  });

  it('é o inverso de toLocal', () => {
    const ida = localToUtc('2026-09-22', '14:30', SP);
    expect(toLocal(ida, SP)).toMatchObject({ ymd: '2026-09-22', hm: '14:30' });
  });

  it('acerta o horário de verão (offset avaliado no próprio instante)', () => {
    // São Paulo ainda tinha horário de verão em 2018: -02 em novembro, -03 em junho
    expect(localToUtc('2018-11-10', '12:00', SP).toISOString()).toBe('2018-11-10T14:00:00.000Z');
    expect(localToUtc('2018-06-10', '12:00', SP).toISOString()).toBe('2018-06-10T15:00:00.000Z');
    // e num fuso que ainda usa horário de verão hoje
    expect(localToUtc('2026-03-10', '09:00', 'America/New_York').toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(localToUtc('2026-01-10', '09:00', 'America/New_York').toISOString()).toBe('2026-01-10T14:00:00.000Z');
  });

  it('tzOffsetMs devolve quanto somar ao relógio local para chegar no instante real', () => {
    // São Paulo é UTC-3, então o relógio local lido como UTC precisa de +3h
    expect(tzOffsetMs(new Date('2026-09-22T12:00:00Z'), SP)).toBe(3 * 3_600_000);
    expect(tzOffsetMs(new Date('2018-11-10T14:00:00Z'), SP)).toBe(2 * 3_600_000);
  });

  it('partsIn devolve as partes no fuso pedido', () => {
    expect(partsIn(new Date('2026-09-22T12:00:00Z'), SP)).toEqual({ y: 2026, m: 9, d: 22, hh: 9, mm: 0, weekday: 2 });
  });
});
