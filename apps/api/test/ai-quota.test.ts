import { describe, expect, it } from 'vitest';
import type { PlanLimits } from '@atendo/shared';
import { decideCanUseAi } from '../src/modules/ai/ai-quota';

const base: PlanLimits = {
  maxNumbers: 1,
  maxAgents: 3,
  includedMessagesMonth: 1000,
  includedTemplatesMonth: 100,
  overagePricePerMessage: 0.05,
  overagePricePerTemplate: 0.3,
  hardLimit: false,
  graceDays: 5,
  includedAiInteractionsMonth: 500,
  overagePricePerAiInteraction: 0.1,
  aiMonthlyCostCap: 60,
};
const plano = (over: Partial<PlanLimits> = {}, status = 'active') => ({ limits: { ...base, ...over }, status });
const uso = (interactions: number, costBrl = 0) => ({ interactions, costBrl });

describe('decideCanUseAi', () => {
  it('dentro do incluído, usa', () => {
    expect(decideCanUseAi(plano(), uso(499))).toEqual({ ok: true });
  });

  it('estourou o incluído com excedente configurado: usa e cobra', () => {
    expect(decideCanUseAi(plano(), uso(500))).toEqual({ ok: true, overage: true });
  });

  it('estourou sem preço de excedente: bloqueia', () => {
    expect(decideCanUseAi(plano({ overagePricePerAiInteraction: null }), uso(500)).ok).toBe(false);
  });

  it('plano sem IA nenhuma explica que não está incluída', () => {
    const d = decideCanUseAi(plano({ includedAiInteractionsMonth: 0, overagePricePerAiInteraction: null }), uso(0));
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('não incluída');
  });

  it('plano antigo, sem os campos de IA no JSON, simplesmente não tem IA', () => {
    const { includedAiInteractionsMonth, overagePricePerAiInteraction, aiMonthlyCostCap, ...semIa } = base;
    expect(decideCanUseAi({ limits: semIa, status: 'active' }, uso(0)).ok).toBe(false);
  });

  it('teto de custo corta mesmo com excedente contratado — é a trava que protege você', () => {
    const d = decideCanUseAi(plano(), uso(10, 60));
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('Teto de gasto');
  });

  it('abaixo do teto, segue', () => {
    expect(decideCanUseAi(plano(), uso(10, 59.99)).ok).toBe(true);
  });

  it('teto zerado ou ausente significa sem teto extra', () => {
    expect(decideCanUseAi(plano({ aiMonthlyCostCap: 0 }), uso(10, 9999)).ok).toBe(true);
  });

  it('assinatura suspensa ou sem assinatura não usa IA', () => {
    expect(decideCanUseAi(plano({}, 'suspended'), uso(0)).ok).toBe(false);
    expect(decideCanUseAi(null, uso(0)).ok).toBe(false);
  });

  it('o teto vale antes da quota: cliente pagando excedente também para', () => {
    expect(decideCanUseAi(plano(), uso(10_000, 60)).reason).toContain('Teto de gasto');
  });
});
