import { describe, expect, it } from 'vitest';
import { typingMs, warmupPhase } from '../src/modules/whatsapp/number-warmup';

const t0 = new Date('2026-10-07T12:00:00Z');
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
const evo = { provider: 'evolution', sessionStartedAt: t0 };

describe('aquecimento da sessão', () => {
  it('0–24h: 20 contatos novos/h e 8 s entre envios', () => expect(warmupPhase(evo, h(3))).toMatchObject({ phase: 1, newConvPerHour: 20, minGapMs: 8000 }));
  it('24–48h: 50/h', () => expect(warmupPhase(evo, h(30))).toMatchObject({ phase: 2, newConvPerHour: 50, minGapMs: 0 }));
  it('48–72h: 80/h', () => expect(warmupPhase(evo, h(60))).toMatchObject({ phase: 3, newConvPerHour: 80 }));
  it('depois de 72h: livre', () => expect(warmupPhase(evo, h(73))).toBeNull());
  it('oficial nunca aquece', () => expect(warmupPhase({ provider: 'meta', sessionStartedAt: t0 }, h(1))).toBeNull());
  it('sem sessão registrada (número antigo): livre', () => expect(warmupPhase({ provider: 'evolution', sessionStartedAt: null }, h(1))).toBeNull());
});

describe('digitando', () => {
  it('mínimo 2 s', () => expect(typingMs(5)).toBe(2000));
  it('40 ms por caractere', () => expect(typingMs(100)).toBe(4000));
  it('máximo 7 s', () => expect(typingMs(1000)).toBe(7000));
});
