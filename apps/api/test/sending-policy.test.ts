import { describe, expect, it } from 'vitest';
import { DELAY_RANGES, WARMUP_DAY1, dailyLimit, delayMs, warmupDay, withinDailyLimit, type SendDelayProfile } from '../src/modules/whatsapp/sending-policy';

describe('delayMs — intervalo entre envios', () => {
  it('respeita a faixa de cada perfil', () => {
    for (const [profile, [min, max]] of Object.entries(DELAY_RANGES) as [SendDelayProfile, [number, number]][]) {
      for (const r of [0, 0.5, 0.999]) {
        const ms = delayMs(profile, () => r);
        expect(ms, profile).toBeGreaterThanOrEqual(min * 1000);
        expect(ms, profile).toBeLessThanOrEqual(max * 1000);
      }
    }
  });

  it('instant não espera — a API oficial não bane por ritmo', () => {
    expect(delayMs('instant')).toBe(0);
  });

  it('é aleatório: intervalo fixo é assinatura de robô', () => {
    const amostras = new Set(Array.from({ length: 50 }, () => delayMs('short')));
    expect(amostras.size).toBeGreaterThan(10);
  });

  it('perfil desconhecido cai no curto em vez de enviar em rajada', () => {
    expect(delayMs('inexistente' as SendDelayProfile, () => 0)).toBe(7000);
  });
});

describe('aquecimento de número novo', () => {
  const start = new Date('2026-09-01T10:00:00Z');
  const dia = (n: number) => new Date(start.getTime() + (n - 1) * 86_400_000);

  it('o dia da conexão é o dia 1', () => {
    expect(warmupDay(start, start)).toBe(1);
    expect(warmupDay(start, new Date(start.getTime() + 3600_000))).toBe(1);
    expect(warmupDay(start, dia(2))).toBe(2);
  });

  it('começa baixo e dobra a cada dia', () => {
    const limites = [1, 2, 3, 4].map((d) => dailyLimit({ configured: 1000, warmupStartedAt: start, now: dia(d) }));
    expect(limites).toEqual([WARMUP_DAY1, 40, 80, 160]);
  });

  it('nunca passa do teto configurado durante o aquecimento', () => {
    expect(dailyLimit({ configured: 50, warmupStartedAt: start, now: dia(4) })).toBe(50);
  });

  it('depois do período de aquecimento vale o teto configurado', () => {
    expect(dailyLimit({ configured: 1000, warmupStartedAt: start, now: dia(8) })).toBe(1000);
  });

  it('número sem aquecimento usa o teto direto', () => {
    expect(dailyLimit({ configured: 1000, warmupStartedAt: null })).toBe(1000);
  });

  it('"sem teto" ainda respeita o aquecimento — é o período mais arriscado', () => {
    expect(dailyLimit({ configured: 0, warmupStartedAt: start, now: dia(1) })).toBe(WARMUP_DAY1);
    expect(dailyLimit({ configured: 0, warmupStartedAt: start, now: dia(30) })).toBe(0);
  });
});

describe('withinDailyLimit', () => {
  it('libera abaixo do teto e bloqueia ao atingir', () => {
    expect(withinDailyLimit(99, 100).ok).toBe(true);
    expect(withinDailyLimit(100, 100).ok).toBe(false);
  });

  it('a mensagem de bloqueio explica quando volta a enviar', () => {
    expect(withinDailyLimit(100, 100).reason).toContain('amanhã');
  });

  it('teto 0 = sem teto', () => {
    expect(withinDailyLimit(999_999, 0).ok).toBe(true);
  });
});
