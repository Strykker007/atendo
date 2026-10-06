import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { periodOf } from './usage.service';

/**
 * Relatório financeiro do dono do Atendo (super_admin).
 * Tudo sai de: subscriptions/plans (MRR), invoices (faturado/recebido/atrasado), usage_counters (custo, excedente).
 */
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private periods(months: number) {
    const out: string[] = [];
    const d = new Date();
    for (let i = months - 1; i >= 0; i--) out.push(periodOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))));
    return out;
  }

  async overview(months = 12) {
    const periods = this.periods(months);
    const [subs, invoices, counters, tenants] = await Promise.all([
      this.prisma.subscription.findMany({ include: { plan: true, tenant: { select: { name: true } } } }),
      this.prisma.invoice.findMany({ where: { period: { in: periods } }, include: { tenant: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.usageCounter.findMany({ where: { period: { in: periods } } }),
      this.prisma.tenant.findMany({ select: { id: true, createdAt: true, numbers: { select: { infraCostMonth: true } } } }),
    ]);

    const infraTotal = tenants.reduce((a, t) => a + t.numbers.reduce((b, n) => b + Number(n.infraCostMonth), 0), 0);

    // série mensal
    const series = periods.map((period) => {
      const inv = invoices.filter((i) => i.period === period);
      const cnt = counters.filter((c) => c.period === period);
      const [y, m] = period.split('-').map(Number);
      const monthEnd = new Date(Date.UTC(y, m, 1));
      const monthStart = new Date(Date.UTC(y, m - 1, 1));
      const newTenants = tenants.filter((t) => t.createdAt >= monthStart && t.createdAt < monthEnd).length;
      const canceled = subs.filter((s) => s.canceledAt && s.canceledAt >= monthStart && s.canceledAt < monthEnd).length;
      return {
        period,
        invoiced: inv.filter((i) => i.status !== 'void' && i.status !== 'draft').reduce((a, i) => a + Number(i.totalAmount), 0),
        received: inv.filter((i) => i.status === 'paid').reduce((a, i) => a + Number(i.totalAmount), 0),
        overdue: inv.filter((i) => i.status === 'failed' || (i.status === 'open' && i.dueAt && i.dueAt < new Date())).reduce((a, i) => a + Number(i.totalAmount), 0),
        overage: cnt.reduce((a, c) => a + Number(c.overageAmount), 0),
        providerCost: cnt.reduce((a, c) => a + Number(c.providerCost), 0),
        infraCost: period === periodOf() ? infraTotal : infraTotal, // rateio fixo por mês (aproximação)
        messagesSent: cnt.reduce((a, c) => a + c.messagesSent, 0),
        newTenants,
        canceled,
      };
    });

    // agora
    const active = subs.filter((s) => ['active', 'trialing', 'past_due'].includes(s.status));
    // pagante = ativa/pendente, ou ainda `trialing` no banco mas com fatura paga de verdade —
    // o webhook que tiraria do teste pode ter se perdido, e o dinheiro já entrou
    const paidTenants = new Set(invoices.filter((i) => i.status === 'paid' && Number(i.totalAmount) > 0).map((i) => i.tenantId));
    const paying = (s: (typeof subs)[number]) => s.status !== 'trialing' || paidTenants.has(s.tenantId);
    // o preço contratado manda sobre o de tabela: cliente congelado num preço antigo rende o
    // que ele paga, não o que o plano custa hoje — somar o do catálogo inflaria o MRR.
    // Contratado zerado em plano pago é resto de plano gratuito/cadastro, não preço: usa o do plano
    const price = (s: (typeof subs)[number]) => Number(s.priceMonth ?? 0) > 0 ? Number(s.priceMonth) : Number(s.plan.priceMonth);
    const mrr = active.filter(paying).reduce((a, s) => a + price(s), 0);
    const byPlan = Object.values(
      active.reduce<Record<string, { plan: string; count: number; trialing: number; mrr: number; cost: number; margin: number }>>((acc, s) => {
        const k = s.plan.name;
        acc[k] ??= { plan: k, count: 0, trialing: 0, mrr: 0, cost: 0, margin: 0 };
        acc[k].count++;
        // o custo conta inclusive em teste: cliente em trial consome suporte e infra do mesmo
        // jeito, e esconder isso faria o período de teste parecer de graça
        acc[k].cost += Number(s.plan.costMonth);
        if (paying(s)) acc[k].mrr += price(s);
        else acc[k].trialing++;
        acc[k].margin = acc[k].mrr - acc[k].cost;
        return acc;
      }, {}),
    );
    /** custo fixo cadastrado nos planos, somado por cliente ativo */
    const planCost = active.reduce((a, s) => a + Number(s.plan.costMonth), 0);
    const current = series[series.length - 1];
    const statusCount = subs.reduce<Record<string, number>>((acc, s) => ((acc[s.status] = (acc[s.status] ?? 0) + 1), acc), {});

    return {
      now: {
        mrr,
        arr: mrr * 12,
        activeTenants: active.length,
        trialing: statusCount.trialing ?? 0,
        pastDue: statusCount.past_due ?? 0,
        suspended: statusCount.suspended ?? 0,
        canceled: statusCount.canceled ?? 0,
        overdueAmount: invoices.filter((i) => i.status === 'failed' || (i.status === 'open' && i.dueAt && i.dueAt < new Date())).reduce((a, i) => a + Number(i.totalAmount), 0),
        monthCost: current.providerCost + current.infraCost + planCost,
        planCost,
        monthMargin: mrr + current.overage - (current.providerCost + current.infraCost + planCost),
      },
      byPlan,
      series,
      invoices: invoices.slice(0, 100).map((i) => ({ id: i.id, tenant: i.tenant.name, period: i.period, total: Number(i.totalAmount), overage: Number(i.overageAmount), status: i.status, dueAt: i.dueAt, paidAt: i.paidAt, hostedUrl: i.hostedUrl })),
      subscriptions: subs.map((s) => ({ tenant: s.tenant.name, plan: s.plan.name, price: price(s), status: s.status, periodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd, graceUntil: s.graceUntil })),
    };
  }
}
