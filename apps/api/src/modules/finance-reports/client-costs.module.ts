import { BadRequestException, Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { env } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { PartnersModule } from '../partners/partners.module';
import { PartnerCommissionsService } from '../partners/partner-commissions.service';
import { commissionOf } from '@atendo/shared';
import { allocateByRevenue, allocateInfra, marginOf } from '../billing/client-costs';

const cents = (v: number) => Math.round(v * 100) / 100;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** início do mês (Brasília) e início do seguinte — a mesma régua do Fechamento */
function monthRange(period: string) {
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start: new Date(`${period}-01T00:00:00-03:00`), end: new Date(`${next}-01T00:00:00-03:00`) };
}

/**
 * Custo e margem por cliente no mês (docs/36-fechamento-financeiro.md#custo-por-cliente). Tudo sai
 * do que o sistema já registra — nada para digitar por cliente:
 *
 * - **recebido**: faturas pagas no mês + recebimentos por fora com cliente (regime de caixa, igual ao Fechamento);
 * - **infra**: lançado no mês na categoria `infra`, dividido por número de WhatsApp (custo manual do número vale como exceção);
 * - **IA**: ledger `ai_usage` (sem a chave própria do cliente, que ele mesmo paga);
 * - **comissão**: comissões VogoPartner sobre pagamentos do mês (mensalidade ainda não apurada = estimada pela faixa atual);
 * - **impostos** e **taxas de cobrança**: lançados no mês, divididos pelo que cada cliente pagou;
 * - **custo do plano**: o fixo cadastrado no plano;
 * - **Meta**: só informativo — cada cliente paga a Meta direto.
 */
