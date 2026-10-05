import { describe, expect, it } from 'vitest';
import { countLimit, type PlanLimits } from '@atendo/shared';
import { freePeriod, normalizePlan, rollMonthly } from '../src/modules/billing/plan-rules';

const limits: PlanLimits = {
  maxNumbers: 1,
  maxAgents: 2,
  includedMessagesMonth: 1000,
  includedTemplatesMonth: 10,
  overagePricePerMessage: 0.02,
  overagePricePerTemplate: 0.5,
  hardLimit: false,
  graceDays: 5,
};

describe('normalizePlan', () => {
  it('gratuito zera preço e trava a quota (sem excedente para cobrar)', () => {
    const n = normalizePlan({ priceMonth: 97, priceYear: 900, isFree: true, billingModel: 'hybrid', limits });
    expect(n).toMatchObject({ isFree: true, billingCycle: 'free', priceMonth: 0, priceYear: null, billingModel: 'fixed', durationDays: null });
    expect(n.limits).toMatchObject({ hardLimit: true, overagePricePerMessage: null, overagePricePerTemplate: null });
  });

  it('billingCycle free liga isFree e guarda os dias de degustação', () => {
    const n = normalizePlan({ priceMonth: 10, billingCycle: 'free', durationDays: 14, billingModel: 'fixed', limits });
    expect(n).toMatchObject({ isFree: true, durationDays: 14, priceMonth: 0 });
  });

  it('anual grava o equivalente mensal e ignora durationDays', () => {
    const n = normalizePlan({ priceMonth: 0, priceYear: 970, billingCycle: 'yearly', durationDays: 30, billingModel: 'fixed', limits });
    expect(n).toMatchObject({ isFree: false, priceYear: 970, priceMonth: 80.83, durationDays: null });
  });

  it('mensal mantém o preço e descarta priceYear', () => {
    const n = normalizePlan({ priceMonth: 97, priceYear: 500, billingModel: 'fixed', limits });
    expect(n).toMatchObject({ billingCycle: 'monthly', priceMonth: 97, priceYear: null });
  });
});

describe('períodos de plano gratuito', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  it('com prazo termina no fim da degustação', () => {
    expect(freePeriod(7, now).end.toISOString()).toBe('2026-10-12T12:00:00.000Z');
  });
  it('permanente rola mês a mês até cobrir hoje', () => {
    const r = rollMonthly(new Date('2026-07-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'), now);
    expect(r.end > now).toBe(true);
    expect(r.start <= now).toBe(true);
  });
});

describe('countLimit', () => {
  it('null e ausente = ilimitado', () => {
    expect(countLimit({ ...limits, maxNumbers: null }, 'maxNumbers')).toBeNull();
    expect(countLimit(limits, 'maxFlows')).toBeNull();
    expect(countLimit({ ...limits, maxQuickReplies: 0 }, 'maxQuickReplies')).toBe(0);
  });
});

describe('quota ilimitada (incluído = null)', () => {
  it('nunca bloqueia, mesmo com hardLimit', async () => {
    const { decideCanSend } = await import('../src/modules/billing/quota');
    const plan = { status: 'active', limits: { ...limits, hardLimit: true, includedMessagesMonth: null, includedTemplatesMonth: null } };
    expect(decideCanSend(plan, { messages: 1e6, templates: 1e6, conversations: 0 }, 'messages')).toEqual({ ok: true });
    expect(decideCanSend(plan, { messages: 0, templates: 1e6, conversations: 0 }, 'templates')).toEqual({ ok: true });
  });
  it('conversas ausentes continuam valendo 0 (planos antigos)', async () => {
    const { decideCanSend } = await import('../src/modules/billing/quota');
    const plan = { status: 'active', limits: { ...limits, hardLimit: true, billingUnit: 'conversations' as const } };
    expect(decideCanSend(plan, { messages: 0, templates: 0, conversations: 1 }, 'messages').ok).toBe(false);
  });
});
