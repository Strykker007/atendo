import { describe, expect, it } from 'vitest';
import { currentPlannedShift, isWithinPlannedShift, lastPlannedShift, plannedShifts, ruleStarts, type DayException } from '../src/modules/auth/shift-calendar';
import { currentShift, dayIndex, lastShift, type ShiftRule } from '../src/modules/auth/shift-window';

const at = (ymd: string, hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return { ymd, minute: h * 60 + m };
};
const d = dayIndex;

// 2026-10-19 é segunda-feira
const comercial: ShiftRule = { type: 'COMMERCIAL_44H', startTime: '08:00', endTime: '17:48', workDays: [1, 2, 3, 4, 5], restHours: 0, anchorDate: null, toleranceMinutes: 15 };
const plantao: ShiftRule = { type: 'FIXED_12X36', startTime: '19:00', endTime: '07:00', workDays: [], restHours: 36, anchorDate: '2026-10-19', toleranceMinutes: 0 };

describe('ruleStarts', () => {
  it('comercial: um turno por dia útil da semana', () => {
    expect(ruleStarts(comercial, d('2026-10-19'), d('2026-10-25')).length).toBe(5);
  });

  it('12x36: dia sim, dia não a partir da referência (também antes dela)', () => {
    const dias = ruleStarts(plantao, d('2026-10-15'), d('2026-10-24')).map((s) => Math.floor(s / 1440) - d('2026-10-19'));
    expect(dias).toEqual([-4, -2, 0, 2, 4]);
  });
});

describe('plannedShifts', () => {
  it('folga tira o turno daquele dia; extra põe um com horário próprio', () => {
    const exc: DayException[] = [
      { id: 'f', date: '2026-10-20', kind: 'off' },
      { id: 'x', date: '2026-10-24', kind: 'extra', startTime: '10:00', endTime: '14:00' },
    ];
    const p = plannedShifts(comercial, exc, d('2026-10-19'), d('2026-10-25'));
    expect(p.map((x) => x.day - d('2026-10-19'))).toEqual([0, 2, 3, 4, 5]);
    expect(p.at(-1)).toMatchObject({ source: 'extra', exceptionId: 'x', duration: 240 });
  });

  it('extra fora do intervalo não entra', () => {
    expect(plannedShifts(null, [{ date: '2026-11-01', kind: 'extra', startTime: '08:00', endTime: '12:00' }], d('2026-10-19'), d('2026-10-25'))).toEqual([]);
  });
});

describe('currentPlannedShift / lastPlannedShift', () => {
  it('sem exceção, igual à regra pura', () => {
    for (const [ymd, hm] of [['2026-10-19', '07:50'], ['2026-10-19', '12:00'], ['2026-10-19', '18:00'], ['2026-10-18', '10:00']] as const) {
      expect(currentPlannedShift(comercial, [], at(ymd, hm))).toEqual(currentShift(comercial, at(ymd, hm)));
      expect(lastPlannedShift(comercial, [], at(ymd, hm))).toEqual(lastShift(comercial, at(ymd, hm)));
    }
    for (const [ymd, hm] of [['2026-10-20', '03:00'], ['2026-10-20', '12:00'], ['2026-10-21', '19:30']] as const) {
      expect(currentPlannedShift(plantao, [], at(ymd, hm))).toEqual(currentShift(plantao, at(ymd, hm)));
      expect(lastPlannedShift(plantao, [], at(ymd, hm))).toEqual(lastShift(plantao, at(ymd, hm)));
    }
  });

  it('folga hoje: fora do turno, e o último turno é o de antes', () => {
    const exc: DayException[] = [{ date: '2026-10-20', kind: 'off' }];
    expect(currentPlannedShift(comercial, exc, at('2026-10-20', '10:00'))).toBeNull();
    expect(isWithinPlannedShift(comercial, exc, at('2026-10-20', '10:00'))).toBe(false);
    expect(lastPlannedShift(comercial, exc, at('2026-10-20', '18:00'))?.start).toBe(d('2026-10-19') * 1440 + 480);
  });

  it('extra no sábado libera dentro do horário do extra', () => {
    const exc: DayException[] = [{ date: '2026-10-24', kind: 'extra', startTime: '10:00', endTime: '14:00' }];
    expect(currentPlannedShift(comercial, exc, at('2026-10-24', '09:50'))).not.toBeNull(); // tolerância de 15
    expect(currentPlannedShift(comercial, exc, at('2026-10-24', '14:00'))).toBeNull();
  });

  it('folga num plantão que vira a meia-noite tira a madrugada seguinte também', () => {
    const exc: DayException[] = [{ date: '2026-10-19', kind: 'off' }];
    expect(currentPlannedShift(plantao, [], at('2026-10-20', '03:00'))).not.toBeNull();
    expect(currentPlannedShift(plantao, exc, at('2026-10-20', '03:00'))).toBeNull();
  });
});
