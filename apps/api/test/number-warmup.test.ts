import { describe, expect, it } from 'vitest';
import { humanTiming, typingMs, warmupPhase } from '../src/modules/whatsapp/number-warmup';

const t0 = new Date('2026-10-07T12:00:00Z');
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
const evo = { provider: 'evolution', sessionStartedAt: t0 };

describe('aquecimento da sessão', () => {
  it('0–24h: 20 contatos novos/h, 8 s entre envios e 30 automáticas/h', () => expect(warmupPhase(evo, h(3))).toMatchObject({ phase: 1, newConvPerHour: 20, minGapMs: 8000, autoPerHour: 30 }));
  it('24–48h: 50/h', () => expect(warmupPhase(evo, h(30))).toMatchObject({ phase: 2, newConvPerHour: 50, minGapMs: 0, autoPerHour: 50 }));
  it('48–72h: 80/h', () => expect(warmupPhase(evo, h(60))).toMatchObject({ phase: 3, newConvPerHour: 80, autoPerHour: 60 }));
  it('72h–7 dias: robô ainda abaixo do padrão', () => expect(warmupPhase(evo, h(100))).toMatchObject({ phase: 4, newConvPerHour: 120, autoPerHour: 70 }));
  it('depois de 7 dias: livre', () => expect(warmupPhase(evo, h(169))).toBeNull());
  it('oficial nunca aquece', () => expect(warmupPhase({ provider: 'meta', sessionStartedAt: t0 }, h(1))).toBeNull());
  it('sem sessão registrada (número antigo): livre', () => expect(warmupPhase({ provider: 'evolution', sessionStartedAt: null }, h(1))).toBeNull());
});

describe('digitando', () => {
  it('mínimo 2 s', () => expect(typingMs(5)).toBe(2000));
  it('40 ms por caractere', () => expect(typingMs(100)).toBe(4000));
  it('máximo 7 s', () => expect(typingMs(1000)).toBe(7000));
});

describe('tempo humano da automação', () => {
  const min = () => 0;
  const max = () => 0.999999;
  it('frase curta: digita pelo menos 1,5 s', () => expect(humanTiming(5, min).typingMs).toBe(1500));
  it('100 caracteres: 17–29 s viram o teto de 15 s no mais lento', () => expect(humanTiming(100, min).typingMs).toBe(15_000));
  it('40 caracteres no mais rápido (6/s) ≈ 6,7 s', () => expect(humanTiming(40, max).typingMs).toBe(6667));
  it('40 caracteres no mais lento (3,5/s) ≈ 11,4 s', () => expect(humanTiming(40, min).typingMs).toBe(11429));
  it('reação mínima 1,2 s + 10 ms por caractere', () => expect(humanTiming(50, min).reactMs).toBe(1700));
  it('reação com resposta longa: no máximo +2 s', () => expect(humanTiming(1000, max).reactMs).toBe(5000));
});
