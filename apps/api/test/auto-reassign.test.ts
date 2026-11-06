import { describe, expect, it } from 'vitest';
// regras puras direto da fonte (o shared é consumido pelo dist, que só muda no build)
import { reassignAfterMinutes } from '../../../packages/shared/src/auto-reassign';
import { pickReassignTarget, waitingClockStart } from '../src/modules/auto-reassign/auto-reassign';

describe('reassignAfterMinutes', () => {
  it('demanda normal usa a base; carga cheia usa o teto; meio termo cresce em linha reta', () => {
    expect(reassignAfterMinutes(15, 30, 3, 5)).toBe(15);
    expect(reassignAfterMinutes(15, 30, 5, 5)).toBe(15);
    expect(reassignAfterMinutes(15, 30, 10, 5)).toBe(20);
    expect(reassignAfterMinutes(15, 30, 15, 5)).toBe(25);
    expect(reassignAfterMinutes(15, 30, 20, 5)).toBe(30);
  });

  it('nunca passa do teto, por maior que seja a fila', () => {
    expect(reassignAfterMinutes(15, 30, 500, 2)).toBe(30);
  });

  it('ninguém online = não redistribui', () => {
    expect(reassignAfterMinutes(15, 30, 10, 0)).toBeNull();
  });

  it('teto menor que a base vira a base (configuração incoerente não encurta o tempo)', () => {
    expect(reassignAfterMinutes(20, 10, 100, 1)).toBe(20);
  });
});

describe('waitingClockStart', () => {
  const espera = new Date('2026-11-05T10:00:00Z');
  it('quem acabou de receber ganha o tempo inteiro', () => {
    const recebeu = new Date('2026-11-05T10:20:00Z');
    expect(waitingClockStart(espera, recebeu)).toEqual(recebeu);
  });
  it('dono antigo: conta desde a primeira mensagem sem resposta', () => {
    expect(waitingClockStart(espera, new Date('2026-11-05T09:00:00Z'))).toEqual(espera);
    expect(waitingClockStart(espera, null)).toEqual(espera);
  });
});

describe('pickReassignTarget', () => {
  const online = new Set(['ana', 'bia', 'caio']);
  it('menos ocupado entre os online, fora o dono atual', () => {
    expect(pickReassignTarget({ eligible: ['ana', 'bia', 'caio'], online, exclude: new Set(['ana']), openCount: { ana: 0, bia: 5, caio: 2 } })).toBe('caio');
  });
  it('offline e quem já recebeu nesta espera ficam de fora', () => {
    expect(pickReassignTarget({ eligible: ['ana', 'bia', 'dani'], online, exclude: new Set(['bia']), openCount: { dani: 0, ana: 3 } })).toBe('ana');
  });
  it('ninguém sobrando = undefined', () => {
    expect(pickReassignTarget({ eligible: ['ana'], online, exclude: new Set(['ana']), openCount: {} })).toBeUndefined();
  });
});
