import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { FINANCE_FREQUENCY_MONTHS, FINANCE_SECTIONS, financeKindOf, type FinanceFrequency, type FinanceSection } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { chargeOf, contractedCharge } from './asaas.service';
import { nextPeriodEnd } from './dues';
import { diaSP } from './monthly-billing';

const DAY = 86_400_000;
const cents = (v: number) => Math.round(v * 100) / 100;
/** `AAAA-MM` no fuso de Brasília */
const periodSP = (d = new Date()) => diaSP(d).slice(0, 7);
/** início do mês (Brasília) e início do seguinte */
function monthRange(period: string) {
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start: new Date(`${period}-01T00:00:00-03:00`), end: new Date(`${next}-01T00:00:00-03:00`) };
}
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** mês anterior (`AAAA-MM`) */
function prevPeriod(period: string) {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
const mesBR = (p: string) => p.split('-').reverse().join('/');
/** `AAAA-MM` somado de n meses */
function addMonths(period: string, n: number) {
  const [y, m] = period.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
/** dia do mês ao meio-dia de Brasília; dia 31 em fevereiro vira o último dia */
function dateIn(period: string, day: number) {
  const [y, m] = period.split('-').map(Number);
  const d = Math.min(Math.max(1, day), new Date(y, m, 0).getDate());
  return new Date(`${period}-${String(d).padStart(2, '0')}T12:00:00-03:00`);
}
const noon = (ymd: string) => new Date(`${ymd}T12:00:00-03:00`);

type EntryWithRefs = Prisma.FinanceEntryGetPayload<{ include: { tenant: { select: { name: true } }; supplier: { select: { name: true } } } }>;
export interface EntryDto {
  category: string; description: string; amount: number;
  /** vencimento (saída) ou dia do recebimento (entrada) */
  date: string;
  /** competência `AAAA-MM`; padrão = mês do `date` */
  period?: string;
  /** pago/recebido em; ausente = em aberto */
  paidAt?: string | null;
  paymentMethod?: string | null; documentNumber?: string | null; notes?: string | null; supplierId?: string | null;
  /** parcelas (cada uma com o `amount`), mês a mês */
  installments?: number;
}

export type ReceivableOrigin = 'asaas' | 'stripe' | 'manual' | 'ativacao';
export interface ReceivableRow {
  key: string;
  tenantId: string;
  tenant: string;
  origin: ReceivableOrigin;
  dueDate: string;
  amount: number;
  status: 'paid' | 'open' | 'overdue';
  paidAt: string | null;
  /** link de pagamento do Asaas/Stripe */
  hostedUrl: string | null;
  /** situação da assinatura (para o atraso: pendente, suspensa…) */
  subscriptionStatus: string | null;
  daysLate: number;
  contact: { name: string | null; phone: string | null; email: string | null };
  /** recebimento por fora pode ser registrado (assinatura sem gateway) */
  canReceive: boolean;
}

export interface PayoutRow { partnerId: string; name: string; percent: number; amount: number; pixKey: string | null; paidAt: string | null }
export interface ClosingSummary {
  receivedClients: number;
  otherIncome: number;
  taxes: number;
  /** custos do serviço (infra, Meta, taxas de cobrança) */
  costs: number;
  /** despesas (ferramentas, marketing, contador…) */
  expenses: number;
  payroll: number;
  prolabore: number;
  result: number;
  reservePercent: number;
  reserve: number;
  distributable: number;
  /** saídas do mês ainda não pagas (já descontadas do resultado) */
  unpaid: number;
}

type SubWithPlan = Prisma.SubscriptionGetPayload<{ include: { plan: true; tenant: { select: { id: true; name: true; phone: true; contactName: true; billingEmail: true; isActive: true } } } }>;

/**
 * Fechamento financeiro do dono (docs/36-fechamento-financeiro.md): quanto era para entrar no mês,
 * quanto entrou, quem está atrasado, os custos (fixos, folha, avulsos) e quanto cada sócio recebe.
 *
 * Recebido de cliente = faturas pagas no mês (Asaas/Stripe, inclusive ativação) + recebimentos por
 * fora lançados aqui (`finance_entries` com `tenantId`). Regime de caixa: conta no mês em que o
 * dinheiro entrou, não no do vencimento.
 */
@Injectable()
export class FinanceClosingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- mês ----------

  async month(period: string) {
    if (!PERIOD_RE.test(period)) throw new BadRequestException('Mês inválido (AAAA-MM)');
    const closing = await this.prisma.financeClosing.findUnique({ where: { period } });
    if (!closing && period <= periodSP()) {
      await this.materializeRecurring(period);
      await this.materializeTaxes(period);
    }
    const [receivables, entries, partners, settings, cash, cats] = await Promise.all([
      this.receivables(period),
      this.prisma.financeEntry.findMany({ where: { period }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], include: { tenant: { select: { name: true } }, supplier: { select: { name: true } } } }),
      this.prisma.financePartner.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.settings(),
      this.cash(),
      this.categories(),
    ]);
    const live = await this.summary(period, settings.reservePercent);
    const summary = closing ? (closing.summary as unknown as ClosingSummary) : live;
    const payouts = closing ? (closing.payouts as unknown as PayoutRow[]) : this.split(live.distributable, partners);
    const doMes = receivables.filter((r) => r.dueDate.startsWith(period));
    const atual = periodSP();
    const anterior = prevPeriod(atual);
    return {
      period,
      current: period === atual,
      /** só fecha mês que já terminou: o atual ainda recebe e gasta */
      canClose: !closing && period < atual,
      /** mês passado ainda sem fechamento — o aviso do topo leva até ele */
      previousOpen: (await this.prisma.financeClosing.findUnique({ where: { period: anterior }, select: { id: true } })) ? null : anterior,
      closed: closing ? { closedAt: closing.closedAt, notes: closing.notes } : null,
      summary,
      /** fechado: os números de agora, para ver se algo mudou depois do fechamento */
      liveSummary: closing ? live : null,
      payouts,
      partnersPercent: cents(partners.reduce((s, p) => s + Number(p.sharePercent), 0)),
      expected: cents(doMes.reduce((s, r) => s + r.amount, 0)),
      pending: cents(doMes.filter((r) => r.status !== 'paid').reduce((s, r) => s + r.amount, 0)),
      receivables,
      entries: entries.map((e) => this.present(e, cats)),
      cash,
    };
  }

  /**
   * Custos fixos e folha viram lançamentos do mês (um por fixo; idempotente), respeitando a
   * frequência (trimestral, anual…) e o mês final. Débito automático já nasce pago no dia.
   */
  private async materializeRecurring(period: string) {
    const rec = (await this.prisma.financeRecurring.findMany({ where: { isActive: true, startPeriod: { lte: period }, OR: [{ endPeriod: null }, { endPeriod: { gte: period } }] } }))
      .filter((r) => monthsBetween(r.startPeriod, period) % (FINANCE_FREQUENCY_MONTHS[r.frequency as FinanceFrequency] ?? 1) === 0);
    if (!rec.length) return;
    await this.prisma.financeEntry.createMany({
      data: rec.map((r) => {
        const date = dateIn(period, r.dayOfMonth);
        return {
          kind: r.kind, category: r.category, description: r.description, amount: r.amount, date, period, recurringId: r.id,
          paidAt: r.autoPaid ? date : null, paymentMethod: r.paymentMethod, supplierId: r.supplierId, notes: r.notes,
        };
      }),
      skipDuplicates: true,
    });
  }

  /** O que entrou no mês: de clientes (faturas pagas + recebimentos por fora) e outras entradas. */
  private async income(period: string) {
    const { start, end } = monthRange(period);
    const [inv, entries] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { status: 'paid', paidAt: { gte: start, lt: end } }, _sum: { totalAmount: true } }),
      this.prisma.financeEntry.findMany({ where: { period, kind: 'income', skipped: false, paidAt: { not: null } }, select: { amount: true, tenantId: true } }),
    ]);
    const soma = (f: (e: (typeof entries)[number]) => boolean) => entries.filter(f).reduce((s, e) => s + Number(e.amount), 0);
    return { clients: cents(Number(inv._sum.totalAmount ?? 0) + soma((e) => !!e.tenantId)), other: cents(soma((e) => !e.tenantId)) };
  }

  /**
   * Impostos automáticos: % sobre o que entrou no mês, lançado no próprio mês (competência) e
   * vencendo no seguinte. Recalcula enquanto o mês está aberto, o lançamento não foi pago e ninguém
   * corrigiu o valor à mão (a guia real) — aí fica o valor da guia.
   */
  private async materializeTaxes(period: string) {
    const rules = await this.prisma.financeTaxRule.findMany({ where: { isActive: true, startPeriod: { lte: period } } });
    if (!rules.length) return;
    const inc = await this.income(period);
    for (const r of rules) {
      const base = r.base === 'clients' ? inc.clients : inc.clients + inc.other;
      const amount = cents((base * Number(r.percent)) / 100);
      const ex = await this.prisma.financeEntry.findUnique({ where: { taxRuleId_period: { taxRuleId: r.id, period } } });
      if (!ex) {
        if (amount <= 0) continue;
        await this.prisma.financeEntry.create({
          data: { kind: 'expense', category: r.categoryId, description: `${r.name} — ${mesBR(period)}`, amount, date: dateIn(addMonths(period, 1), r.dueDay), period, taxRuleId: r.id, paymentMethod: 'boleto' },
        }).catch((e) => { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e; });
      } else if (!ex.paidAt && !ex.amountLocked && !ex.skipped && Number(ex.amount) !== amount) {
        await this.prisma.financeEntry.update({ where: { id: ex.id }, data: { amount } });
      }
    }
  }

  private async summary(period: string, reservePercent: number): Promise<ClosingSummary> {
    const [inc, entries, cats] = await Promise.all([
      this.income(period),
      this.prisma.financeEntry.findMany({ where: { period, skipped: false, kind: 'expense' } }),
      this.categories(),
    ]);
    // saída conta no mês dela (competência), paga ou não: o fechamento não distribui o que tem conta a pagar
    const soma = (sec: FinanceSection) => cents(entries.filter((e) => (cats.get(e.category)?.section ?? 'expense') === sec).reduce((s, e) => s + Number(e.amount), 0));
    const taxes = soma('tax');
    const costs = soma('cost');
    const expenses = soma('expense') + soma('revenue'); // categoria de entrada usada numa saída (não deveria) cai em despesas
    const payroll = soma('payroll');
    const prolabore = soma('prolabore');
    const unpaid = cents(entries.filter((e) => !e.paidAt).reduce((s, e) => s + Number(e.amount), 0));
    const result = cents(inc.clients + inc.other - taxes - costs - expenses - payroll - prolabore);
    const reserve = result > 0 ? cents((result * reservePercent) / 100) : 0;
    return { receivedClients: inc.clients, otherIncome: inc.other, taxes, costs, expenses: cents(expenses), payroll, prolabore, result, reservePercent, reserve, distributable: Math.max(0, cents(result - reserve)), unpaid };
  }

  private async categories() {
    const rows = await this.prisma.financeCategory.findMany();
    return new Map(rows.map((c) => [c.id, { name: c.name, section: c.section as FinanceSection, isActive: c.isActive }]));
  }

  private present(e: EntryWithRefs, cats: Map<string, { name: string; section: FinanceSection }>) {
    const date = diaSP(e.date);
    const cat = cats.get(e.category);
    return {
      id: e.id, kind: e.kind, category: e.category, categoryName: cat?.name ?? e.category, section: cat?.section ?? (e.kind === 'income' ? 'revenue' : 'expense'),
      description: e.description, amount: Number(e.amount), date, period: e.period,
      paidAt: e.paidAt ? diaSP(e.paidAt) : null, status: e.paidAt ? 'paid' : date < diaSP() ? 'overdue' : 'open',
      paymentMethod: e.paymentMethod, documentNumber: e.documentNumber, notes: e.notes, supplierId: e.supplierId, supplier: e.supplier?.name ?? null,
      tenantId: e.tenantId, tenant: e.tenant?.name ?? null, recurringId: e.recurringId, taxRuleId: e.taxRuleId, amountLocked: e.amountLocked,
      installmentGroup: e.installmentGroup, installmentNo: e.installmentNo, installmentTotal: e.installmentTotal, skipped: e.skipped,
    };
  }

  /** Divide pelos %; o centavo que sobra do arredondamento vai para o último. */
  private split(distributable: number, partners: { id: string; name: string; sharePercent: unknown; pixKey: string | null }[]): PayoutRow[] {
    const rows = partners.map((p) => ({ partnerId: p.id, name: p.name, percent: Number(p.sharePercent), amount: cents((distributable * Number(p.sharePercent)) / 100), pixKey: p.pixKey, paidAt: null }));
    const total = cents((distributable * rows.reduce((s, r) => s + r.percent, 0)) / 100);
    if (rows.length) rows[rows.length - 1].amount = cents(rows[rows.length - 1].amount + total - rows.reduce((s, r) => s + r.amount, 0));
    return rows;
  }

  // ---------- a receber / atraso ----------

  /** Valor do ciclo: contratado (negociado), senão o do plano × unidades. Contratado zerado em plano pago é resto de cadastro. */
  private valor(s: SubWithPlan) {
    return Number(s.priceMonth ?? 0) > 0 ? contractedCharge(s).value : chargeOf(s.plan, s.units).value;
  }

  private contato(t: { phone: string | null; contactName: string | null; billingEmail: string | null }, adminEmail?: string | null) {
    return { name: t.contactName, phone: t.phone, email: t.billingEmail || adminEmail || null };
  }

  /**
   * O que vence no mês (faturas do Asaas/Stripe e mensalidades sem gateway) e o que entrou por fora
   * no mês. Vencidos de meses anteriores ainda em aberto também vêm (para o mês atual), marcados.
   */
  private async receivables(period: string): Promise<ReceivableRow[]> {
    const { start, end } = monthRange(period);
    const agora = new Date();
    const atual = period === periodSP();
    const [invoices, subs, manuais, ativacoes] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: { notIn: ['void', 'draft'] }, OR: [{ dueAt: { gte: start, lt: end } }, ...(atual ? [{ status: { in: ['open', 'failed'] as ('open' | 'failed')[] }, dueAt: { lt: start } }] : [])] },
        include: { tenant: { select: { id: true, name: true, phone: true, contactName: true, billingEmail: true, subscription: { select: { status: true, gateway: true } } } } },
      }),
      this.manualSubs(),
      this.prisma.financeEntry.findMany({ where: { period, kind: 'income', tenantId: { not: null }, skipped: false }, include: { tenant: { select: { id: true, name: true, phone: true, contactName: true, billingEmail: true } } } }),
      this.prisma.activationCharge.findMany({ where: { externalId: { not: null } }, select: { externalId: true } }),
    ]);
    const ativ = new Set(ativacoes.map((a) => a.externalId));
    const rows: ReceivableRow[] = [];
    for (const i of invoices) {
      const due = i.dueAt ?? i.createdAt;
      const pago = i.status === 'paid';
      rows.push({
        key: `inv:${i.id}`, tenantId: i.tenantId, tenant: i.tenant.name,
        origin: i.externalId && ativ.has(i.externalId) ? 'ativacao' : i.externalId?.startsWith('in_') ? 'stripe' : 'asaas',
        dueDate: diaSP(due), amount: Number(i.totalAmount),
        status: pago ? 'paid' : due < agora ? 'overdue' : 'open',
        paidAt: i.paidAt ? diaSP(i.paidAt) : null, hostedUrl: i.hostedUrl,
        subscriptionStatus: i.tenant.subscription?.status ?? null,
        daysLate: !pago && due < agora ? Math.floor((agora.getTime() - due.getTime()) / DAY) : 0,
        contact: this.contato(i.tenant), canReceive: false,
      });
    }
    for (const s of subs) {
      const due = s.currentPeriodEnd;
      const noMes = due >= start && due < end;
      if (!noMes && !(atual && due < start)) continue;
      rows.push({
        key: `sub:${s.id}`, tenantId: s.tenantId, tenant: s.tenant.name, origin: 'manual',
        dueDate: diaSP(due), amount: this.valor(s), status: due < agora ? 'overdue' : 'open', paidAt: null, hostedUrl: null,
        subscriptionStatus: s.status, daysLate: due < agora ? Math.floor((agora.getTime() - due.getTime()) / DAY) : 0,
        contact: this.contato(s.tenant), canReceive: true,
      });
    }
    for (const e of manuais) {
      rows.push({
        key: `entry:${e.id}`, tenantId: e.tenantId!, tenant: e.tenant?.name ?? '—', origin: 'manual',
        dueDate: diaSP(e.date), amount: Number(e.amount), status: 'paid', paidAt: diaSP(e.date), hostedUrl: null,
        subscriptionStatus: null, daysLate: 0, contact: this.contato(e.tenant ?? { phone: null, contactName: null, billingEmail: null }), canReceive: false,
      });
    }
    return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.tenant.localeCompare(b.tenant));
  }

  /** Mensalidades sem gateway que alguém precisa receber: pagas, ativas, sem teste e sem ativação pendente. */
  private manualSubs() {
    return this.prisma.subscription.findMany({
      where: { gateway: null, status: { in: ['active', 'past_due', 'suspended'] }, awaitingActivation: false, plan: { isFree: false }, tenant: { isActive: true } },
      include: { plan: true, tenant: { select: { id: true, name: true, phone: true, contactName: true, billingEmail: true, isActive: true } } },
    });
  }

  /** Tudo que venceu e não foi pago, de qualquer mês — a aba Em atraso. */
  async overdue(): Promise<ReceivableRow[]> {
    const agora = new Date();
    const [invoices, subs] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: { in: ['open', 'failed'] }, dueAt: { lt: agora } },
        include: { tenant: { select: { id: true, name: true, phone: true, contactName: true, billingEmail: true, subscription: { select: { status: true } } } } },
      }),
      this.manualSubs(),
    ]);
    const ativ = new Set((await this.prisma.activationCharge.findMany({ where: { externalId: { not: null } }, select: { externalId: true } })).map((a) => a.externalId));
    const rows: ReceivableRow[] = invoices.map((i) => ({
      key: `inv:${i.id}`, tenantId: i.tenantId, tenant: i.tenant.name,
      origin: i.externalId && ativ.has(i.externalId) ? 'ativacao' : i.externalId?.startsWith('in_') ? 'stripe' : 'asaas',
      dueDate: diaSP(i.dueAt!), amount: Number(i.totalAmount), status: 'overdue', paidAt: null, hostedUrl: i.hostedUrl,
      subscriptionStatus: i.tenant.subscription?.status ?? null, daysLate: Math.floor((agora.getTime() - i.dueAt!.getTime()) / DAY),
      contact: this.contato(i.tenant), canReceive: false,
    }));
    for (const s of subs) {
      if (s.currentPeriodEnd >= agora) continue;
      rows.push({
        key: `sub:${s.id}`, tenantId: s.tenantId, tenant: s.tenant.name, origin: 'manual', dueDate: diaSP(s.currentPeriodEnd), amount: this.valor(s),
        status: 'overdue', paidAt: null, hostedUrl: null, subscriptionStatus: s.status,
        daysLate: Math.floor((agora.getTime() - s.currentPeriodEnd.getTime()) / DAY), contact: this.contato(s.tenant), canReceive: true,
      });
    }
    return rows.sort((a, b) => b.daysLate - a.daysLate);
  }

  /**
   * Recebeu por fora a mensalidade de um cliente sem gateway: lança a entrada e a assinatura anda um
   * ciclo a partir do vencimento (fica `active`). É o "marcar como pago" de quem não está no Asaas.
   */
  async receive(tenantId: string, userId: string, dto: { amount?: number; date?: string }) {
    const s = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true, tenant: { select: { id: true, name: true, phone: true, contactName: true, billingEmail: true, isActive: true } } } });
    if (!s) throw new NotFoundException('Cliente sem assinatura');
    if (s.gateway) throw new BadRequestException(`Este cliente paga pelo ${s.gateway === 'asaas' ? 'Asaas' : 'Stripe'}: a baixa vem sozinha quando a cobrança é paga.`);
    const date = dto.date ?? diaSP();
    const period = date.slice(0, 7);
    await this.assertOpen(period);
    const amount = cents(dto.amount ?? this.valor(s));
    if (amount <= 0) throw new BadRequestException('Informe o valor recebido.');
    const fim = nextPeriodEnd(s.currentPeriodEnd, s.plan.billingCycle === 'yearly' ? 'yearly' : 'monthly');
    await this.prisma.$transaction([
      this.prisma.financeEntry.create({ data: { kind: 'income', category: 'mensalidade', description: `Mensalidade ${s.plan.name} — venc. ${s.currentPeriodEnd.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, amount, date: noon(date), paidAt: noon(date), period, tenantId, createdById: userId } }),
      this.prisma.subscription.update({ where: { tenantId }, data: { status: 'active', graceUntil: null, currentPeriodStart: s.currentPeriodEnd, currentPeriodEnd: fim } }),
    ]);
    return { ok: true, nextDue: diaSP(fim) };
  }

  // ---------- lançamentos ----------

  private async isClosed(period: string) {
    return !!(await this.prisma.financeClosing.findUnique({ where: { period }, select: { id: true } }));
  }

  private async assertOpen(period: string) {
    if (await this.isClosed(period)) {
      throw new BadRequestException(`O mês ${period.split('-').reverse().join('/')} já foi fechado. Reabra o fechamento para mudar os lançamentos.`);
    }
  }

  /** Categoria existente (e ativa, para lançar) → grupo e tipo do lançamento. */
  private async category(id: string, paraLancar = true) {
    const c = await this.prisma.financeCategory.findUnique({ where: { id } });
    if (!c || (paraLancar && !c.isActive)) throw new BadRequestException('Categoria inválida ou desativada');
    return { section: c.section as FinanceSection, kind: financeKindOf(c.section as FinanceSection) };
  }

  private async supplier(id?: string | null) {
    if (!id) return null;
    if (!(await this.prisma.financeSupplier.findUnique({ where: { id }, select: { id: true } }))) throw new BadRequestException('Fornecedor não encontrado');
    return id;
  }

  /**
   * Lança uma entrada ou saída. `installments` > 1 cria as parcelas mês a mês (vencimento e
   * competência andam juntos); só a 1ª pode nascer paga.
   */
  async createEntry(userId: string, dto: EntryDto) {
    const { kind } = await this.category(dto.category);
    const supplierId = await this.supplier(dto.supplierId);
    const n = Math.max(1, Math.min(60, dto.installments ?? 1));
    const comp = dto.period && PERIOD_RE.test(dto.period) ? dto.period : dto.date.slice(0, 7);
    const dia = Number(dto.date.slice(8, 10));
    const group = n > 1 ? randomUUID() : null;
    const rows = Array.from({ length: n }, (_, i) => ({
      kind, category: dto.category, description: n > 1 ? `${dto.description.trim()} (${i + 1}/${n})` : dto.description.trim(), amount: cents(dto.amount),
      date: i ? dateIn(addMonths(dto.date.slice(0, 7), i), dia) : noon(dto.date), period: addMonths(comp, i),
      paidAt: i === 0 && dto.paidAt ? noon(dto.paidAt) : null,
      paymentMethod: dto.paymentMethod || null, documentNumber: dto.documentNumber?.trim() || null, notes: dto.notes?.trim() || null, supplierId,
      installmentGroup: group, installmentNo: n > 1 ? i + 1 : null, installmentTotal: n > 1 ? n : null, createdById: userId,
    }));
    for (const p of new Set(rows.map((r) => r.period))) await this.assertOpen(p);
    await this.prisma.financeEntry.createMany({ data: rows });
    return { ok: true, count: n };
  }

  async updateEntry(id: string, dto: Partial<EntryDto> & { skipped?: boolean }) {
    const e = await this.prisma.financeEntry.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Lançamento não encontrado');
    await this.assertOpen(e.period);
    const cat = dto.category && dto.category !== e.category ? await this.category(dto.category) : null;
    const period = dto.period && PERIOD_RE.test(dto.period) ? dto.period : dto.date && !dto.period && !e.recurringId && !e.taxRuleId && !e.installmentGroup ? dto.date.slice(0, 7) : e.period;
    // fixo e imposto automático não mudam de mês (seriam lançados de novo no mês de origem)
    if (period !== e.period && (e.recurringId || e.taxRuleId)) throw new BadRequestException('Custo fixo e imposto automático ficam no mês deles.');
    if (period !== e.period) await this.assertOpen(period);
    const amount = dto.amount !== undefined ? cents(dto.amount) : undefined;
    await this.prisma.financeEntry.update({
      where: { id },
      data: {
        ...(cat && { category: dto.category, kind: cat.kind }),
        ...(dto.description !== undefined && { description: dto.description.trim() }),
        ...(amount !== undefined && { amount, ...(e.taxRuleId && amount !== Number(e.amount) && { amountLocked: true }) }),
        ...(dto.date && { date: noon(dto.date) }),
        period,
        ...(dto.paidAt !== undefined && { paidAt: dto.paidAt ? noon(dto.paidAt) : null }),
        ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod || null }),
        ...(dto.documentNumber !== undefined && { documentNumber: dto.documentNumber?.trim() || null }),
        ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
        ...(dto.supplierId !== undefined && { supplierId: await this.supplier(dto.supplierId) }),
        ...(dto.skipped !== undefined && { skipped: dto.skipped }),
      },
    });
    return { ok: true };
  }

  /**
   * Dar baixa numa conta (ou desfazer). Pagar vale até em mês fechado: muda o caixa, não o
   * fechamento. Mudar o valor (juros, guia diferente) só com o mês aberto.
   */
  async pay(id: string, dto: { date?: string | null; amount?: number; paymentMethod?: string | null }) {
    const e = await this.prisma.financeEntry.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Lançamento não encontrado');
    if (e.skipped) throw new BadRequestException('Lançamento riscado (não houve neste mês).');
    const amount = dto.amount !== undefined ? cents(dto.amount) : Number(e.amount);
    if (amount !== Number(e.amount)) {
      if (await this.isClosed(e.period)) throw new BadRequestException(`${mesBR(e.period)} já foi fechado com ${Number(e.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}: pague esse valor ou reabra o mês para corrigir.`);
    }
    await this.prisma.financeEntry.update({
      where: { id },
      data: {
        paidAt: dto.date === null ? null : noon(dto.date ?? diaSP()),
        ...(amount !== Number(e.amount) && { amount, ...(e.taxRuleId && { amountLocked: true }) }),
        ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod || null }),
      },
    });
    return { ok: true };
  }

  /** Contas a pagar: toda saída em aberto, de qualquer mês, por vencimento. */
  async payables() {
    const [rows, cats] = await Promise.all([
      this.prisma.financeEntry.findMany({ where: { kind: 'expense', skipped: false, paidAt: null }, orderBy: [{ date: 'asc' }, { description: 'asc' }], include: { tenant: { select: { name: true } }, supplier: { select: { name: true } } } }),
      this.categories(),
    ]);
    return rows.map((e) => this.present(e, cats));
  }

  /**
   * Fixo e imposto automático não se apagam (voltariam ao abrir o mês): ficam "não houve" (`skipped`).
   * `all` numa parcela apaga também as parcelas seguintes em aberto (meses abertos).
   */
  async deleteEntry(id: string, all = false) {
    const e = await this.prisma.financeEntry.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Lançamento não encontrado');
    await this.assertOpen(e.period);
    if (e.recurringId || e.taxRuleId) await this.prisma.financeEntry.update({ where: { id }, data: { skipped: true } });
    else if (all && e.installmentGroup) {
      const fechados = (await this.prisma.financeClosing.findMany({ select: { period: true } })).map((c) => c.period);
      await this.prisma.financeEntry.deleteMany({ where: { installmentGroup: e.installmentGroup, OR: [{ id }, { paidAt: null, period: { gte: e.period, notIn: fechados } }] } });
    } else await this.prisma.financeEntry.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- sócios, fixos, configuração ----------

  async config() {
    const [partners, recurring, settings, categories, suppliers, taxRules] = await Promise.all([
      this.prisma.financePartner.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      this.prisma.financeRecurring.findMany({ orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { description: 'asc' }], include: { supplier: { select: { name: true } } } }),
      this.settings(),
      this.prisma.financeCategory.findMany({ orderBy: [{ section: 'asc' }, { name: 'asc' }] }),
      this.prisma.financeSupplier.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      this.prisma.financeTaxRule.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
    ]);
    return {
      partners: partners.map((p) => ({ id: p.id, name: p.name, sharePercent: Number(p.sharePercent), pixKey: p.pixKey, isActive: p.isActive })),
      recurring: recurring.map((r) => ({
        id: r.id, category: r.category, description: r.description, amount: Number(r.amount), dayOfMonth: r.dayOfMonth, isActive: r.isActive, startPeriod: r.startPeriod,
        endPeriod: r.endPeriod, frequency: r.frequency, autoPaid: r.autoPaid, paymentMethod: r.paymentMethod, supplierId: r.supplierId, supplier: r.supplier?.name ?? null, notes: r.notes,
      })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, section: c.section as FinanceSection, system: c.system, isActive: c.isActive })),
      suppliers: suppliers.map((f) => ({ id: f.id, name: f.name, document: f.document, pixKey: f.pixKey, notes: f.notes, isActive: f.isActive })),
      taxRules: taxRules.map((t) => ({ id: t.id, name: t.name, categoryId: t.categoryId, percent: Number(t.percent), base: t.base, dueDay: t.dueDay, isActive: t.isActive, startPeriod: t.startPeriod })),
      settings,
    };
  }

  // categorias

  async saveCategory(id: string | null, dto: { name: string; section: string; isActive?: boolean }) {
    if (!(FINANCE_SECTIONS as readonly string[]).includes(dto.section)) throw new BadRequestException('Grupo inválido');
    if (id) {
      const c = await this.prisma.financeCategory.findUnique({ where: { id } });
      if (!c) throw new NotFoundException('Categoria não encontrada');
      if (c.system && c.section !== dto.section) throw new BadRequestException('Categoria de fábrica não muda de grupo: crie uma nova.');
      // mudar de grupo troca entrada ↔ saída dos lançamentos dela
      if (financeKindOf(c.section as FinanceSection) !== financeKindOf(dto.section as FinanceSection) && (await this.prisma.financeEntry.count({ where: { category: id } }))) {
        throw new BadRequestException('Esta categoria já tem lançamentos: não dá para trocar entre entrada e saída.');
      }
      await this.prisma.financeCategory.update({ where: { id }, data: { name: dto.name.trim(), section: dto.section, ...(dto.isActive !== undefined && { isActive: dto.isActive }) } });
    } else {
      await this.prisma.financeCategory.create({ data: { name: dto.name.trim(), section: dto.section } });
    }
    return this.config();
  }

  /** Em uso (lançamento, fixo, imposto) não apaga: desativa, para o histórico continuar com o nome. */
  async deleteCategory(id: string) {
    const c = await this.prisma.financeCategory.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Categoria não encontrada');
    const uso = (await this.prisma.financeEntry.count({ where: { category: id } })) + (await this.prisma.financeRecurring.count({ where: { category: id } })) + (await this.prisma.financeTaxRule.count({ where: { categoryId: id } }));
    if (c.system || uso) await this.prisma.financeCategory.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.financeCategory.delete({ where: { id } });
    return this.config();
  }

  // fornecedores

  async saveSupplier(id: string | null, dto: { name: string; document?: string | null; pixKey?: string | null; notes?: string | null; isActive?: boolean }) {
    const data = {
      name: dto.name.trim(), document: dto.document?.replace(/\D/g, '') || null, pixKey: dto.pixKey?.trim() || null, notes: dto.notes?.trim() || null,
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    const f = id ? await this.prisma.financeSupplier.update({ where: { id }, data }) : await this.prisma.financeSupplier.create({ data });
    return { ...(await this.config()), saved: f.id };
  }

  async deleteSupplier(id: string) {
    const uso = (await this.prisma.financeEntry.count({ where: { supplierId: id } })) + (await this.prisma.financeRecurring.count({ where: { supplierId: id } }));
    if (uso) await this.prisma.financeSupplier.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.financeSupplier.delete({ where: { id } });
    return this.config();
  }

  // impostos automáticos

  async saveTaxRule(id: string | null, dto: { name: string; categoryId: string; percent: number; base?: string; dueDay?: number; isActive?: boolean; startPeriod?: string }) {
    const cat = await this.category(dto.categoryId, false);
    if (cat.section !== 'tax') throw new BadRequestException('Escolha uma categoria do grupo Impostos.');
    const data = {
      name: dto.name.trim(), categoryId: dto.categoryId, percent: dto.percent, base: dto.base === 'clients' ? 'clients' : 'all',
      ...(dto.dueDay !== undefined && { dueDay: dto.dueDay }), ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    if (id) {
      await this.prisma.financeTaxRule.update({ where: { id }, data });
      // desligado: sai dos meses abertos o que ainda não foi pago (o recálculo cuida do resto)
      if (dto.isActive === false) await this.dropOpenTaxEntries(id);
      else await this.prisma.financeEntry.updateMany({ where: { taxRuleId: id, paidAt: null, amountLocked: false, period: { notIn: await this.closedPeriods() } }, data: { category: dto.categoryId } });
    } else {
      await this.prisma.financeTaxRule.create({ data: { ...data, startPeriod: dto.startPeriod && PERIOD_RE.test(dto.startPeriod) ? dto.startPeriod : periodSP() } });
    }
    return this.config();
  }

  async deleteTaxRule(id: string) {
    await this.dropOpenTaxEntries(id);
    await this.prisma.financeTaxRule.delete({ where: { id } });
    return this.config();
  }

  private async dropOpenTaxEntries(taxRuleId: string) {
    await this.prisma.financeEntry.deleteMany({ where: { taxRuleId, paidAt: null, amountLocked: false, period: { notIn: await this.closedPeriods() } } });
  }

  private async closedPeriods() {
    return (await this.prisma.financeClosing.findMany({ select: { period: true } })).map((c) => c.period);
  }

  async settings() {
    const s = await this.prisma.financeSettings.findUnique({ where: { id: 'default' } });
    return { reservePercent: Number(s?.reservePercent ?? 0), openingBalance: Number(s?.openingBalance ?? 0), openingDate: s?.openingDate ? diaSP(s.openingDate) : null };
  }

  async saveSettings(dto: { reservePercent?: number; openingBalance?: number; openingDate?: string | null }) {
    const data = {
      ...(dto.reservePercent !== undefined && { reservePercent: dto.reservePercent }),
      ...(dto.openingBalance !== undefined && { openingBalance: cents(dto.openingBalance) }),
      ...(dto.openingDate !== undefined && { openingDate: dto.openingDate ? new Date(`${dto.openingDate}T00:00:00-03:00`) : null }),
    };
    await this.prisma.financeSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    return this.config();
  }

  async savePartner(id: string | null, dto: { name: string; sharePercent: number; pixKey?: string | null; isActive?: boolean }) {
    const data = { name: dto.name.trim(), sharePercent: dto.sharePercent, pixKey: dto.pixKey?.trim() || null, ...(dto.isActive !== undefined && { isActive: dto.isActive }) };
    if (id) await this.prisma.financePartner.update({ where: { id }, data });
    else await this.prisma.financePartner.create({ data });
    return this.config();
  }

  async saveRecurring(id: string | null, dto: {
    category: string; description: string; amount: number; dayOfMonth?: number; isActive?: boolean; startPeriod?: string;
    endPeriod?: string | null; frequency?: string; autoPaid?: boolean; paymentMethod?: string | null; supplierId?: string | null; notes?: string | null;
  }) {
    const { kind } = await this.category(dto.category, !id);
    const data = {
      kind, category: dto.category, description: dto.description.trim(), amount: cents(dto.amount),
      ...(dto.dayOfMonth !== undefined && { dayOfMonth: dto.dayOfMonth }), ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.endPeriod !== undefined && { endPeriod: dto.endPeriod && PERIOD_RE.test(dto.endPeriod) ? dto.endPeriod : null }),
      ...(dto.frequency && dto.frequency in FINANCE_FREQUENCY_MONTHS && { frequency: dto.frequency }),
      ...(dto.autoPaid !== undefined && { autoPaid: dto.autoPaid }),
      ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod || null }),
      ...(dto.supplierId !== undefined && { supplierId: await this.supplier(dto.supplierId) }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
    };
    if (id) {
      await this.prisma.financeRecurring.update({ where: { id }, data });
      // o valor novo vale para o mês aberto que ainda tem o lançamento dele (o fechado fica como foi)
      const aberto = periodSP();
      if (!(await this.prisma.financeClosing.findUnique({ where: { period: aberto } }))) {
        await this.prisma.financeEntry.updateMany({
          where: { recurringId: id, period: aberto },
          data: { amount: data.amount, description: data.description, category: data.category, kind: data.kind, ...(data.supplierId !== undefined && { supplierId: data.supplierId }), ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }) },
        });
      }
    } else {
      await this.prisma.financeRecurring.create({ data: { ...data, startPeriod: dto.startPeriod && PERIOD_RE.test(dto.startPeriod) ? dto.startPeriod : periodSP() } });
    }
    return this.config();
  }

  async deleteRecurring(id: string) {
    // lançamentos de meses passados ficam (o vínculo vira nulo); o do mês aberto sai junto
    const aberto = periodSP();
    if (!(await this.prisma.financeClosing.findUnique({ where: { period: aberto } }))) await this.prisma.financeEntry.deleteMany({ where: { recurringId: id, period: aberto } });
    await this.prisma.financeRecurring.delete({ where: { id } });
    return this.config();
  }

  // ---------- fechar ----------

  async close(period: string, userId: string, notes?: string) {
    if (!PERIOD_RE.test(period)) throw new BadRequestException('Mês inválido (AAAA-MM)');
    // mês em andamento não fecha: ainda entra e sai dinheiro com data dele (no dia 5/11 fecha-se outubro)
    if (period >= periodSP()) throw new BadRequestException(`Só dá para fechar mês que já terminou: ${mesBR(period)} fecha a partir do dia 1º do mês seguinte.`);
    await this.assertOpen(period);
    await this.materializeRecurring(period);
    await this.materializeTaxes(period);
    const [settings, partners] = await Promise.all([this.settings(), this.prisma.financePartner.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })]);
    const summary = await this.summary(period, settings.reservePercent);
    const pct = cents(partners.reduce((s, p) => s + Number(p.sharePercent), 0));
    if (summary.distributable > 0 && pct !== 100) throw new BadRequestException(`A soma dos sócios ativos é ${pct}%: ajuste para 100% em Sócios e custos antes de fechar.`);
    await this.prisma.financeClosing.create({
      data: { period, summary: summary as unknown as Prisma.InputJsonValue, payouts: this.split(summary.distributable, partners) as unknown as Prisma.InputJsonValue, notes: notes?.trim() || null, closedById: userId },
    });
    return this.month(period);
  }

  async reopen(period: string) {
    const c = await this.prisma.financeClosing.findUnique({ where: { period } });
    if (!c) throw new NotFoundException('Mês não está fechado');
    await this.prisma.financeClosing.delete({ where: { period } });
    return this.month(period);
  }

  /** Marca (ou desmarca) que o sócio já recebeu a parte dele do mês fechado. */
  async markPayout(period: string, partnerId: string, paid: boolean, date?: string) {
    const c = await this.prisma.financeClosing.findUnique({ where: { period } });
    if (!c) throw new BadRequestException('Feche o mês antes de pagar os sócios.');
    const dia = date ?? diaSP();
    if (paid && dia > diaSP()) throw new BadRequestException('A data do pagamento não pode ser no futuro.');
    if (paid && dia.slice(0, 7) < period) throw new BadRequestException('A data do pagamento não pode ser antes do mês fechado.');
    const payouts = (c.payouts as unknown as PayoutRow[]).map((p) => (p.partnerId === partnerId ? { ...p, paidAt: paid ? dia : null } : p));
    await this.prisma.financeClosing.update({ where: { period }, data: { payouts: payouts as unknown as Prisma.InputJsonValue } });
    return this.month(period);
  }

  // ---------- caixa ----------

  /**
   * Caixa = saldo inicial + o que entrou (faturas pagas + entradas recebidas) − o que saiu (saídas
   * pagas + partes dos sócios já pagas), tudo desde a data do saldo inicial, pelo dia do pagamento.
   */
  async cash() {
    const s = await this.settings();
    const desde = s.openingDate ? new Date(`${s.openingDate}T00:00:00-03:00`) : new Date(0);
    const agora = new Date();
    // pelo dia do pagamento, e só o que já aconteceu (débito automático do dia 25 não sai no dia 10)
    const pago = { gte: desde, lte: agora };
    const hoje = new Date(`${diaSP()}T00:00:00-03:00`);
    const [inv, entradas, saidas, closings, aPagar, vencido] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { status: 'paid', paidAt: pago }, _sum: { totalAmount: true } }),
      this.prisma.financeEntry.aggregate({ where: { kind: 'income', skipped: false, paidAt: pago }, _sum: { amount: true } }),
      this.prisma.financeEntry.aggregate({ where: { kind: 'expense', skipped: false, paidAt: pago }, _sum: { amount: true } }),
      this.prisma.financeClosing.findMany({ select: { payouts: true } }),
      this.prisma.financeEntry.aggregate({ where: { kind: 'expense', skipped: false, paidAt: null }, _sum: { amount: true }, _count: true }),
      this.prisma.financeEntry.aggregate({ where: { kind: 'expense', skipped: false, paidAt: null, date: { lt: hoje } }, _sum: { amount: true }, _count: true }),
    ]);
    const pagosSocios = closings.flatMap((c) => c.payouts as unknown as PayoutRow[]).filter((p) => p.paidAt && p.paidAt >= (s.openingDate ?? '')).reduce((a, p) => a + p.amount, 0);
    const recebido = Number(inv._sum.totalAmount ?? 0) + Number(entradas._sum.amount ?? 0);
    const gasto = Number(saidas._sum.amount ?? 0);
    return {
      balance: cents(s.openingBalance + recebido - gasto - pagosSocios), since: s.openingDate, received: cents(recebido), spent: cents(gasto), paidToPartners: cents(pagosSocios),
      /** contas a pagar em aberto (todas) e as já vencidas */
      toPay: cents(Number(aPagar._sum.amount ?? 0)), toPayCount: aPagar._count, overdue: cents(Number(vencido._sum.amount ?? 0)), overdueCount: vencido._count,
    };
  }
}
