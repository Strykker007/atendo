import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { InvoiceStatus, Plan, SubscriptionStatus } from '@prisma/client';
import { isStripeBillable } from '@atendo/shared';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { UsageService, periodOf } from './usage.service';
import { nextPeriodEnd, type ConsolidatedItem } from './dues';

// ---------- Tipos da API v3 do Asaas (só o que usamos) ----------

export type AsaasBillingType = 'PIX' | 'CREDIT_CARD';

export interface AsaasCustomerInput {
  name?: string;
  cpfCnpj: string;
  email?: string;
  mobilePhone?: string;
  postalCode?: string;
  addressNumber?: string;
}

export interface AsaasCard {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

/** Dados do titular exigidos pelo Asaas na cobrança por cartão (antifraude). */
export interface AsaasCardHolder {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

interface AsaasCustomer { id: string; name: string; cpfCnpj: string; email: string | null; mobilePhone: string | null; postalCode: string | null; addressNumber: string | null }
interface AsaasSubscription { id: string; customer: string; status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED'; nextDueDate: string; value: number; cycle: string; billingType: string; externalReference: string | null; deleted?: boolean }
export interface AsaasPayment {
  id: string;
  customer: string;
  subscription?: string | null;
  status: string;
  billingType: string;
  value: number;
  dueDate: string;
  paymentDate?: string | null;
  invoiceUrl?: string | null;
  description?: string | null;
  externalReference?: string | null;
  deleted?: boolean;
}
interface AsaasList<T> { data: T[]; totalCount: number; hasMore: boolean }

/** O que a tela de checkout recebe de uma cobrança. */
export interface PaymentView {
  id: string;
  status: string;
  paid: boolean;
  billingType: string;
  value: number;
  dueDate: string;
  invoiceUrl: string | null;
  pix: { encodedImage: string; payload: string; expirationDate: string } | null;
}

const PAID = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
/** assinatura que ainda vale: trocar de plano é alterar esta, não criar outra */
const LIVE: SubscriptionStatus[] = ['active', 'past_due', 'trialing', 'suspended'];
const OVERAGE_REF = 'overage:';
/** cobrança consolidada do painel de vencimentos: `bulk:<tenant>:<uuid>` */
export const BULK_REF = 'bulk:';

/** 'YYYY-MM-DD' no fuso de Brasília — é como o Asaas lê vencimentos. */
const ymd = (d = new Date()) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
const fromYmd = (s: string) => new Date(`${s}T00:00:00-03:00`);
const onlyDigits = (s?: string) => (s ? s.replace(/\D/g, '') : undefined);
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Valor e ciclo de cobrança de um plano: anual cobra `priceYear` uma vez por ano. `units` > 1
 * é o grupo consolidado (preço do plano × empresas ativas — docs/empresas.md#cobrança).
 */
export const chargeOf = (p: Plan, units = 1) =>
  p.billingCycle === 'yearly'
    ? { value: Number(p.priceYear ?? 0) * Math.max(1, units), cycle: 'YEARLY' as const }
    : { value: Number(p.priceMonth) * Math.max(1, units), cycle: 'MONTHLY' as const };

/**
 * Integração com o Asaas (API v3) — PIX e cartão recorrentes.
 *
 * Mesmo modelo do Stripe (stripe.service.ts): o tenant vira um Customer no primeiro checkout,
 * a assinatura do Asaas é a fonte da verdade e `subscriptions`/`invoices` são espelhos
 * mantidos pelo webhook. Diferente do Stripe, no Asaas não existe "price": o valor vai na
 * própria assinatura, então plano novo não precisa de sincronização.
 *
 * Cartão: os dados passam pela API só para serem tokenizados no Asaas — nunca são gravados
 * nem logados. A assinatura guarda o token e cobra sozinha a cada ciclo.
 */
@Injectable()
export class AsaasService {
  private readonly log = new Logger(AsaasService.name);
  readonly enabled = !!env.ASAAS_API_KEY;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly mail: MailService,
  ) {}

  // ---------- HTTP ----------

  private async request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (!this.enabled) throw new ServiceUnavailableException('Cobrança não configurada (ASAAS_API_KEY ausente)');
    const res = await fetch(`${env.ASAAS_BASE_URL}${path}`, {
      method,
      headers: { access_token: env.ASAAS_API_KEY, 'Content-Type': 'application/json', 'User-Agent': 'atendo' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      // erro de validação do Asaas vem em português e diz o que corrigir (CPF inválido, cartão
      // recusado…): repassa ao cliente em vez de um 500 genérico
      const msg = (json?.errors as { description: string }[] | undefined)?.map((e) => e.description).join(' ') || `Asaas respondeu ${res.status}`;
      if (res.status >= 400 && res.status < 500) throw new BadRequestException(msg);
      throw new ServiceUnavailableException(msg);
    }
    return json as T;
  }

  // ---------- Customer ----------

  /** Cria (ou atualiza) o cliente do tenant no Asaas e devolve o `asaasCustomerId`. */
  async createOrUpdateCustomer(tenantId: string, data: AsaasCustomerInput): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { users: { where: { role: 'tenant_admin' }, take: 1 } } });
    const body = {
      name: data.name?.trim() || tenant.name,
      cpfCnpj: onlyDigits(data.cpfCnpj),
      email: data.email || tenant.users[0]?.email,
      mobilePhone: onlyDigits(data.mobilePhone),
      postalCode: onlyDigits(data.postalCode),
      addressNumber: data.addressNumber,
      externalReference: tenantId,
      notificationDisabled: false,
    };
    if (tenant.asaasCustomerId) {
      await this.request('PUT', `/customers/${tenant.asaasCustomerId}`, body);
      return tenant.asaasCustomerId;
    }
    const c = await this.request<AsaasCustomer>('POST', '/customers', body);
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { asaasCustomerId: c.id } });
    return c.id;
  }

  /** Dados já cadastrados no Asaas, para preencher o checkout de novo sem redigitar. */
  async customerOf(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (!tenant.asaasCustomerId) return null;
    const c = await this.request<AsaasCustomer>('GET', `/customers/${tenant.asaasCustomerId}`);
    return { name: c.name, cpfCnpj: c.cpfCnpj, email: c.email, mobilePhone: c.mobilePhone, postalCode: c.postalCode, addressNumber: c.addressNumber };
  }

  // ---------- Cartão / assinatura / PIX ----------

  /** Tokeniza o cartão no Asaas. O token é o que a assinatura usa para cobrar todo mês. */
  async tokenizeCreditCard(input: { customer: string; card: AsaasCard; holder: AsaasCardHolder; remoteIp: string }) {
    return this.request<{ creditCardToken: string; creditCardNumber: string; creditCardBrand: string }>('POST', '/creditCard/tokenizeCreditCard', {
      customer: input.customer,
      creditCard: { ...input.card, number: onlyDigits(input.card.number) },
      creditCardHolderInfo: { ...input.holder, cpfCnpj: onlyDigits(input.holder.cpfCnpj), postalCode: onlyDigits(input.holder.postalCode), phone: onlyDigits(input.holder.phone), mobilePhone: onlyDigits(input.holder.phone) },
      remoteIp: input.remoteIp,
    });
  }

  /** Assinatura recorrente. Primeiro vencimento hoje: o cliente paga para começar. */
  async createSubscription(dto: { customer: string; billingType: AsaasBillingType; value: number; cycle: 'MONTHLY' | 'YEARLY'; description: string; externalReference: string; creditCardToken?: string; remoteIp?: string }) {
    return this.request<AsaasSubscription>('POST', '/subscriptions', { ...dto, nextDueDate: ymd() });
  }

  async getPixQrCode(paymentId: string) {
    return this.request<{ encodedImage: string; payload: string; expirationDate: string }>('GET', `/payments/${paymentId}/pixQrCode`);
  }

  /** Cancela no Asaas — usado quando o dono põe o cliente num plano gratuito. */
  async cancelSubscription(subscriptionId: string) {
    await this.request('DELETE', `/subscriptions/${subscriptionId}`);
  }

  /** Cobrança avulsa (boleto ou PIX, à escolha do cliente no link) — usada no "Pagar todos". */
  async createCharge(dto: { customer: string; value: number; dueDate: string; description: string; externalReference: string }) {
    return this.request<AsaasPayment>('POST', '/payments', { ...dto, billingType: 'UNDEFINED' });
  }

  async deletePayment(paymentId: string) {
    await this.request('DELETE', `/payments/${encodeURIComponent(paymentId)}`);
  }

  /** Cobrança em aberto de uma assinatura (a mais antiga, vencida primeiro), ou null. */
  async openSubscriptionPayment(subscriptionId: string) {
    const list = await this.request<AsaasList<AsaasPayment>>('GET', `/subscriptions/${subscriptionId}/payments?limit=20`);
    const order = (s: string) => (s === 'OVERDUE' ? 0 : 1);
    return list.data
      .filter((p) => !p.deleted && (p.status === 'PENDING' || p.status === 'OVERDUE'))
      .sort((a, b) => order(a.status) - order(b.status) || a.dueDate.localeCompare(b.dueDate))[0] ?? null;
  }

  /** Reajuste: muda o valor das próximas cobranças, sem mexer na que já foi gerada. */
  async updateSubscriptionValue(subscriptionId: string, value: number) {
    await this.request('PUT', `/subscriptions/${subscriptionId}`, { value, updatePendingPayments: false });
  }

  // ---------- Checkout (cliente) ----------

  async checkout(tenantId: string, input: { planId: string; billingType: AsaasBillingType; customer: AsaasCustomerInput; card?: AsaasCard; holder?: AsaasCardHolder; remoteIp: string }) {
    const plan = await this.prisma.plan.findFirst({ where: { id: input.planId, isActive: true } });
    if (!plan) throw new BadRequestException('Plano não disponível para assinatura online');
    // gratuito/personalizado são atribuídos pelo dono — mesma trava do Stripe
    if (!isStripeBillable(plan.billingCycle)) throw new BadRequestException('Este plano não é assinado online. Fale com a equipe para ativá-lo.');
    if (input.billingType === 'CREDIT_CARD' && (!input.card || !input.holder)) throw new BadRequestException('Informe os dados do cartão e do titular');

    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    // grupo consolidado: a assinatura cobra o plano por empresa ativa (`units`, mantido pelo DuesService)
    const { value, cycle } = chargeOf(plan, sub?.units ?? 1);
    if (value <= 0) throw new BadRequestException('Plano sem valor definido');
    // assinatura viva no Stripe: criar outra no Asaas cobraria o cliente duas vezes
    if (sub?.externalId && sub.gateway !== 'asaas' && LIVE.includes(sub.status)) {
      throw new BadRequestException('Sua assinatura atual é cobrada por cartão internacional. Cancele-a em “Pagamento e faturas” ou fale com o suporte para migrar.');
    }

    const customer = await this.createOrUpdateCustomer(tenantId, input.customer);
    const token = input.billingType === 'CREDIT_CARD' ? (await this.tokenizeCreditCard({ customer, card: input.card!, holder: input.holder!, remoteIp: input.remoteIp })).creditCardToken : undefined;
    const description = `Atendo ${plan.name}`;

    let subscriptionId: string;
    if (sub?.gateway === 'asaas' && sub.externalId && LIVE.includes(sub.status)) {
      // já assina pelo Asaas: troca plano/forma de pagamento na mesma assinatura. A cobrança
      // em aberto passa a ter o valor novo (sem proporcional — o Asaas não calcula)
      subscriptionId = sub.externalId;
      await this.request('PUT', `/subscriptions/${subscriptionId}`, { billingType: input.billingType, value, cycle, description, updatePendingPayments: true });
      if (token) await this.request('PUT', `/subscriptions/${subscriptionId}/creditCard`, { creditCardToken: token, remoteIp: input.remoteIp });
      await this.prisma.subscription.update({ where: { tenantId }, data: { planId: plan.id, priceMonth: plan.priceMonth } });
    } else {
      const remote = await this.createSubscription({ customer, billingType: input.billingType, value, cycle, description, externalReference: tenantId, creditCardToken: token, remoteIp: input.remoteIp });
      subscriptionId = remote.id;
      const now = new Date();
      const end = new Date(now);
      end.setMonth(end.getMonth() + (cycle === 'YEARLY' ? 12 : 1));
      // o status só muda com o pagamento (webhook): quem está em teste segue em teste, quem
      // estava suspenso segue suspenso até o PIX cair
      await this.prisma.subscription.upsert({
        where: { tenantId },
        create: { tenantId, planId: plan.id, status: 'trialing', gateway: 'asaas', externalId: subscriptionId, currentPeriodStart: now, currentPeriodEnd: end, priceMonth: plan.priceMonth },
        update: { planId: plan.id, gateway: 'asaas', externalId: subscriptionId, priceMonth: plan.priceMonth, cancelAtPeriodEnd: false, canceledAt: null },
      });
    }
    this.log.log(`checkout Asaas tenant ${tenantId}: ${plan.name} via ${input.billingType} (${subscriptionId})`);

    const list = await this.request<AsaasList<AsaasPayment>>('GET', `/subscriptions/${subscriptionId}/payments?limit=10`);
    const open = list.data.filter((p) => !p.deleted).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).find((p) => !PAID.includes(p.status)) ?? list.data[0];
    return { payment: open ? await this.view(tenantId, open, true) : null };
  }

  /** Cobrança em aberto mais antiga (vencida primeiro) — é o "pagar agora" da tela. */
  async pendingPayment(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (!tenant.asaasCustomerId) return { payment: null };
    const list = await this.request<AsaasList<AsaasPayment>>('GET', `/payments?customer=${tenant.asaasCustomerId}&limit=50`);
    const order = (s: string) => (s === 'OVERDUE' ? 0 : 1);
    const open = list.data
      .filter((p) => !p.deleted && (p.status === 'PENDING' || p.status === 'OVERDUE'))
      .sort((a, b) => order(a.status) - order(b.status) || a.dueDate.localeCompare(b.dueDate))[0];
    return { payment: open ? await this.view(tenantId, open, true) : null };
  }

  /**
   * Situação de uma cobrança, consultada no Asaas (é o polling do modal do PIX). Se já foi
   * paga, aplica aqui o mesmo efeito do webhook: em dev o webhook nem chega, e em produção ele
   * pode atrasar — o cliente não pode ficar olhando o QR depois de pagar.
   */
  async paymentStatus(tenantId: string, paymentId: string, withPix: boolean) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const p = await this.request<AsaasPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`).catch(() => null);
    // cobrança de outro cliente é "não encontrada", não "proibida": não confirma que existe
    if (!p || !tenant.asaasCustomerId || p.customer !== tenant.asaasCustomerId) throw new NotFoundException('Cobrança não encontrada');
    return this.view(tenantId, p, withPix);
  }

  async view(tenantId: string, p: AsaasPayment, withPix: boolean): Promise<PaymentView> {
    const paid = PAID.includes(p.status);
    if (paid) await this.onPaid(tenantId, p);
    else await this.syncInvoice(tenantId, p);
    // PIX também é aceito em boleto/indefinido; cartão não tem QR
    const pix = withPix && !paid && p.billingType !== 'CREDIT_CARD' ? await this.getPixQrCode(p.id).catch(() => null) : null;
    return { id: p.id, status: p.status, paid, billingType: p.billingType, value: p.value, dueDate: p.dueDate, invoiceUrl: p.invoiceUrl ?? null, pix: pix && { encodedImage: pix.encodedImage, payload: pix.payload, expirationDate: pix.expirationDate } };
  }

  // ---------- Webhook ----------

  async handle(body: { event?: string; payment?: AsaasPayment; subscription?: AsaasSubscription }) {
    const { event, payment, subscription } = body;
    if (payment) {
      const tenant = await this.prisma.tenant.findUnique({ where: { asaasCustomerId: payment.customer } });
      if (!tenant) return this.log.warn(`webhook ${event}: cobrança ${payment.id} sem tenant (customer ${payment.customer})`);
      switch (event) {
        case 'PAYMENT_RECEIVED':
        case 'PAYMENT_CONFIRMED':
          return this.onPaid(tenant.id, payment);
        case 'PAYMENT_OVERDUE':
          return this.onOverdue(tenant.id, payment);
        case 'PAYMENT_CREATED':
          await this.syncInvoice(tenant.id, payment);
          return this.addOverage(tenant.id, payment);
        case 'PAYMENT_DELETED':
        case 'PAYMENT_REFUNDED':
          return this.syncInvoice(tenant.id, payment, 'void');
        default:
          return this.syncInvoice(tenant.id, payment);
      }
    }
    if (subscription && (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED')) {
      // só cancela se ainda for a assinatura do cliente: ao passar para plano gratuito o
      // `externalId` é zerado antes, e este evento não pode tirar ninguém da cortesia
      const r = await this.prisma.subscription.updateMany({ where: { gateway: 'asaas', externalId: subscription.id }, data: { status: 'canceled', canceledAt: new Date(), graceUntil: null } });
      if (r.count) this.log.warn(`assinatura Asaas ${subscription.id} cancelada`);
      return;
    }
    this.log.debug(`evento Asaas ignorado: ${event}`);
  }

  /** Espelha a cobrança em `invoices` (link de pagamento do Asaas em `hostedUrl`). */
  private async syncInvoice(tenantId: string, p: AsaasPayment, force?: InvoiceStatus) {
    const status: InvoiceStatus = force ?? (PAID.includes(p.status) ? 'paid' : ['REFUNDED', 'REFUND_REQUESTED'].includes(p.status) || p.deleted ? 'void' : 'open');
    // cobrança avulsa de excedente: o período é o do uso, não o do vencimento
    const ref = p.externalReference?.startsWith(OVERAGE_REF) ? p.externalReference.split(':')[2] : null;
    const period = ref ?? periodOf(fromYmd(p.dueDate));
    const amounts = ref ? { baseAmount: 0, overageAmount: p.value } : { baseAmount: p.value, overageAmount: 0 };
    const paidAt = status === 'paid' ? (p.paymentDate ? fromYmd(p.paymentDate) : new Date()) : null;
    await this.prisma.invoice.upsert({
      where: { externalId: p.id },
      create: { tenantId, period, externalId: p.id, ...amounts, totalAmount: p.value, currency: 'BRL', status, hostedUrl: p.invoiceUrl ?? null, dueAt: fromYmd(p.dueDate), paidAt },
      update: { status, ...amounts, totalAmount: p.value, hostedUrl: p.invoiceUrl ?? null, dueAt: fromYmd(p.dueDate), paidAt },
    });
  }

  /** Pagou: assinatura volta a `active` e o próximo vencimento vem do Asaas. Idempotente. */
  private async onPaid(tenantId: string, p: AsaasPayment) {
    if (p.externalReference?.startsWith(BULK_REF)) return this.settleConsolidated(tenantId, p);
    await this.syncInvoice(tenantId, p, 'paid');
    if (!p.subscription) return; // avulsa (excedente): só a fatura muda
    await this.activateSubscription(tenantId, p.subscription, p.dueDate, p.id);
  }

  /**
   * Cobrança consolidada paga: cada item volta a `active` e anda um ciclo. Webhook e polling do
   * modal chegam juntos — quem vira a fatura para `paid` primeiro aplica, o outro não faz nada,
   * senão o vencimento andaria dois ciclos por um pagamento.
   */
  private async settleConsolidated(tenantId: string, p: AsaasPayment) {
    const claimed = await this.prisma.invoice.updateMany({ where: { tenantId, externalId: p.id, status: { not: 'paid' } }, data: { status: 'paid', paidAt: p.paymentDate ? fromYmd(p.paymentDate) : new Date() } });
    await this.syncInvoice(tenantId, p, 'paid');
    if (!claimed.count) return;
    const inv = await this.prisma.invoice.findUnique({ where: { externalId: p.id }, select: { items: true } });
    const items = (inv?.items ?? []) as unknown as ConsolidatedItem[];
    for (const it of items) {
      try {
        if (it.kind === 'company' && it.companyId) {
          const cs = await this.prisma.companySubscription.findFirst({ where: { tenantId, companyId: it.companyId } });
          if (!cs) continue;
          const end = nextPeriodEnd(cs.currentPeriodEnd, it.cycle);
          await this.prisma.companySubscription.update({ where: { id: cs.id }, data: { status: 'active', currentPeriodStart: cs.currentPeriodEnd, currentPeriodEnd: end } });
          continue;
        }
        const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
        if (!sub) continue;
        // com assinatura no Asaas a data vem dela (a cobrança substituída já tinha avançado o
        // `nextDueDate`); sem gateway, anda um ciclo a partir do vencimento
        if (it.replacesPaymentId && sub.gateway === 'asaas' && sub.externalId) await this.activateSubscription(tenantId, sub.externalId, p.dueDate, p.id);
        else await this.prisma.subscription.update({ where: { tenantId }, data: { status: 'active', graceUntil: null, currentPeriodStart: sub.currentPeriodEnd, currentPeriodEnd: nextPeriodEnd(sub.currentPeriodEnd, it.cycle) } });
      } catch (err) {
        this.log.error(`cobrança consolidada ${p.id}: item ${it.key} não foi baixado: ${(err as Error)?.message ?? err}`);
      }
    }
    this.log.log(`cobrança consolidada ${p.id} paga: ${items.map((i) => i.label).join(', ')}`);
  }

  private async activateSubscription(tenantId: string, subscriptionId: string, dueDate: string, paymentId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub || sub.gateway !== 'asaas' || sub.externalId !== subscriptionId) return this.log.warn(`pagamento ${paymentId}: assinatura ${subscriptionId} não é a atual do tenant ${tenantId}`);
    const remote = await this.request<AsaasSubscription>('GET', `/subscriptions/${subscriptionId}`).catch(() => null);
    const start = fromYmd(dueDate);
    const end = remote?.nextDueDate ? fromYmd(remote.nextDueDate) : new Date(start.getTime() + 30 * 86_400_000);
    // o período só anda para frente: um webhook repetido de um pagamento antigo não volta a data
    const avanca = end > sub.currentPeriodEnd;
    await this.prisma.subscription.update({
      where: { tenantId },
      data: { status: 'active', graceUntil: null, ...(avanca && { currentPeriodStart: start, currentPeriodEnd: end }) },
    });
    if (sub.status !== 'active') this.log.log(`tenant ${tenantId}: ${sub.status} → active (pagamento ${paymentId})`);
  }

  /**
   * Venceu sem pagar: `past_due` com carência (`graceDays` do plano). O job diário suspende
   * quando a carência acaba — mesmo caminho do Stripe (`suspendOverdue`).
   */
  private async onOverdue(tenantId: string, p: AsaasPayment) {
    await this.syncInvoice(tenantId, p);
    if (!p.subscription) return;
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub || sub.externalId !== p.subscription || !['active', 'trialing'].includes(sub.status)) return;
    const graceDays = (sub.plan.limits as { graceDays?: number })?.graceDays ?? 5;
    const graceUntil = new Date(Date.now() + graceDays * 86_400_000);
    await this.prisma.subscription.update({ where: { tenantId }, data: { status: 'past_due', graceUntil } });
    this.log.warn(`tenant ${tenantId}: cobrança ${p.id} vencida → past_due até ${graceUntil.toISOString()}`);
    const to = await this.usage.adminEmails(tenantId);
    if (!to.length) return;
    this.mail.send({
      to,
      subject: 'Sua mensalidade do Atendo venceu',
      text: `A cobrança de ${brl(p.value)} com vencimento em ${fromYmd(p.dueDate).toLocaleDateString('pt-BR')} não foi paga.

