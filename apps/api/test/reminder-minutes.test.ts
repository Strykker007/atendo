import { describe, expect, it } from 'vitest';
import { normalizeReminderMinutes } from '../src/modules/scheduling/slots';

describe('normalizeReminderMinutes', () => {
  it('ordena da maior antecedência para a menor e tira repetidos', () => {
    expect(normalizeReminderMinutes([60, 1440, 60, 120])).toEqual([1440, 120, 60]);
  });
  it('descarta zero, negativos e quebrados', () => {
    expect(normalizeReminderMinutes([0, -5, 1.5, 30])).toEqual([30]);
  });
  it('limita a 6 lembretes', () => {
    expect(normalizeReminderMinutes([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(6);
  });
});
