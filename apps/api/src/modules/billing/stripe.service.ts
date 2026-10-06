import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import type { InvoiceStatus, Plan, SubscriptionStatus } from '@prisma/client';
import { isStripeBillable } from '@atendo/shared';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService, periodOf } from './usage.service';
import { MailService } from '../../common/mail/mail.service';
import { aReajustar, porExtenso } from './reprice';
import { freePeriod, rollMonthly } from './plan-rules';

/** Price do Stripe de um plano: anual cobra `priceYear` por ano; o resto, a mensalidade. */
const stripePriceOf = (p: Plan) =>
  p.billingCycle === 'yearly'
    ? { unit_amount: Math.round(Number(p.priceYear ?? 0) * 100), recurring: { interval: 'year' as const } }
    : { unit_amount: Math.round(Number(p.priceMonth) * 100), recurring: { interval: 'month' as const } };

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
    // gratuito/personalizado não passam pelo gateway: quem atribui é o dono, em Clientes.
    // Sem esta trava um cliente pagante se rebaixaria sozinho para a cortesia
    if (plan && !isStripeBillable(plan.billingCycle)) throw new BadRequestException('Este plano não é assinado online. Fale com a equipe para ativá-lo.');
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
      // troca de plano = contrato novo: passa a valer o preço de tabela do plano escolhido
      await this.prisma.subscription.update({ where: { tenantId }, data: { planId, priceMonth: plan.priceMonth } });
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
    // o dono passou o cliente para um plano gratuito e a assinatura paga antiga foi cancelada
    // no Stripe: o evento desse cancelamento não pode tirar o cliente da cortesia
    if (existing?.plan.isFree && existing.externalId !== s.id && !['active', 'trialing'].includes(status)) {
      return this.log.log(`assinatura ${s.id} (${status}) ignorada: tenant ${tenantId} está em plano gratuito`);
    }
    const limits = (plan ?? existing?.plan)?.limits as { graceDays?: number } | undefined;
    const graceUntil = status === 'past_due' ? new Date(Date.now() + (limits?.graceDays ?? 5) * 86_400_000) : null;

    // o preço contratado vem do próprio item da assinatura, não do catálogo: é o valor que o
    // Stripe realmente cobra deste cliente, mesmo que o plano já tenha outro preço de tabela
    // anual vira equivalente mensal, como `plans.priceMonth` (MRR e reajuste comparam mensal)
    const porAno = item.price.recurring?.interval === 'year';
    const cobrado = item.price.unit_amount != null ? Math.round(item.price.unit_amount / (porAno ? 12 : 1)) / 100 : undefined;

    await this.prisma.subscription.upsert({
      where: { tenantId },
      create: { tenantId, planId: plan?.id ?? existing?.planId ?? (await this.prisma.plan.findFirstOrThrow()).id, status, externalId: s.id, currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: s.cancel_at_period_end, graceUntil, priceMonth: cobrado },
      update: { ...(plan && { planId: plan.id }), status, externalId: s.id, currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: s.cancel_at_period_end, graceUntil, canceledAt: s.canceled_at ? new Date(s.canceled_at * 1000) : null, ...(cobrado !== undefined && { priceMonth: cobrado }) },
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
      // fatura paga re-espelha a assinatura do Stripe: se o `customer.subscription.*` se perdeu
      // (ou não está assinado no endpoint), o cliente pagava e seguia `trialing`, fora do MRR
      const subId = inv.parent?.subscription_details?.subscription;
      if (subId) {
        await this.syncSubscription(typeof subId === 'string' ? await this.client.subscriptions.retrieve(subId) : subId)
          .catch((e) => this.log.warn(`fatura ${inv.id}: falha ao re-sincronizar assinatura: ${e}`));
      }
      // pagou: se estava em carência/suspenso — ou em teste com cobrança de verdade — vira ativo
      const from: SubscriptionStatus[] = inv.total > 0 ? ['past_due', 'suspended', 'trialing'] : ['past_due', 'suspended'];
      await this.prisma.subscription.updateMany({ where: { tenantId: tenant.id, status: { in: from } }, data: { status: 'active', graceUntil: null } });
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

  // ---------- Atribuição manual (dono) e planos gratuitos ----------

  /**
   * O dono põe o cliente num plano sem passar pelo checkout (tela Clientes).
   *
   * Gratuito: a assinatura nasce `active`, sem cartão, preço 0 e sem vínculo com o Stripe. Se
   * o cliente tinha assinatura paga, ela é **cancelada no Stripe antes** — senão ele seguiria
   * sendo cobrado num plano de cortesia. Se o cancelamento falhar, nada muda aqui.
   */
  async assignPlan(tenantId: string, planId: string, status?: SubscriptionStatus) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (plan.isFree) {
      if (sub?.externalId && this.enabled && ['active', 'past_due', 'trialing', 'suspended'].includes(sub.status)) {
        await this.client.subscriptions.cancel(sub.externalId, { prorate: false });
        this.log.log(`tenant ${tenantId}: assinatura ${sub.externalId} cancelada no Stripe (plano gratuito ${plan.name})`);
      }
      const { start, end } = freePeriod(plan.durationDays);
      // sempre `active`: o status que vinha do formulário era o do plano anterior (ex.: past_due)
      const data = { planId, status: 'active' as const, currentPeriodStart: start, currentPeriodEnd: end, priceMonth: 0, externalId: null, cancelAtPeriodEnd: false, graceUntil: null, canceledAt: null };
      return this.prisma.subscription.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    }
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);
    // mudou de plano = preço contratado passa a ser o do plano novo. Sem isto o cliente
    // ficaria com o preço do plano anterior registrado e o painel dele mostraria outro valor
    return this.prisma.subscription.upsert({
      where: { tenantId },
      create: { tenantId, planId, status: status ?? 'active', currentPeriodStart: now, currentPeriodEnd: end, priceMonth: plan.priceMonth },
      update: { planId, priceMonth: plan.priceMonth, ...(status && { status, graceUntil: null }) },
    });
  }

  /**
   * Job diário. Gratuito por período que venceu → `suspended` (envio bloqueado, recebimento
   * segue, o cliente assina um plano pago em /plano). Gratuito permanente → só rola a data.
   * Lê o `durationDays` ATUAL do plano: tornar o plano permanente estende quem já está nele.
   */
  async expireFreePlans() {
    const vencidas = await this.prisma.subscription.findMany({
      where: { status: 'active', externalId: null, currentPeriodEnd: { lt: new Date() }, plan: { isFree: true } },
      include: { plan: true },
    });
    for (const s of vencidas) {
      if (!s.plan.durationDays) {
        const { start, end } = rollMonthly(s.currentPeriodStart, s.currentPeriodEnd);
        await this.prisma.subscription.update({ where: { id: s.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } });
        continue;
      }
      await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'suspended' } });
      this.log.warn(`tenant ${s.tenantId}: período gratuito do plano ${s.plan.name} terminou — suspenso`);
      const to = await this.usage.adminEmails(s.tenantId);
      if (!to.length) continue;
      this.mail.send({
        to,
        subject: 'Seu período gratuito no Atendo terminou',
        text: `O período gratuito do plano ${s.plan.name} terminou e o envio de mensagens foi pausado.

Suas conversas continuam chegando. Para voltar a responder, escolha um plano:

${env.WEB_ORIGIN}/plano`,
      }).catch(() => undefined);
    }
  }

  // ---------- Sincronizar planos → Stripe (Products/Prices) ----------

  async syncPlans() {
    // gratuito e personalizado nunca viram price: não há o que cobrar pelo gateway
    const plans = await this.prisma.plan.findMany({ where: { isActive: true, billingCycle: { in: ['monthly', 'yearly'] } } });
    for (const p of plans) {
      if (p.stripePriceId) continue;
      const product = await this.client.products.create({ name: `Atendo ${p.name}`, metadata: { planId: p.id } });
      const price = await this.client.prices.create({ product: product.id, ...stripePriceOf(p), currency: env.STRIPE_CURRENCY, metadata: { planId: p.id } });
      await this.prisma.plan.update({ where: { id: p.id }, data: { stripePriceId: price.id } });
      this.log.log(`plano ${p.name} → ${price.id}`);
    }
  }

  /**
   * Preço mudou: no Stripe um `price` é imutável, então cria-se outro no mesmo produto e o
   * plano passa a apontar para ele. **Quem já assina continua no preço antigo** até trocar de
   * plano — é assim que o Stripe funciona, e mudar isso por baixo seria reajustar cliente sem
   * aviso. O novo valor vale para quem assinar daqui para frente.
   */
  async repricePlan(planId: string) {
    if (!this.enabled) return;
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    if (!isStripeBillable(plan.billingCycle)) return;
    let productId: string | undefined;
    if (plan.stripePriceId) {
      const anterior = await this.client.prices.retrieve(plan.stripePriceId);
      productId = typeof anterior.product === 'string' ? anterior.product : anterior.product.id;
      await this.client.prices.update(plan.stripePriceId, { active: false }).catch(() => undefined);
    }
    const product = productId ?? (await this.client.products.create({ name: `Atendo ${plan.name}`, metadata: { planId: plan.id } })).id;
    const price = await this.client.prices.create({ product, ...stripePriceOf(plan), currency: env.STRIPE_CURRENCY, metadata: { planId: plan.id } });
    await this.prisma.plan.update({ where: { id: plan.id }, data: { stripePriceId: price.id } });
    this.log.log(`plano ${plan.name} reprecificado → ${price.id}`);
  }

  // ---------- Reajuste de quem já assina ----------

  /**
   * Avisa os clientes de um plano que o preço deles vai mudar na data marcada.
   *
   * Mandado no momento do agendamento, não no dia: a graça do aviso prévio é o cliente ter
   * tempo de decidir, inclusive de sair. Avisar no dia da cobrança é comunicado, não aviso.
   */
  async notifyPriceChange(planId: string, quando: Date) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId }, include: { subscriptions: true } });
    const novo = Number(plan.priceMonth);
    for (const s of aReajustar(plan.subscriptions.map((x) => ({ id: x.id, status: x.status, priceMonth: x.priceMonth === null ? null : Number(x.priceMonth) })), novo)) {
      const sub = plan.subscriptions.find((x) => x.id === s.id)!;
      const to = await this.usage.adminEmails(sub.tenantId);
      if (!to.length) continue;
      const atual = s.priceMonth ?? novo;
      const sobe = novo > atual;
      await this.mail.send({
        to,
        subject: `Sua mensalidade ${sobe ? 'será reajustada' : 'vai mudar'} em ${porExtenso(quando)}`,
        text: `A partir de ${porExtenso(quando)}, a mensalidade do plano ${plan.name} passa de ${brl(atual)} para ${brl(novo)}.

A mudança vale a partir da sua próxima cobrança depois dessa data. Até lá, nada muda.

Seu plano e seu uso: ${env.WEB_ORIGIN}/plano`,
      }).catch(() => undefined);
    }
  }

  /**
   * Roda junto da reconciliação diária: aplica os reajustes cuja data chegou.
   *
   * No Stripe isto é trocar o `price` do item da assinatura **sem proporcional**
   * (`proration_behavior: 'none'`): o valor novo entra na próxima fatura inteira, em vez de
   * gerar uma cobrança quebrada no meio do mês que ninguém entende.
   */
  async applyDuePriceChanges() {
    const plans = await this.prisma.plan.findMany({ where: { priceAppliesToExistingAt: { lte: new Date() } }, include: { subscriptions: true } });
    for (const plan of plans) {
      const novo = Number(plan.priceMonth);
      const alvos = aReajustar(plan.subscriptions.map((x) => ({ id: x.id, status: x.status, priceMonth: x.priceMonth === null ? null : Number(x.priceMonth) })), novo);
      for (const alvo of alvos) {
        const sub = plan.subscriptions.find((x) => x.id === alvo.id)!;
        try {
          if (sub.externalId && plan.stripePriceId && this.enabled) {
            const atual = await this.client.subscriptions.retrieve(sub.externalId);
            const item = atual.items.data[0];
            if (item) {
              await this.client.subscriptions.update(sub.externalId, {
                items: [{ id: item.id, price: plan.stripePriceId }],
                proration_behavior: 'none',
              });
            }
          }
          await this.prisma.subscription.update({ where: { id: sub.id }, data: { priceMonth: plan.priceMonth } });
          this.log.log(`reajuste aplicado: tenant ${sub.tenantId} ${alvo.priceMonth ?? '—'} → ${novo} (${plan.name})`);
          const to = await this.usage.adminEmails(sub.tenantId);
          if (to.length) {
            await this.mail.send({
              to,
              subject: `Mensalidade atualizada para ${brl(novo)}`,
              text: `Conforme avisamos, a mensalidade do plano ${plan.name} passou a ${brl(novo)} e vale a partir da sua próxima cobrança.

Seu plano e seu uso: ${env.WEB_ORIGIN}/plano`,
            }).catch(() => undefined);
          }
        } catch (err) {
          // um cliente que falhou não pode impedir os outros, e tentar de novo amanhã é
          // seguro: quem já está no preço novo sai da lista sozinho
          this.log.error(`reajuste falhou para o tenant ${sub.tenantId}: ${(err as Error)?.message ?? err}`);
        }
      }
      // some da fila mesmo com falhas: quem não migrou continua no preço antigo e aparece
      // na tela como "no preço antigo", em vez de o sistema insistir calado todo dia
      await this.prisma.plan.update({ where: { id: plan.id }, data: { priceAppliesToExistingAt: null } });
    }
  }

  /** Plano apagado: arquiva preço e produto, senão o painel do Stripe vira um cemitério. */
  async archivePlan(stripePriceId: string) {
    if (!this.enabled) return;
    const price = await this.client.prices.retrieve(stripePriceId);
    await this.client.prices.update(stripePriceId, { active: false }).catch(() => undefined);
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    await this.client.products.update(productId, { active: false }).catch(() => undefined);
  }

  // ---------- Margem (super_admin) ----------

  async margin(period = periodOf()) {
    const tenants = await this.prisma.tenant.findMany({ include: { subscription: { include: { plan: true } }, numbers: { select: { infraCostMonth: true, provider: true } } } });
    const counters = await this.prisma.usageCounter.findMany({ where: { period } });
    const byTenant = new Map(counters.map((c) => [c.tenantId, c]));
    return tenants.map((t) => {
      const c = byTenant.get(t.id);
      // o que este cliente paga, não o preço de tabela (ver reprice.ts)
      const price = Number(t.subscription?.priceMonth ?? t.subscription?.plan.priceMonth ?? 0);
      const overage = Number(c?.overageAmount ?? 0);
      const providerCost = Number(c?.providerCost ?? 0);
      const infra = t.numbers.reduce((a, n) => a + Number(n.infraCostMonth), 0);
      const revenue = price + overage;
      const cost = providerCost + infra;
      return { tenantId: t.id, name: t.name, plan: t.subscription?.plan.name ?? null, status: t.subscription?.status ?? null, revenue, overage, providerCost, infraCost: infra, margin: revenue - cost, marginPct: revenue ? ((revenue - cost) / revenue) * 100 : 0, messagesSent: c?.messagesSent ?? 0, templatesSent: c?.templatesSent ?? 0 };
    });
  }
}