Pague até ${graceUntil.toLocaleDateString('pt-BR')} para não ter o envio de mensagens suspenso. PIX e cartão em:

${env.WEB_ORIGIN}/plano

O recebimento de mensagens continua normal.`,
    }).catch(() => undefined);
  }

  /**
   * Nova cobrança do ciclo foi gerada: cobra à parte o excedente do mês que fechou. O Asaas
   * não aceita item extra numa cobrança de assinatura, então vira uma cobrança avulsa (PIX,
   * boleto ou cartão, à escolha do cliente no link). Não roda na primeira cobrança.
   */
  private async addOverage(tenantId: string, p: AsaasPayment) {
    if (!p.subscription) return;
    const first = await this.request<AsaasList<AsaasPayment>>('GET', `/subscriptions/${p.subscription}/payments?limit=2`);
    if (first.totalCount <= 1) return;
    const now = new Date();
    const period = periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    // o mês já foi cobrado (webhook repetido, ou plano trocado no meio): não cobra de novo
    const ja = await this.prisma.invoice.findFirst({ where: { tenantId, period, baseAmount: 0, overageAmount: { gt: 0 } } });
    if (ja) return;
    await this.usage.reconcile(period);
    const counter = await this.prisma.usageCounter.findUnique({ where: { tenantId_period: { tenantId, period } } });
    const overage = Math.round(Number(counter?.overageAmount ?? 0) * 100) / 100;
    if (overage <= 0) return;
    const charge = await this.request<AsaasPayment>('POST', '/payments', {
      customer: p.customer,
      billingType: 'UNDEFINED',
      value: overage,
      dueDate: p.dueDate,
      description: `Excedente de uso — ${period} (${counter?.messagesSent} mensagens, ${counter?.templatesSent} templates)`,
      externalReference: `${OVERAGE_REF}${tenantId}:${period}`,
    });
    await this.syncInvoice(tenantId, charge);
    this.log.log(`excedente ${period} tenant ${tenantId}: ${brl(overage)} cobrado à parte (${charge.id})`);
  }
}
