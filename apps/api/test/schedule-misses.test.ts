import { describe, expect, it } from 'vitest';
import { MAX_SCHEDULE_MISSES, onScheduleMiss } from '../src/modules/flows/schedule-misses';

describe('onScheduleMiss — resposta não entendida no agendamento', () => {
  it('repete o menu nas primeiras tentativas', () => {
    expect(onScheduleMiss(0)).toEqual({ action: 'repeat', misses: 1 });
    expect(onScheduleMiss(1)).toEqual({ action: 'repeat', misses: 2 });
  });

  it('chama um humano ao atingir o limite — nada de "não entendi" para sempre', () => {
    expect(onScheduleMiss(MAX_SCHEDULE_MISSES - 1).action).toBe('handoff');
    expect(onScheduleMiss(99).action).toBe('handoff');
  });

  it('limite 1 entrega já na primeira resposta errada', () => {
    expect(onScheduleMiss(0, 1).action).toBe('handoff');
  });

  it('limite zerado ou negativo não vira laço infinito', () => {
    for (const max of [0, -3]) expect(onScheduleMiss(0, max).action).toBe('handoff');
  });
});
