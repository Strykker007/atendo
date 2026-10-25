import { describe, expect, it } from 'vitest';
import { PLAN_FEATURES, countLimit, type PlanLimits } from '@atendo/shared';
import { ownerLimits } from '../src/modules/billing/owner-limits';
import { UsageService } from '../src/modules/billing/usage.service';
import { decideCanSend } from '../src/modules/billing/quota';
import { decideCanUseAi } from '../src/modules/ai/ai-quota';

const basico: PlanLimits = {
  maxNumbers: 1,
  maxAgents: 2,
  maxFlows: 1,
  includedMessagesMonth: 500,
  includedTemplatesMonth: 0,
  overagePricePerMessage: null,
  overagePricePerTemplate: null,
  hardLimit: true,
  graceDays: 5,
  features: ['flows'],
  aiMonthlyCostCap: 50,
};

/** UsageService.limits com Prisma falso: assinatura do plano básico e, se `dono`, um dono ativo na empresa. */
function usage({ dono, sub = true, status = 'active' }: { dono: boolean; sub?: boolean; status?: string }) {
  const prisma = {
    subscription: { findUnique: async () => (sub ? { planId: 'p1', status, plan: { limits: basico }, tenant: { planOverride: null } } : null) },
    user: { findFirst: async ({ where }: any) => (dono && where.isSystemOwner && where.isActive ? { id: 'u1' } : null) },
  };
  return new UsageService(prisma as never, {} as never, {} as never, {} as never);
}

describe('ownerLimits: empresa de dono do sistema', () => {
  it('todos os recursos, mesmo os que o plano não tem', () => {
    expect(ownerLimits(basico).features).toEqual(PLAN_FEATURES);
  });

  it('nenhum limite de quantidade', () => {
    const l = ownerLimits(basico);
    for (const k of ['maxNumbers', 'maxAgents', 'maxFlows', 'maxQuickReplies', 'maxCompanies'] as const) expect(countLimit(l, k)).toBeNull();
  });

  it('envio sem quota mesmo com hardLimit e uso alto', () => {
    const d = decideCanSend({ limits: ownerLimits(basico), status: 'active' }, { messages: 1_000_000, templates: 10_000, conversations: 50_000 }, 'messages');
    expect(d.ok).toBe(true);
    expect(d.overage).toBeFalsy();
  });

  it('IA liberada, mas o teto de custo do plano continua valendo', () => {
    const plan = { limits: ownerLimits(basico), status: 'active' };
    expect(decideCanUseAi(plan, { interactions: 100_000, costBrl: 10 }).ok).toBe(true);
    expect(decideCanUseAi(plan, { interactions: 1, costBrl: 50 }).ok).toBe(false);
  });

  it('sem assinatura: parte de uma base vazia e libera igual', () => {
    const l = ownerLimits(null);
    expect(l.features).toEqual(PLAN_FEATURES);
    expect(l.maxNumbers).toBeNull();
    expect(l.hardLimit).toBe(false);
  });
});

describe('UsageService.limits', () => {
  it('empresa sem dono: os limites do plano', async () => {
    expect(await usage({ dono: false }).limits('t1')).toEqual({ limits: basico, status: 'active' });
  });

  it('empresa com dono ativo: acesso amplo', async () => {
    const r = await usage({ dono: true }).limits('t1');
    expect(r?.limits.features).toEqual(PLAN_FEATURES);
    expect(r?.limits.maxNumbers).toBeNull();
  });

  it('empresa com dono: assinatura suspensa não trava', async () => {
    expect((await usage({ dono: true, status: 'suspended' }).limits('t1'))?.status).toBe('active');
    expect((await usage({ dono: false, status: 'suspended' }).limits('t1'))?.status).toBe('suspended');
  });

  it('empresa com dono e sem assinatura: acesso amplo; sem dono: nenhum', async () => {
    expect((await usage({ dono: true, sub: false }).limits('t1'))?.limits.features).toEqual(PLAN_FEATURES);
    expect(await usage({ dono: false, sub: false }).limits('t1')).toBeNull();
  });
});
