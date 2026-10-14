import { describe, expect, it } from 'vitest';
import type { PlanLimits } from '@atendo/shared';
import { addMonths, cycleValue, discounted, effectiveLimits, overrideActive, overridePrice, promotionFor } from '../src/modules/billing/plan-override';
import { decideCanSend } from '../src/modules/billing/quota';
import { grantDiscountIn, grantEnd } from '../src/modules/billing/discount-ledger.service';

const base: PlanLimits = {
  maxNumbers: 1,
  maxAgents: 3,
  maxQuickReplies: 50,
  includedMessagesMonth: 1000,
  includedTemplatesMonth: 100,
  overagePricePerMessage: null,
  overagePricePerTemplate: null,
  hardLimit: true,
  graceDays: 5,
  features: ['flows'],
};
const now = new Date('2026-10-13T12:00:00Z');
const ov = (p: Partial<{ planId: string; priceMonth: number | null; limits: object; expiresAt: Date | null }> = {}) => ({ planId: 'starter', priceMonth: null, limits: {}, expiresAt: null, ...p });

describe('personalização do plano por cliente', () => {
  it('vale só no plano em que foi feita e antes da data limite', () => {
    expect(overrideActive(ov(), 'starter', now)).toBe(true);
    expect(overrideActive(ov(), 'pro', now)).toBe(false);
    expect(overrideActive(ov({ expiresAt: new Date('2026-10-13T11:59:59Z') }), 'starter', now)).toBe(false);
    expect(overrideActive(ov({ expiresAt: new Date('2026-10-14T00:00:00Z') }), 'starter', now)).toBe(true);
    expect(overrideActive(null, 'starter', now)).toBe(false);
  });

  it('sobrescreve só as chaves presentes; null = ilimitado', () => {
    const l = effectiveLimits(base, ov({ limits: { maxAgents: 10, maxNumbers: null } }), 'starter', now);
    expect(l.maxAgents).toBe(10);
    expect(l.maxNumbers).toBeNull();
    expect(l.maxQuickReplies).toBe(50);
    expect(l.includedMessagesMonth).toBe(1000);
  });

  it('features substitui a lista do plano', () => {
    expect(effectiveLimits(base, ov({ limits: { features: ['flows', 'campaigns'] } }), 'starter', now).features).toEqual(['flows', 'campaigns']);
    expect(effectiveLimits(base, ov({ limits: {} }), 'starter', now).features).toEqual(['flows']);
  });

  it('expirada ou de outro plano: limites do plano', () => {
    expect(effectiveLimits(base, ov({ limits: { maxAgents: 10 }, expiresAt: new Date('2026-01-01') }), 'starter', now).maxAgents).toBe(3);
    expect(effectiveLimits(base, ov({ limits: { maxAgents: 10 } }), 'pro', now).maxAgents).toBe(3);
  });

  it('quota de envio usa a cota personalizada', () => {
    const limits = effectiveLimits(base, ov({ limits: { includedMessagesMonth: 5000 } }), 'starter', now);
    expect(decideCanSend({ limits, status: 'active' }, { messages: 2000, templates: 0, conversations: 0 }, 'messages').ok).toBe(true);
    expect(decideCanSend({ limits: base, status: 'active' }, { messages: 2000, templates: 0, conversations: 0 }, 'messages').ok).toBe(false);
  });

  it('valor negociado só quando vale e foi informado', () => {
    expect(overridePrice(ov({ priceMonth: 79.9 }), 'starter', now)).toBe(79.9);
    expect(overridePrice(ov(), 'starter', now)).toBeNull();
    expect(overridePrice(ov({ priceMonth: 79.9 }), 'pro', now)).toBeNull();
  });

  it('valor do ciclo: anual × 12, grupo × unidades', () => {
    expect(cycleValue(79.9, 'monthly')).toBe(79.9);
    expect(cycleValue(79.9, 'yearly')).toBe(958.8);
    expect(cycleValue(50, 'monthly', 3)).toBe(150);
  });
});

describe('promoções de entrada', () => {
  const promo = (p: Partial<{ id: string; discountPercent: number; planIds: string[]; startsAt: Date; endsAt: Date; isActive: boolean }> = {}) => ({
    id: 'p1', discountPercent: 20, durationMonths: 3, planIds: ['starter'], startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-12-31T23:59:59Z'), isActive: true, ...p,
  });
  const atual = (p: Partial<{ planId: string; priceMonth: number | null; expiresAt: Date | null; promotionId: string | null }> = {}) => ({ planId: 'starter', priceMonth: 50, limits: {}, expiresAt: null, promotionId: null, ...p });

  it('vale no plano escolhido, dentro da janela e ativa', () => {
    expect(promotionFor([promo()], 'starter', null, now)?.id).toBe('p1');
    expect(promotionFor([promo()], 'pro', null, now)).toBeNull();
    expect(promotionFor([promo({ isActive: false })], 'starter', null, now)).toBeNull();
    expect(promotionFor([promo({ endsAt: new Date('2026-10-13T11:00:00Z') })], 'starter', null, now)).toBeNull();
    expect(promotionFor([promo({ startsAt: new Date('2026-11-01') })], 'starter', null, now)).toBeNull();
  });

  it('não acumula com personalização valendo no mesmo plano', () => {
    expect(promotionFor([promo()], 'starter', atual(), now)).toBeNull();
    // personalização de outro plano ou já expirada não impede
    expect(promotionFor([promo()], 'starter', atual({ planId: 'pro' }), now)?.id).toBe('p1');
    expect(promotionFor([promo()], 'starter', atual({ expiresAt: new Date('2026-01-01') }), now)?.id).toBe('p1');
  });

  it('quem já aproveitou não aproveita de novo', () => {
    expect(promotionFor([promo()], 'starter', atual({ planId: 'pro', promotionId: 'p1' }), now)).toBeNull();
  });

  it('duas valendo: a maior', () => {
    expect(promotionFor([promo(), promo({ id: 'p2', discountPercent: 30 })], 'starter', null, now)?.id).toBe('p2');
  });

  it('desconto e prazo', () => {
    expect(discounted(99.9, 20)).toBe(79.92);
    expect(addMonths(new Date(2026, 0, 31), 1).getDate()).toBe(28);
    expect(addMonths(new Date(2026, 9, 13), 3).getMonth()).toBe(0);
  });
});

describe('livro de descontos', () => {
  const g = (p: Partial<{ startsAt: Date; endsAt: Date | null; closedAt: Date | null; units: number }> = {}) => ({ listPrice: 100, priceMonth: 80, units: 1, startsAt: new Date('2026-10-13T12:00:00Z'), endsAt: new Date('2027-01-13T12:00:00Z'), closedAt: null, ...p });

  it('conta o desconto nos meses em que valeu', () => {
    expect(grantDiscountIn(g(), '2026-09')).toBe(0);
    expect(grantDiscountIn(g(), '2026-10')).toBe(20);
    expect(grantDiscountIn(g(), '2026-12')).toBe(20);
    expect(grantDiscountIn(g(), '2027-01')).toBe(20);
    expect(grantDiscountIn(g(), '2027-02')).toBe(0);
  });

  it('encerrada antes do previsto para de contar; grupo multiplica por unidades', () => {
    expect(grantDiscountIn(g({ closedAt: new Date('2026-11-05') }), '2026-12')).toBe(0);
    expect(grantEnd(g({ closedAt: new Date('2026-11-05') }))?.toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect(grantDiscountIn(g({ units: 3 }), '2026-11')).toBe(60);
    expect(grantDiscountIn(g({ endsAt: null }), '2030-01')).toBe(20);
  });
});
