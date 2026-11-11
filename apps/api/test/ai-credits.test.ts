import { describe, expect, it } from 'vitest';
import { creditCharge, decideWithCredit } from '../src/modules/ai/ai-quota';

const plan = (limits: Record<string, unknown>, status = 'active') => ({ status, limits: { features: ['ai_flows'], ...limits } as never });
const used = (interactions: number, costBrl = 0) => ({ interactions, costBrl });

describe('saldo de IA: ordem incluído → saldo → excedente → bloqueia', () => {
  it('dentro do incluído no plano não mexe no saldo', () => {
    expect(decideWithCredit(plan({ includedAiInteractionsMonth: 100 }), used(10), 50)).toEqual({ ok: true });
  });

  it('passou do incluído com saldo: usa o saldo (antes do excedente na fatura)', () => {
    expect(decideWithCredit(plan({ includedAiInteractionsMonth: 100, overagePricePerAiInteraction: 0.1 }), used(100), 5)).toEqual({ ok: true, credit: true });
  });

  it('plano sem IA incluída também compra saldo; sem saldo, a mensagem manda comprar', () => {
    expect(decideWithCredit(plan({}), used(0), 1).credit).toBe(true);
    const r = decideWithCredit(plan({}), used(0), 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Compre saldo de IA/);
  });

  it('teto de gasto atingido: o saldo passa por cima (o cliente já pagou)', () => {
    expect(decideWithCredit(plan({ includedAiInteractionsMonth: 1000, aiMonthlyCostCap: 10 }), used(5, 10), 3).credit).toBe(true);
  });

  it('sem saldo e com excedente: segue o excedente como antes', () => {
    expect(decideWithCredit(plan({ includedAiInteractionsMonth: 1, overagePricePerAiInteraction: 0.1 }), used(1), 0)).toEqual({ ok: true, overage: true });
  });

  it('assinatura suspensa não usa saldo', () => {
    expect(decideWithCredit(plan({}, 'suspended'), used(0), 100).ok).toBe(false);
  });
});

describe('creditCharge', () => {
  it('custo × (1 + margem%), margem negativa vira zero', () => {
    expect(creditCharge(0.01, 100)).toBe(0.02);
    expect(creditCharge(0.01, 250)).toBe(0.035);
    expect(creditCharge(0.01, -50)).toBe(0.01);
  });
});
