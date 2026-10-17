import { describe, expect, it } from 'vitest';
import { currentShift, dayIndex, isWithinShift, lastShift, shiftDuration, splitLocal, weekdayOf, type ShiftRule } from '../src/modules/auth/shift-window';

const at = (ymd: string, hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return { ymd, minute: h * 60 + m };
};

// 2026-10-19 é segunda-feira
const comercial: ShiftRule = { type: 'COMMERCIAL_44H', startTime: '08:00', endTime: '17:48', workDays: [1, 2, 3, 4, 5], restHours: 0, anchorDate: null, toleranceMinutes: 15 };
const plantao: ShiftRule = { type: 'FIXED_12X36', startTime: '19:00', endTime: '07:00', workDays: [], restHours: 36, anchorDate: '2026-10-19', toleranceMinutes: 0 };

describe('isWithinShift', () => {
  it('dia da semana bate com o calendário', () => {
    expect(weekdayOf(dayIndex('2026-10-19'))).toBe(1);
    expect(weekdayOf(dayIndex('2026-10-18'))).toBe(0);
  });

  it('comercial: dentro do horário em dia útil', () => {
    expect(isWithinShift(comercial, at('2026-10-19', '10:00'))).toBe(true);
    expect(isWithinShift(comercial, at('2026-10-19', '17:47'))).toBe(true);
  });

  it('comercial: o fim é exato e fim de semana fica fora', () => {
    expect(isWithinShift(comercial, at('2026-10-19', '17:48'))).toBe(false);
    expect(isWithinShift(comercial, at('2026-10-18', '10:00'))).toBe(false);
  });

  it('tolerância libera alguns minutos antes do início', () => {
    expect(isWithinShift(comercial, at('2026-10-19', '07:45'))).toBe(true);
    expect(isWithinShift(comercial, at('2026-10-19', '07:44'))).toBe(false);
  });

  it('turno noturno vira a meia-noite e pertence ao dia em que começou', () => {
    const noturno: ShiftRule = { ...comercial, startTime: '22:00', endTime: '06:00', workDays: [5], toleranceMinutes: 0 };
    expect(shiftDuration(noturno)).toBe(480);
    // sexta 23h e sábado 05h: dentro; sábado 22h: não (sábado não é dia de início)
    expect(isWithinShift(noturno, at('2026-10-23', '23:00'))).toBe(true);
    expect(isWithinShift(noturno, at('2026-10-24', '05:59'))).toBe(true);
    expect(isWithinShift(noturno, at('2026-10-24', '22:30'))).toBe(false);
  });

  it('12x36: trabalha um ciclo sim, folga 36h, trabalha de novo', () => {
    expect(isWithinShift(plantao, at('2026-10-19', '20:00'))).toBe(true);
    expect(isWithinShift(plantao, at('2026-10-20', '06:59'))).toBe(true);
    expect(isWithinShift(plantao, at('2026-10-20', '07:00'))).toBe(false);
    expect(isWithinShift(plantao, at('2026-10-20', '20:00'))).toBe(false);
    expect(isWithinShift(plantao, at('2026-10-21', '19:00'))).toBe(true);
    // antes da âncora o ciclo também vale
    expect(isWithinShift(plantao, at('2026-10-17', '19:30'))).toBe(true);
  });

  it('escala por ciclo sem âncora nunca libera', () => {
    expect(isWithinShift({ ...plantao, anchorDate: null }, at('2026-10-19', '20:00'))).toBe(false);
  });
});

describe('currentShift / lastShift', () => {
  const m = (ymd: string, hm: string) => dayIndex(ymd) * 1440 + Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

  it('comercial: turno de hoje e o fim exato', () => {
    expect(currentShift(comercial, at('2026-10-19', '10:00'))).toEqual({ start: m('2026-10-19', '08:00'), end: m('2026-10-19', '17:48') });
    expect(currentShift(comercial, at('2026-10-19', '18:00'))).toBeNull();
    expect(lastShift(comercial, at('2026-10-19', '18:00'))?.end).toBe(m('2026-10-19', '17:48'));
  });

  it('comercial: segunda de manhã, o último turno foi sexta', () => {
    expect(lastShift(comercial, at('2026-10-19', '07:00'))?.end).toBe(m('2026-10-16', '17:48'));
  });

  it('12x36: turno da noite e o anterior', () => {
    expect(currentShift(plantao, at('2026-10-20', '02:00'))).toEqual({ start: m('2026-10-19', '19:00'), end: m('2026-10-20', '07:00') });
    expect(lastShift(plantao, at('2026-10-20', '08:00'))?.end).toBe(m('2026-10-20', '07:00'));
    expect(lastShift(plantao, at('2026-10-21', '20:00'))?.end).toBe(m('2026-10-20', '07:00'));
  });

  it('splitLocal volta para data e hora', () => {
    expect(splitLocal(m('2026-10-20', '07:05'))).toEqual({ ymd: '2026-10-20', hm: '07:05' });
  });
});
