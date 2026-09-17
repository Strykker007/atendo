import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // ---- Planos (limits = PlanLimits em packages/shared) ----
  const plans = [
    {
      name: 'Starter',
      priceMonth: 97,
      billingModel: 'fixed' as const,
      limits: { maxNumbers: 1, maxAgents: 2, includedMessagesMonth: 2000, includedTemplatesMonth: 100, overagePricePerMessage: null, overagePricePerTemplate: null, hardLimit: true, graceDays: 5 },
    },
    {
      name: 'Pro',
      priceMonth: 247,
      billingModel: 'hybrid' as const,
      limits: { maxNumbers: 3, maxAgents: 6, includedMessagesMonth: 10000, includedTemplatesMonth: 500, overagePricePerMessage: 0.02, overagePricePerTemplate: 0.6, hardLimit: false, graceDays: 7, features: ['flows'] },
    },
    {
      name: 'Business',
      priceMonth: 597,
      billingModel: 'hybrid' as const,
      limits: { maxNumbers: 10, maxAgents: 20, includedMessagesMonth: 50000, includedTemplatesMonth: 2000, overagePricePerMessage: 0.015, overagePricePerTemplate: 0.5, hardLimit: false, graceDays: 10, features: ['flows'] },
    },
  ];
  for (const p of plans) await prisma.plan.upsert({ where: { name: p.name }, create: p, update: { priceMonth: p.priceMonth, limits: p.limits, billingModel: p.billingModel } });

  // ---- Preços Meta BR (BRL/mensagem) — ajuste aqui quando a Meta reajustar ----
  const validFrom = new Date('2025-07-01');
  const pricing = [
    { category: 'marketing' as const, unitPrice: 0.625 },
    { category: 'utility' as const, unitPrice: 0.08 },
    { category: 'authentication' as const, unitPrice: 0.0315 },
  ];
  for (const p of pricing) {
    const exists = await prisma.providerPricing.findFirst({ where: { provider: 'meta', country: 'BR', category: p.category, validFrom } });
    if (!exists) await prisma.providerPricing.create({ data: { provider: 'meta', country: 'BR', currency: 'BRL', validFrom, ...p } });
  }

  // ---- Super admin (dono do Atendo) ----
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@atendo.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';
  await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Super Admin', role: 'super_admin', passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
    update: {},
  });

  // ---- Tenant demo com admin, tags e respostas rápidas ----
  const starter = await prisma.plan.findUniqueOrThrow({ where: { name: 'Pro' } });
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 1);
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    create: {
      name: 'Loja Demo',
      slug: 'demo',
      subscription: { create: { planId: starter.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: end } },
      users: { create: { email: 'demo@atendo.local', name: 'Admin Demo', role: 'tenant_admin', passwordHash: await argon2.hash('demo12345', { type: argon2.argon2id }) } },
      tags: { createMany: { data: [
        { name: 'lead com interesse', color: '#22c55e' },
        { name: 'procurando ofertas', color: '#f59e0b' },
        { name: 'comprador recorrente', color: '#6366f1' },
      ] } },
      folders: { create: { name: 'Saudações', replies: { createMany: { data: [
        { title: 'Boas-vindas', body: 'Olá {{contact.name}}! Aqui é {{agent.name}}. Como posso ajudar?', position: 0 },
        { title: 'Encerramento', body: 'Obrigado pelo contato! Qualquer coisa é só chamar. 😊', position: 1 },
      ] } } } },
    },
    update: {},
  });

  console.log(`Seed ok. super_admin: ${email} / ${password} — tenant demo: demo@atendo.local / demo12345 (${tenant.slug})`);
}

main().finally(() => prisma.$disconnect());
