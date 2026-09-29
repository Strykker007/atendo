import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import type { InvoiceStatus, SubscriptionStatus } from '@prisma/client';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService, periodOf } from './usage.service';
import { MailService } from '../../common/mail/mail.service';

/**
 * Integração com o Stripe.
 *
 * Modelo: cada Plano = um Price recorrente mensal no Stripe. O tenant vira um Customer
 * no primeiro checkout. A assinatura do Stripe é a fonte da verdade do status; o nosso
 * `subscriptions` é um espelho atualizado pelos webhooks.
 *
 * Excedente (mensagens/templates além do incluído) entra como InvoiceItem na fatura do
 * ciclo seguinte, no evento `invoice.created` — o Stripe dá ~1 h antes de finalizar.
 */
@Injectable()
export class StripeService {
  private readonly log = new Logger(StripeService.name);
  readonly enabled = !!env.STRIPE_SECRET_KEY;
  private readonly stripe = this.enabled ? new Stripe(env.STRIPE_SECRET_KEY) : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly mail: MailService,
  ) {}

  private get client(): Stripe {
    if (!this.stripe) throw new ServiceUnavailableException('Cobrança não configurada (STRIPE_SECRET_KEY ausente)');
    return this.stripe;
  }

  // ---------- Customer / Checkout / Portal ----------

  private async customerFor(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { users: { where: { role: 'tenant_admin' }, take: 1 } } });
    if (tenant.stripeCustomerId) return tenant.stripeCustomerId;
    const customer = await this.client.customers.create({ name: tenant.name, email: tenant.users[0]?.email, metadata: { tenantId } });
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customer.id } });
    return customer.id;
  }

  /** Cria uma sessão de Checkout para assinar/trocar de plano. Devolve a URL para redirecionar. */
  async checkout(tenantId: string, planId: string) {
    const plan = await this.prisma.plan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan?.stripePriceId) throw new BadRequestException('Plano não disponível para assinatura online');
    const customer = await this.customerFor(tenantId);
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });

    // já tem assinatura Stripe ativa → troca de plano direto na assinatura (proration), sem novo checkout
    if (sub?.externalId && ['active', 'past_due', 'trialing'].includes(sub.status)) {
      const s = await this.client.subscriptions.retrieve(sub.externalId);
      await this.client.subscriptions.update(sub.externalId, {
        items: [{ id: s.items.data[0].id, price: plan.stripePriceId }],
        proration_behavior: 'create_prorations',
        metadata: { tenantId, planId },
      });
      await this.prisma.subscription.update({ where: { tenantId }, data: { planId } });
      return { url: `${env.WEB_ORIGIN}/plano?changed=1` };
    }

    const session = await this.client.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${env.WEB_ORIGIN}/plano?success=1`,
      cancel_url: `${env.WEB_ORIGIN}/plano?canceled=1`,
      locale: 'pt-BR',
      subscription_data: { metadata: { tenantId, planId } },
      metadata: { tenantId, planId },
    });
    return { url: session.url! };
  }

  /** Portal do cliente: trocar cartão, ver faturas, cancelar. */
  async portal(tenantId: string) {
    const customer = await this.customerFor(tenantId);
    const session = await this.client.billingPortal.sessions.create({ customer, return_url: `${env.WEB_ORIGIN}/plano`, locale: 'pt-BR' });
    return { url: session.url };
  }

  // ---------- Webhook ----------

  constructEvent(rawBody: Buffer, signature: string) {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new BadRequestException('STRIPE_WEBHOOK_SECRET ausente');
    return this.client.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  }

  async handle(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode === 'subscription' && s.subscription && s.metadata?.tenantId) {
          await this.syncSubscription(await this.client.subscriptions.retrieve(String(s.subscription)));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.syncSubscription(event.data.object);
        break;
      case 'invoice.created':
        await this.addOverage(event.data.object);
        break;
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.finalized':
      case 'invoice.voided':
        await this.syncInvoice(event.data.object);
        break;
      default:
        this.log.debug(`evento ignorado: ${event.type}`);
    }
  }

  private mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
    const map: Record<string, SubscriptionStatus> = { trialing: 'trialing', active: 'active', past_due: 'past_due', unpaid: 'suspended', canceled: 'canceled', incomplete: 'past_due', incomplete_expired: 'canceled', paused: 'suspended' };
    return map[s] ?? 'past_due';
  }

  /** Espelha a assinatura do Stripe em `subscriptions`. tenantId vem do metadata ou do customer. */
  private async syncSubscription(s: Stripe.Subscription) {
    const tenantId = s.metadata?.tenantId ?? (await this.prisma.tenant.findUnique({ where: { stripeCustomerId: String(s.customer) } }))?.id;
    if (!tenantId) return this.log.warn(`assinatura ${s.id} sem tenant`);
    const priceId = s.items.data[0]?.price.id;
    const plan = priceId ? await this.prisma.plan.findUnique({ where: { stripePriceId: priceId } }) : null;
    const status = this.mapStatus(s.status);
    const item = s.items.data[0];
    const start = new Date(item.current_period_start * 1000);
    const end = new Date(item.current_period_end * 1000);

    const existing = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    const limits = (plan ?? existing?.plan)?.limits as { graceDays?: number } | undefined;
    const graceUntil = status === 'past_due' ? new Date(Date.now() + (limits?.graceDays ?? 5) * 86_400_000) : null;

    await this.prisma.subscription.upsert({
      where: { tenantId },
      create: { tenantId, planId: plan?.id ?? existing?.planId ?? (await this.prisma.plan.findFirstOrThrow()).id, status, externalId: s.id, currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: s.cancel_at_period_end, graceUntil },
      update: { ...(plan && { planId: plan.id }), status, externalId: s.id, currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: s.cancel_at_period_end, graceUntil, canceledAt: s.canceled_at ? new Date(s.canceled_at * 1000) : null },
    });
    this.log.log(`assinatura ${s.id} → tenant ${tenantId}: ${status}`);
  }

  /**
   * Fatura do novo ciclo acabou de ser criada: adiciona o excedente do ciclo que fechou.
   * Só para `subscription_cycle` (não para a primeira fatura do checkout).
   */
  private async addOverage(inv: Stripe.Invoice) {
    if (inv.billing_reason !== 'subscription_cycle' || !inv.customer) return;
    const tenant = await this.prisma.tenant.findUnique({ where: { stripeCustomerId: String(inv.customer) } });
    if (!tenant) return;
    // período que fechou = mês anterior ao início desta fatura
    const periodStart = new Date(inv.period_start * 1000);
    const closed = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() - 1, 1));
    const period = periodOf(closed);
    await this.usage.reconcile(period);
    const counter = await this.prisma.usageCounter.findUnique({ where: { tenantId_period: { tenantId: tenant.id, period } } });
    const overage = Number(counter?.overageAmount ?? 0);
    if (overage <= 0) return;
    await this.client.invoiceItems.create({
      customer: String(inv.customer),
      invoice: inv.id,
      amount: Math.round(overage * 100),
      currency: env.STRIPE_CURRENCY,
      description: `Excedente de uso — ${period} (${counter?.messagesSent} mensagens, ${counter?.templatesSent} templates)`,
    });
    this.log.log(`excedente ${period} tenant ${tenant.id}: R$ ${overage.toFixed(2)} adicionado à fatura ${inv.id}`);
  }

  private async syncInvoice(inv: Stripe.Invoice) {
    const tenant = inv.customer ? await this.prisma.tenant.findUnique({ where: { stripeCustomerId: String(inv.customer) } }) : null;
    if (!tenant) return;
    const invMap: Record<string, InvoiceStatus> = { draft: 'draft', open: 'open', paid: 'paid', uncollectible: 'failed', void: 'void' };
    const status = invMap[inv.status ?? 'draft'] ?? 'draft';
    const period = periodOf(new Date(inv.period_start * 1000));
    const overageAmount = (inv.lines?.data ?? []).filter((l) => l.description?.startsWith('Excedente')).reduce((a, l) => a + l.amount, 0) / 100;
    await this.prisma.invoice.upsert({
      where: { externalId: inv.id },
      create: { tenantId: tenant.id, period, externalId: inv.id, baseAmount: inv.subtotal / 100 - overageAmount, overageAmount, totalAmount: inv.total / 100, currency: inv.currency.toUpperCase(), status, hostedUrl: inv.hosted_invoice_url ?? null, dueAt: inv.due_date ? new Date(inv.due_date * 1000) : null, paidAt: inv.status === 'paid' ? new Date() : null },
      update: { status, totalAmount: inv.total / 100, overageAmount, baseAmount: inv.subtotal / 100 - overageAmount, hostedUrl: inv.hosted_invoice_url ?? null, paidAt: inv.status === 'paid' ? new Date() : null },
    });
    if (inv.status === 'paid') {
      // pagou: se estava em carência/suspenso, volta a ativo
      await this.prisma.subscription.updateMany({ where: { tenantId: tenant.id, status: { in: ['past_due', 'suspended'] } }, data: { status: 'active', graceUntil: null } });
    }
    if (inv.status === 'open' && inv.attempt_count && inv.attempt_count > 0) {
      // tentativa de cobrança falhou: avisa com o link da fatura e a data-limite
      const sub = await this.prisma.subscription.findUnique({ where: { tenantId: tenant.id }, include: { plan: true } });
      const grace = sub?.graceUntil ? sub.graceUntil.toLocaleDateString('pt-BR') : `${(sub?.plan.limits as { graceDays?: number })?.graceDays ?? 5} dias`;
      const to = await this.usage.adminEmails(tenant.id);
      if (to.length) {
        this.mail.send({
          to,
          subject: 'Não conseguimos cobrar a sua assinatura do Atendo',
          text: `A cobrança de ${(inv.total / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} falhou.

Atualize o cartão ou pague a fatura até ${grace} para não ter o envio de mensagens suspenso:

${inv.hosted_invoice_url ?? env.WEB_ORIGIN + '/plano'}

O recebimento de mensagens continua normal.`,
        }).catch(() => undefined);
      }
    }
  }

  // ---------- Suspensão por carência (job diário) ----------

  async suspendOverdue() {
    const overdue = await this.prisma.subscription.findMany({ where: { status: 'past_due', graceUntil: { lt: new Date() } } });
    if (!overdue.length) return;
    await this.prisma.subscription.updateMany({ where: { id: { in: overdue.map((s) => s.id) } }, data: { status: 'suspended' } });
    this.log.warn(`${overdue.length} assinatura(s) suspensa(s) por carência vencida`);
    for (const s of overdue) {
      const to = await this.usage.adminEmails(s.tenantId);
      if (!to.length) continue;
      this.mail.send({
        to,
        subject: 'Assinatura do Atendo suspensa — envio de mensagens bloqueado',
        text: `A carência para regularizar o pagamento terminou e a assinatura foi suspensa.

Suas conversas continuam chegando, mas a equipe não consegue responder até o pagamento ser regularizado:

${env.WEB_ORIGIN}/plano

Assim que o pagamento for confirmado, tudo volta ao normal automaticamente.`,
      }).catch(() => undefined);
    }
  }

  // ---------- Sincronizar planos → Stripe (Products/Prices) ----------

  async syncPlans() {
    const plans = await this.prisma.plan.findMany({ where: { isActive: true } });
    for (const p of plans) {
      if (p.stripePriceId) continue;
      const product = await this.client.products.create({ name: `Atendo ${p.name}`, metadata: { planId: p.id } });
      const price = await this.client.prices.create({ product: product.id, unit_amount: Math.round(Number(p.priceMonth) * 100), currency: env.STRIPE_CURRENCY, recurring: { interval: 'month' }, metadata: { planId: p.id } });
      await this.prisma.plan.update({ where: { id: p.id }, data: { stripePriceId: price.id } });
      this.log.log(`plano ${p.name} → ${price.id}`);
    }
  }

  // ---------- Margem (super_admin) ----------

  async margin(period = periodOf()) {
    const tenants = await this.prisma.tenant.findMany({ include: { subscription: { include: { plan: true } }, numbers: { select: { infraCostMonth: true, provider: true } } } });
    const counters = await this.prisma.usageCounter.findMany({ where: { period } });
    const byTenant = new Map(counters.map((c) => [c.tenantId, c]));
    return tenants.map((t) => {
      const c = byTenant.get(t.id);
      const price = Number(t.subscription?.plan.priceMonth ?? 0);
      const overage = Number(c?.overageAmount ?? 0);
      const providerCost = Number(c?.providerCost ?? 0);
      const infra = t.numbers.reduce((a, n) => a + Number(n.infraCostMonth), 0);
      const revenue = price + overage;
      const cost = providerCost + infra;
      return { tenantId: t.id, name: t.name, plan: t.subscription?.plan.name ?? null, status: t.subscription?.status ?? null, revenue, overage, providerCost, infraCost: infra, margin: revenue - cost, marginPct: revenue ? ((revenue - cost) / revenue) * 100 : 0, messagesSent: c?.messagesSent ?? 0, templatesSent: c?.templatesSent ?? 0 };
    });
  }
}
