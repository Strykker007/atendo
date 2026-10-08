import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AsaasService, BULK_REF, chargeOf, type AsaasPayment } from './asaas.service';
import { amountOf, daysUntil, dueState, endOfMonthBrt, groupUnits, payableUntil, round2, type ConsolidatedItem, type DueCycle, type DueState } from './dues';
import { periodOf } from './usage.service';

/** Uma linha do painel de vencimentos: a assinatura do grupo, uma empresa do grupo ou uma empresa com assinatura própria. */
export interface DueRow {
  key: string;
  kind: 'group' | 'member' | 'company';
  companyId: string | null;
  name: string;
  plan: string | null;
  cycle: DueCycle | null;
  status: SubscriptionStatus | null;
  state: DueState | null;
  daysToDue: number | null;
  /** valor do ciclo (no `member`, a parte dele no grupo — só informativa) */
  amount: number;
  dueDate: string | null;
  /** grupo consolidado: quantas unidades a assinatura cobra */
  units: number;
  payable: boolean;
  /** por que não dá para pagar aqui (cartão automático, plano gratuito…) */
  reason: string | null;
  /** cobrança consolidada já emitida e ainda em aberto que cobre esta linha */
  openChargeId: string | null;
  /** interno: cobrança da assinatura do Asaas que o "Pagar todos" substitui */
  replacesPaymentId?: string | null;
}

const LIVE: SubscriptionStatus[] = ['active', 'past_due', 'trialing', 'suspended'];
const ymd = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
const fromYmd = (s: string) => new Date(`${s}T00:00:00-03:00`);
const cycleOf = (c: string): DueCycle | null => (c === 'monthly' || c === 'yearly' ? c : null);

/**
 * Faturamento híbrido e painel de vencimentos (docs/empresas.md#cobrança).
 *
 * - Grupo (`tenants.billingType = CONSOLIDATED_GROUP`): a assinatura do cliente cobra o plano ×
 *   empresas ativas que herdam (`subscriptions.units`), mantido aqui e propagado ao Asaas.
 * - Empresa INDIVIDUAL: assinatura própria (`company_subscriptions`), paga por cobrança avulsa.
 * - "Pagar todos": uma cobrança única do Asaas (boleto/PIX) que quita as linhas escolhidas.
 */
@Injectable()
export class DuesService {
  private readonly log = new Logger(DuesService.name);

  constructor(private readonly prisma: PrismaService, private readonly asaas: AsaasService) {}

