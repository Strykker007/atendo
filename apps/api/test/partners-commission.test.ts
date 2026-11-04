import { describe, expect, it } from 'vitest';
import { commissionOf, nextTier, tierRate } from '@atendo/shared';
import { activationSplit, countsForPartner } from '../src/modules/partners/commission-rules';

describe('VogoPartners — comissão', () => {
  it('faixa: a maior alcançada vale para todos os clientes', () => {
    const faixas = [{ minClients: 0, rate: 20 }, { minClients: 75, rate: 25 }];
    expect(tierRate(faixas, 0)).toBe(20);
    expect(tierRate(faixas, 74)).toBe(20);
    expect(tierRate(faixas, 75)).toBe(25);
    expect(nextTier(faixas, 50)).toEqual({ minClients: 75, rate: 25, missing: 25 });
    expect(nextTier(faixas, 80)).toBeNull();
  });

  it('sem faixa a partir de 0, abaixo da primeira é 0%', () => {
    expect(tierRate([{ minClients: 10, rate: 20 }], 9)).toBe(0);
  });

  it('comissão em centavos', () => {
    expect(commissionOf(297, 20)).toBe(59.4);
    expect(commissionOf(99.9, 25)).toBe(24.98);
  });

  it('ativação: instalação e 1ª mensalidade separadas, desconto rateado, "outros" fora', () => {
    expect(activationSplit([{ value: 500, kind: 'setup' }, { value: 297, kind: 'first_month' }], 0)).toEqual({ setupBase: 500, firstMonthBase: 297 });
    // 10% de desconto no total
    expect(activationSplit([{ value: 500, kind: 'setup' }, { value: 500, kind: 'first_month' }], 100)).toEqual({ setupBase: 450, firstMonthBase: 450 });
    expect(activationSplit([{ value: 200, kind: 'other' }, { value: 300, kind: 'setup' }], 0)).toEqual({ setupBase: 300, firstMonthBase: 0 });
    expect(activationSplit([], 0)).toEqual({ setupBase: 0, firstMonthBase: 0 });
  });

  it('só conta pagamento depois do vínculo com o parceiro', () => {
    const vinculo = new Date('2026-11-01T10:00:00Z');
    expect(countsForPartner(new Date('2026-11-01T09:59:59Z'), vinculo)).toBe(false);
    expect(countsForPartner(new Date('2026-11-01T10:00:00Z'), vinculo)).toBe(true);
    expect(countsForPartner(new Date(), null)).toBe(false);
  });
});
