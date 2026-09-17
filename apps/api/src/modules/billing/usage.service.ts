import { Injectable, Logger } from '@nestjs/common';
import { BillingCategory, MessageDirection, WhatsAppProvider as ProviderKind } from '@prisma/client';
import { USAGE_ALERT_THRESHOLDS, type PlanLimits } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { PricingService } from './pricing.service';

export const periodOf = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const key = (tenantId: string, period: string, metric: string) => `usage:${tenantId}:${period}:${metric}`;

/**
 * Ledger (Postgres) é a fonte da verdade. Redis é o contador rápido lido no QuotaGuard.
 * `reconcile()` recalcula Redis + usage_counters a partir do ledger.
 */
@Injectable()
export class UsageService {
  private readonly log = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly pricing: PricingService,
  ) {}

  async record(input: {
    tenantId: string;
    numberId: string;
    messageId: string;
    provider: ProviderKind;
    direction: MessageDirection;
    billingCategory: BillingCategory;
  }) {
    // Idempotente: uma mensagem só entra no ledger uma vez (retry/reenvio não pode contar de novo)
    const exists = await this.prisma.messageUsage.findUnique({ where: { messageId: input.messageId }, select: { id: true } });
    if (exists) return;
    const providerCost = await this.pricing.unitCost(input.provider, input.billingCategory);
    await this.prisma.messageUsage.create({ data: { ...input, providerCost } });

    const period = periodOf();
    const isTemplate = input.direction === 'out' && !['service', 'unofficial'].includes(input.billingCategory);
    const multi = this.redis.multi();
    if (input.direction === 'out') multi.incr(key(input.tenantId, period, 'messages'));
    else multi.incr(key(input.tenantId, period, 'messagesIn'));
    if (isTemplate) multi.incr(key(input.tenantId, period, 'templates'));
    await multi.exec();

    if (input.direction === 'out') await this.checkAlerts(input.tenantId, period);
  }

  async current(tenantId: string, period = periodOf()) {
    const [messages, templates] = await this.redis.mget(key(tenantId, period, 'messages'), key(tenantId, period, 'templates'));
    return { messages: Number(messages ?? 0), templates: Number(templates ?? 0) };
  }

  async limits(tenantId: string): Promise<{ limits: PlanLimits; status: string } | null> {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub) return null;
    return { limits: sub.plan.limits as unknown as PlanLimits, status: sub.status };
  }

  /** Verifica se o tenant pode enviar mais uma mensagem/template. */
  async canSend(tenantId: string, kind: 'messages' | 'templates'): Promise<{ ok: boolean; reason?: string }> {
    const plan = await this.limits(tenantId);
    if (!plan) return { ok: false, reason: 'Sem assinatura ativa' };
    if (plan.status === 'suspended' || plan.status === 'canceled') return { ok: false, reason: 'Assinatura suspensa' };

    const used = await this.current(tenantId);
    const included = kind === 'messages' ? plan.limits.includedMessagesMonth : plan.limits.includedTemplatesMonth;
    const overage = kind === 'messages' ? plan.limits.overagePricePerMessage : plan.limits.overagePricePerTemplate;

    if (used[kind] < included) return { ok: true };
    if (!plan.limits.hardLimit && overage !== null) return { ok: true }; // cobra excedente
    return { ok: false, reason: `Limite de ${kind === 'messages' ? 'mensagens' : 'templates'} do plano atingido (${included}/mês)` };
  }

  private async checkAlerts(tenantId: string, period: string) {
    const plan = await this.limits(tenantId);
    if (!plan) return;
    const used = await this.current(tenantId, period);
    for (const metric of ['messages', 'templates'] as const) {
      const included = metric === 'messages' ? plan.limits.includedMessagesMonth : plan.limits.includedTemplatesMonth;
      if (!included) continue;
      const ratio = used[metric] / included;
      for (const threshold of USAGE_ALERT_THRESHOLDS) {
        if (ratio < threshold) continue;
        const created = await this.prisma.usageAlert
          .create({ data: { tenantId, period, metric, threshold } })
          .catch(() => null); // unique => já enviado
        if (created) this.log.warn(`[alerta] tenant ${tenantId} atingiu ${threshold * 100}% de ${metric}`); // TODO: e-mail + evento no painel
      }
    }
  }

  /** Job diário: ledger -> usage_counters + Redis. */
  async reconcile(period = periodOf()) {
    const [y, m] = period.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const rows = await this.prisma.messageUsage.groupBy({
      by: ['tenantId', 'direction', 'billingCategory'],
      where: { occurredAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { providerCost: true },
    });
    const byTenant = new Map<string, { sent: number; in: number; templates: number; cost: number }>();
    for (const r of rows) {
      const t = byTenant.get(r.tenantId) ?? { sent: 0, in: 0, templates: 0, cost: 0 };
      if (r.direction === 'out') {
        t.sent += r._count._all;
        if (!['service', 'unofficial'].includes(r.billingCategory)) t.templates += r._count._all;
      } else t.in += r._count._all;
      t.cost += Number(r._sum.providerCost ?? 0);
      byTenant.set(r.tenantId, t);
    }
    for (const [tenantId, t] of byTenant) {
      const plan = await this.limits(tenantId);
      const L = plan?.limits;
      const overMsgs = L ? Math.max(0, t.sent - L.includedMessagesMonth) * (L.overagePricePerMessage ?? 0) : 0;
      const overTpl = L ? Math.max(0, t.templates - L.includedTemplatesMonth) * (L.overagePricePerTemplate ?? 0) : 0;
      await this.prisma.usageCounter.upsert({
        where: { tenantId_period: { tenantId, period } },
        create: { tenantId, period, messagesSent: t.sent, messagesIn: t.in, templatesSent: t.templates, providerCost: t.cost, overageAmount: overMsgs + overTpl },
        update: { messagesSent: t.sent, messagesIn: t.in, templatesSent: t.templates, providerCost: t.cost, overageAmount: overMsgs + overTpl, reconciledAt: new Date() },
      });
      await this.redis.mset(
        key(tenantId, period, 'messages'), t.sent,
        key(tenantId, period, 'messagesIn'), t.in,
        key(tenantId, period, 'templates'), t.templates,
      );
    }
    this.log.log(`Reconciliado ${byTenant.size} tenants para ${period}`);
  }
}