  /**
   * Recalcula as unidades do grupo e leva o valor novo para a assinatura do Asaas (próximas
   * cobranças; a já emitida não muda). Falha no Asaas não grava local — a próxima chamada (ou
   * o job diário) tenta de novo, em vez de o banco dizer N unidades e o Asaas cobrar outra coisa.
   */
  async syncGroupUnits(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { billingType: true, subscription: { include: { plan: true } }, companies: { select: { billingType: true, isActive: true } } },
    });
    const sub = t?.subscription;
    if (!t || !sub) return;
    const units = groupUnits(t.billingType, t.companies);
    if (units === sub.units) return;
    if (sub.gateway === 'asaas' && sub.externalId && LIVE.includes(sub.status)) {
      const unit = sub.priceMonth !== null && Number(sub.priceMonth) > 0 ? { ...sub.plan, priceMonth: sub.priceMonth } : sub.plan;
      try {
        await this.asaas.updateSubscriptionValue(sub.externalId, chargeOf(unit, units).value);
      } catch (err) {
        this.log.error(`tenant ${tenantId}: unidades ${sub.units} → ${units} não chegaram ao Asaas: ${(err as Error)?.message ?? err}`);
        return;
      }
    }
    await this.prisma.subscription.update({ where: { tenantId }, data: { units } });
    this.log.log(`tenant ${tenantId}: assinatura do grupo passa a cobrar ${units} unidade(s)`);
  }

  /** Job diário: corrige grupos cuja sincronização com o Asaas falhou. */
  async syncAllGroups() {
    const tenants = await this.prisma.tenant.findMany({ where: { OR: [{ billingType: 'CONSOLIDATED_GROUP' }, { subscription: { units: { gt: 1 } } }] }, select: { id: true } });
    for (const t of tenants) await this.syncGroupUnits(t.id).catch((err) => this.log.error(`sync do grupo ${t.id}: ${err?.message ?? err}`));
  }

  /** O painel: linhas + resumo. */
  async list(tenantId: string) {
    const { _rows, ...view } = await this.build(tenantId);
    return view;
  }

  private async build(tenantId: string) {
    const now = new Date();
    const limit = payableUntil(now);
    const [tenant, open] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          name: true, billingType: true,
          subscription: { include: { plan: true } },
          companies: { orderBy: { name: 'asc' }, select: { id: true, name: true, billingType: true, isActive: true, subscription: { include: { plan: true } } } },
        },
      }),
      this.prisma.invoice.findMany({ where: { tenantId, status: 'open', items: { not: Prisma.DbNull } }, select: { externalId: true, items: true } }),
    ]);
    const openByKey = new Map<string, string>();
    for (const inv of open) for (const it of (inv.items ?? []) as unknown as ConsolidatedItem[]) if (inv.externalId) openByKey.set(it.key, inv.externalId);
    const online = this.asaas.enabled;
    const rows: DueRow[] = [];

    const sub = tenant.subscription;
    if (sub) {
      const cycle = cycleOf(sub.plan.billingCycle);
      const unit = Number(sub.priceMonth ?? 0) > 0 ? Number(sub.priceMonth) : Number(sub.plan.priceMonth);
      let amount = cycle ? amountOf(unit, cycle, sub.units) : 0;
      let due = sub.currentPeriodEnd;
      let reason: string | null = null;
      let replaces: string | null = null;
      if (sub.plan.isFree) reason = 'Plano gratuito';
      else if (!cycle) reason = 'Plano personalizado: cobrado à parte';
      else if (sub.status === 'canceled') reason = 'Assinatura cancelada';
      else if (!online) reason = 'Cobrança online não configurada';
      else if (sub.gateway === 'stripe') reason = 'Cobrada no cartão internacional — pague em “Pagamento e faturas”';
      else if (sub.gateway === 'asaas' && sub.externalId) {
        // a assinatura do Asaas já gera a cobrança do ciclo: o painel mostra e paga essa
        const p = await this.asaas.openSubscriptionPayment(sub.externalId).catch(() => null);
        if (!p) reason = 'Nada em aberto';
        else if (p.billingType === 'CREDIT_CARD') reason = 'Debitada no cartão automaticamente';
        else { amount = round2(p.value); due = fromYmd(p.dueDate); replaces = p.id; }
      } else if (due > limit) reason = 'Ainda não venceu';
      const free = sub.plan.isFree;
      rows.push({
        key: 'group', kind: 'group', companyId: null, name: tenant.name, plan: sub.plan.name, cycle, status: sub.status,
        state: free ? 'free' : dueState(due, now), daysToDue: free ? null : daysUntil(due, now), amount, dueDate: free ? null : due.toISOString(),
        units: sub.units, payable: !reason, reason, openChargeId: openByKey.get('group') ?? null, replacesPaymentId: replaces,
      });
      // empresas que herdam a assinatura: aparecem no painel, mas pagam junto com o grupo
      const members = tenant.companies.filter((c) => c.isActive && c.billingType === 'CONSOLIDATED_GROUP');
      const share = tenant.billingType === 'CONSOLIDATED_GROUP' && cycle ? amountOf(unit, cycle) : 0;
      for (const c of members) {
        rows.push({
          key: `member:${c.id}`, kind: 'member', companyId: c.id, name: c.name, plan: sub.plan.name, cycle, status: sub.status,
          state: free ? 'free' : dueState(due, now), daysToDue: free ? null : daysUntil(due, now), amount: share, dueDate: free ? null : due.toISOString(),
          units: 1, payable: false, reason: 'Incluída na assinatura do grupo', openChargeId: null,
        });
      }
    }

    for (const c of tenant.companies.filter((x) => x.isActive && x.billingType === 'INDIVIDUAL')) {
      const cs = c.subscription;
      const key = `company:${c.id}`;
      if (!cs) {
        rows.push({ key, kind: 'company', companyId: c.id, name: c.name, plan: null, cycle: null, status: null, state: null, daysToDue: null, amount: 0, dueDate: null, units: 1, payable: false, reason: 'Sem assinatura — fale com o suporte', openChargeId: null });
        continue;
      }
      const cycle = cycleOf(cs.plan.billingCycle);
      const unit = cs.priceMonth !== null ? Number(cs.priceMonth) : Number(cs.plan.priceMonth);
      const amount = cycle ? amountOf(unit, cycle) : 0;
      const free = cs.plan.isFree || (cycle !== null && amount <= 0);
      let reason: string | null = null;
      if (free) reason = 'Plano gratuito';
      else if (!cycle) reason = 'Plano personalizado: cobrado à parte';
      else if (cs.status === 'canceled') reason = 'Assinatura cancelada';
      else if (!online) reason = 'Cobrança online não configurada';
      else if (cs.currentPeriodEnd > limit) reason = 'Ainda não venceu';
      rows.push({
        key, kind: 'company', companyId: c.id, name: c.name, plan: cs.plan.name, cycle, status: cs.status,
        state: free ? 'free' : dueState(cs.currentPeriodEnd, now), daysToDue: free ? null : daysUntil(cs.currentPeriodEnd, now), amount,
        dueDate: free ? null : cs.currentPeriodEnd.toISOString(), units: 1, payable: !reason, reason, openChargeId: openByKey.get(key) ?? null,
      });
    }

    // resumo: o que vence até o fim do mês (atrasado incluso) e o próximo vencimento
    const monthEnd = endOfMonthBrt(now);
    const billable = rows.filter((r) => r.kind !== 'member' && r.dueDate && r.state !== 'free' && r.status !== 'canceled' && r.cycle);
    const dueThisMonth = billable.filter((r) => new Date(r.dueDate!) <= monthEnd);
    const upcoming = billable.filter((r) => new Date(r.dueDate!) >= now).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0] ?? null;
    const overdue = billable.filter((r) => r.state === 'overdue');
    return {
      billingType: tenant.billingType,
      online,
      summary: {
        totalMonth: round2(dueThisMonth.reduce((a, r) => a + r.amount, 0)),
        overdueCount: overdue.length,
        overdueAmount: round2(overdue.reduce((a, r) => a + r.amount, 0)),
        nextDue: upcoming && { name: upcoming.name, dueDate: upcoming.dueDate!, amount: upcoming.amount, daysToDue: upcoming.daysToDue },
      },
      rows: rows.map(({ replacesPaymentId: _r, ...r }) => r),
      /** interno: o pagar precisa do id da cobrança substituída */
      _rows: rows,
    };
  }

  /**
   * "Pagar todos": uma cobrança única no Asaas (boleto ou PIX) para as linhas escolhidas. Os
   * valores são recalculados aqui — o que vem do navegador é só a lista de chaves.
   */
  async payBulk(tenantId: string, keys: string[], cpfCnpj?: string): Promise<{ payment: Awaited<ReturnType<AsaasService['view']>> }> {
    if (!this.asaas.enabled) throw new BadRequestException('Cobrança online não configurada. Fale com o suporte.');
    const wanted = [...new Set(keys)];
    const { _rows } = await this.build(tenantId);
    const sel = _rows.filter((r) => wanted.includes(r.key));
    if (!sel.length || sel.length !== wanted.length) throw new BadRequestException('Algum vencimento escolhido não foi encontrado. Atualize a tela.');
    const blocked = sel.find((r) => !r.payable);
    if (blocked) throw new BadRequestException(`${blocked.name}: ${blocked.reason ?? 'não pode ser paga aqui'}`);
    const total = round2(sel.reduce((a, r) => a + r.amount, 0));
    if (total <= 0) throw new BadRequestException('Nada a pagar nos itens escolhidos.');

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { asaasCustomerId: true, document: true, legalName: true, name: true } });
    const doc = cpfCnpj?.replace(/\D/g, '') || null;
    let customer = tenant.asaasCustomerId;
    if (doc || !customer) {
      const cpf = doc ?? tenant.document;
      if (!cpf) throw new BadRequestException({ code: 'document_required', message: 'Informe o CPF ou CNPJ de quem paga para emitir a cobrança.' });
      customer = await this.asaas.createOrUpdateCustomer(tenantId, { cpfCnpj: cpf, name: tenant.legalName ?? tenant.name });
    }

    // cobrança consolidada anterior ainda aberta cobrindo alguma destas linhas: cancela, senão
    // o cliente teria duas cobranças em aberto para o mesmo vencimento
    const prev = await this.prisma.invoice.findMany({ where: { tenantId, status: 'open', externalId: { not: null }, items: { not: Prisma.DbNull } } });
    for (const inv of prev) {
      const its = (inv.items ?? []) as unknown as ConsolidatedItem[];
      if (!its.some((i) => wanted.includes(i.key))) continue;
      await this.asaas.deletePayment(inv.externalId!);
      await this.prisma.invoice.update({ where: { id: inv.id }, data: { status: 'void' } });
    }

    const items: ConsolidatedItem[] = sel.map((r) => ({
      key: r.key, kind: r.kind === 'company' ? 'company' : 'group', companyId: r.kind === 'company' ? r.companyId : null,
      label: r.name, amount: r.amount, cycle: r.cycle as DueCycle, replacesPaymentId: r.replacesPaymentId ?? null,
    }));
    // vence no primeiro vencimento escolhido, nunca antes de hoje (boleto não aceita data passada)
    const today = ymd(new Date());
    const first = sel.map((r) => ymd(new Date(r.dueDate!))).sort()[0];
    const dueDate = first > today ? first : today;
    const description = sel.length === 1 ? `Atendo — ${sel[0].name}` : `Atendo — vencimentos de ${sel.length} unidades: ${sel.map((r) => r.name).join(', ')}`.slice(0, 500);
    const charge = await this.asaas.createCharge({ customer, value: total, dueDate, description, externalReference: `${BULK_REF}${tenantId}:${randomUUID()}` });
    // o webhook PAYMENT_CREATED pode ter espelhado antes: upsert, e os itens entram nos dois casos
    await this.prisma.invoice.upsert({
      where: { externalId: charge.id },
      create: { tenantId, period: periodOf(fromYmd(charge.dueDate)), externalId: charge.id, baseAmount: total, totalAmount: total, status: 'open', hostedUrl: charge.invoiceUrl ?? null, dueAt: fromYmd(charge.dueDate), items: items as unknown as Prisma.InputJsonValue },
      update: { items: items as unknown as Prisma.InputJsonValue },
    });

    // a cobrança do ciclo gerada pela assinatura do Asaas vira parte desta: apaga a original,
    // senão o cliente pagaria o grupo duas vezes. Se não der, desfaz a consolidada.
    for (const it of items.filter((i) => i.replacesPaymentId)) {
      try {
        await this.asaas.deletePayment(it.replacesPaymentId!);
      } catch (err) {
        await this.asaas.deletePayment(charge.id).catch(() => undefined);
        await this.prisma.invoice.update({ where: { externalId: charge.id }, data: { status: 'void' } });
        throw err;
      }
    }
    this.log.log(`cobrança consolidada ${charge.id} tenant ${tenantId}: ${items.length} item(ns), R$ ${total}`);
    return { payment: await this.asaas.view(tenantId, charge as AsaasPayment, true) };
  }
}