@Injectable()
export class ClientCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissions: PartnerCommissionsService,
  ) {}

  async report(period: string) {
    if (!PERIOD_RE.test(period)) throw new BadRequestException('Mês inválido (AAAA-MM).');
    const { start, end } = monthRange(period);
    const [tenants, numbers, invoices, incomes, expenses, categories, ai, meta, comms, counters] = await Promise.all([
      this.prisma.tenant.findMany({
        select: { id: true, name: true, isActive: true, partner: { select: { id: true, name: true } }, subscription: { select: { status: true, priceMonth: true, units: true, plan: { select: { name: true, priceMonth: true, costMonth: true } } } } },
      }),
      this.prisma.whatsAppNumber.findMany({ select: { tenantId: true, infraCostMonth: true } }),
      this.prisma.invoice.groupBy({ by: ['tenantId'], where: { status: 'paid', paidAt: { gte: start, lt: end } }, _sum: { totalAmount: true } }),
      this.prisma.financeEntry.findMany({ where: { period, kind: 'income', skipped: false, paidAt: { not: null } }, select: { tenantId: true, amount: true } }),
      this.prisma.financeEntry.findMany({ where: { period, kind: 'expense', skipped: false }, select: { category: true, amount: true } }),
      this.prisma.financeCategory.findMany({ select: { id: true, section: true } }),
      this.prisma.aiUsage.groupBy({ by: ['tenantId'], where: { occurredAt: { gte: start, lt: end }, error: null, ownKey: false }, _sum: { costBrl: true } }),
      this.prisma.metaCostDaily.findMany({ where: { day: { gte: new Date(`${period}-01T00:00:00Z`), lt: new Date(end.toISOString().slice(0, 10) + 'T00:00:00Z') } }, select: { tenantId: true, cost: true, currency: true } }),
      this.prisma.partnerCommission.findMany({ where: { paidAt: { gte: start, lt: end }, status: { not: 'reversed' } }, select: { tenantId: true, partnerId: true, kind: true, baseAmount: true, amount: true } }),
      this.prisma.usageCounter.findMany({ where: { period }, select: { tenantId: true, messagesSent: true } }),
    ]);

    // ---- recebido por cliente (caixa) ----
    const received: Record<string, number> = {};
    for (const i of invoices) received[i.tenantId] = (received[i.tenantId] ?? 0) + Number(i._sum.totalAmount ?? 0);
    let otherIncome = 0;
    for (const e of incomes) {
      if (e.tenantId) received[e.tenantId] = (received[e.tenantId] ?? 0) + Number(e.amount);
      else otherIncome += Number(e.amount);
    }
    const clientsIncome = Object.values(received).reduce((s, v) => s + v, 0);

    // ---- gastos do mês lançados no Fechamento ----
    const section = new Map(categories.map((c) => [c.id, c.section]));
    const sum = (f: (cat: string) => boolean) => expenses.filter((e) => f(e.category)).reduce((s, e) => s + Number(e.amount), 0);
    const infraPool = cents(sum((c) => c === 'infra'));
    const taxesTotal = cents(sum((c) => section.get(c) === 'tax'));
    const feesTotal = cents(sum((c) => c === 'taxas'));

    const infra = allocateInfra(infraPool, numbers.map((n) => ({ tenantId: n.tenantId, manual: Number(n.infraCostMonth) })));
    // imposto incide sobre tudo que entrou; taxa de cobrança, só sobre o que veio de cliente
    const taxes = allocateByRevenue(taxesTotal, received, clientsIncome + otherIncome);
    const fees = allocateByRevenue(feesTotal, received, clientsIncome);

    // ---- comissão: apurada vale; mensalidade em aberto = estimativa pela faixa atual do parceiro ----
    const rates = new Map<string, number>();
    for (const pid of new Set(comms.filter((c) => c.amount === null).map((c) => c.partnerId))) rates.set(pid, (await this.commissions.currentRate(pid)).rate);
    const commission: Record<string, number> = {};
    const commissionEstimated = new Set<string>();
    for (const c of comms) {
      const v = c.amount !== null ? Number(c.amount) : commissionOf(Number(c.baseAmount), rates.get(c.partnerId) ?? 0);
      if (c.amount === null) commissionEstimated.add(c.tenantId);
      commission[c.tenantId] = (commission[c.tenantId] ?? 0) + v;
    }

    const aiCost = new Map(ai.map((a) => [a.tenantId, Number(a._sum.costBrl ?? 0)]));
    const metaCost: Record<string, number> = {};
    for (const m of meta) metaCost[m.tenantId] = (metaCost[m.tenantId] ?? 0) + Number(m.cost) * (m.currency === 'USD' ? env.USD_BRL_RATE : 1);
    const msgs = new Map(counters.map((c) => [c.tenantId, c.messagesSent]));
    const numCount: Record<string, number> = {};
    const manualInfra = new Set<string>();
    for (const n of numbers) {
      numCount[n.tenantId] = (numCount[n.tenantId] ?? 0) + 1;
      if (Number(n.infraCostMonth) > 0) manualInfra.add(n.tenantId);
    }

    const rows = tenants
      .map((t) => {
        const s = t.subscription;
        const contracted = s ? cents((Number(s.priceMonth ?? 0) > 0 ? Number(s.priceMonth) : Number(s.plan.priceMonth)) * Math.max(1, s.units)) : 0;
        const live = !!s && ['active', 'trialing', 'past_due'].includes(s.status);
        const base = {
          received: cents(received[t.id] ?? 0),
          infra: infra.byTenant[t.id] ?? 0,
          ai: cents(aiCost.get(t.id) ?? 0),
          commission: cents(commission[t.id] ?? 0),
          taxes: taxes[t.id] ?? 0,
          fees: fees[t.id] ?? 0,
          // custo fixo do plano só para quem está com o plano em uso no mês
          planCost: live ? cents(Number(s!.plan.costMonth)) : 0,
        };
        return {
          tenantId: t.id,
          name: t.name,
          isActive: t.isActive,
          plan: s?.plan.name ?? null,
          status: s?.status ?? null,
          partner: t.partner?.name ?? null,
          numbers: numCount[t.id] ?? 0,
          messagesSent: msgs.get(t.id) ?? 0,
          contracted,
          ...base,
          ...marginOf(base),
          metaInfo: cents(metaCost[t.id] ?? 0),
          commissionEstimated: commissionEstimated.has(t.id),
          infraManual: manualInfra.has(t.id),
        };
      })
      // fica quem teve alguma coisa no mês: plano em uso, dinheiro ou custo
      .filter((r) => (r.status && ['active', 'trialing', 'past_due'].includes(r.status)) || r.received > 0 || r.cost > 0)
      .sort((a, b) => a.margin - b.margin);

    const tot = (k: 'received' | 'infra' | 'ai' | 'commission' | 'taxes' | 'fees' | 'planCost' | 'cost' | 'margin' | 'metaInfo') => cents(rows.reduce((s, r) => s + r[k], 0));
    const generalExpenses = cents(expenses.reduce((s, e) => s + Number(e.amount), 0) - infraPool - taxesTotal - feesTotal);
    return {
      period,
      rows,
      totals: { received: tot('received'), infra: tot('infra'), ai: tot('ai'), commission: tot('commission'), taxes: tot('taxes'), fees: tot('fees'), planCost: tot('planCost'), cost: tot('cost'), margin: tot('margin'), metaInfo: tot('metaInfo') },
      pools: {
        infra: infraPool,
        infraPerNumber: infra.perNumber,
        taxes: taxesTotal,
        fees: feesTotal,
        otherIncome: cents(otherIncome),
        /** despesas, folha, pró-labore e custos fora de infra/taxas: não são de um cliente — pagos pelo resultado de todos */
        generalExpenses,
      },
    };
  }
}

@Controller('billing/client-costs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
@NoTenantOk()
class ClientCostsController {
  constructor(private readonly costs: ClientCostsService) {}

  @Get()
  report(@Query('period') period: string) {
    return this.costs.report(period);
  }
}

/** Custo e margem por cliente (dono do sistema). */
@Module({
  imports: [AuthModule, PartnersModule],
  controllers: [ClientCostsController],
  providers: [ClientCostsService],
})
export class ClientCostsModule {}
