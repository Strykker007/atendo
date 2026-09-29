import { Injectable, Logger } from '@nestjs/common';
import { BillingCategory, MessageDirection, WhatsAppProvider as ProviderKind } from '@prisma/client';
import { USAGE_ALERT_THRESHOLDS, type PlanLimits } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { PricingService } from './pricing.service';
import { MailService } from '../../common/mail/mail.service';
import { env } from '../../config/env';
import { decideCanSend, unitOf, type QuotaDecision, type QuotaKind } from './quota';

export const periodOf = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const key = (tenantId: string, period: string, metric: string) => `usage:${tenantId}:${period}:${metric}`;
/** Janela de conversa aberta com este contato neste número (TTL = 24h). */
const windowKey = (numberId: string, contactId: string) => `usage:conv:${numberId}:${contactId}`;
const CONVERSATION_WINDOW_S = 86_400;

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
    private readonly mail: MailService,
  ) {}

  /** E-mails dos admins do tenant (destinatários de alertas de plano e cobrança). */
  async adminEmails(tenantId: string) {
    const admins = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: 'tenant_admin' }, select: { email: true } });
    return admins.map((a) => a.email);
  }

  /**
   * Abre uma janela de conversa cobrável, se ainda não houver uma para este contato neste
   * número. A trava é um SET NX no Redis (atômico): duas mensagens simultâneas não podem
   * abrir duas janelas e cobrar duas vezes do cliente.
   */
  async recordConversation(input: { tenantId: string; numberId: string; contactId: string; at?: Date }) {
    const aberta = await this.redis.set(windowKey(input.numberId, input.contactId), '1', 'EX', CONVERSATION_WINDOW_S, 'NX');
    if (aberta !== 'OK') return false;
    const startedAt = input.at ?? new Date();
    await this.prisma.conversationUsage
      .create({ data: { tenantId: input.tenantId, numberId: input.numberId, contactId: input.contactId, startedAt } })
      .catch((err) => {
        // corrida com outra réplica: a unique resolve. Qualquer outro erro precisa aparecer.
        if (String((err as { code?: string })?.code) !== 'P2002') throw err;
      });
    await this.redis.incr(key(input.tenantId, periodOf(startedAt), 'conversations'));
    return true;
  }

  async record(input: {
    tenantId: string;
    numberId: string;
    messageId: string;
    provider: ProviderKind;
    direction: MessageDirection;
    billingCategory: BillingCategory;
    /** abre/renova a janela de conversa cobrável */
    contactId?: string;
  }) {
    // Idempotente: uma mensagem só entra no ledger uma vez (retry/reenvio não pode contar de novo)
    const exists = await this.prisma.messageUsage.findUnique({ where: { messageId: input.messageId }, select: { id: true } });
    if (exists) return;
    const providerCost = await this.pricing.unitCost(input.provider, input.billingCategory);
    // campos explícitos de propósito: espalhar `...input` quebra o ledger inteiro assim que
    // este método ganha um parâmetro que não é coluna da tabela
    await this.prisma.messageUsage.create({
      data: {
        tenantId: input.tenantId,
        numberId: input.numberId,
        messageId: input.messageId,
        provider: input.provider,
        direction: input.direction,
        billingCategory: input.billingCategory,
        providerCost,
      },
    });

    const period = periodOf();
    const isTemplate = input.direction === 'out' && !['service', 'unofficial'].includes(input.billingCategory);
    const multi = this.redis.multi();
    if (input.direction === 'out') multi.incr(key(input.tenantId, period, 'messages'));
    else multi.incr(key(input.tenantId, period, 'messagesIn'));
    if (isTemplate) multi.incr(key(input.tenantId, period, 'templates'));
    await multi.exec();

    if (input.contactId) {
      await this.recordConversation({ tenantId: input.tenantId, numberId: input.numberId, contactId: input.contactId })
        .catch((err) => this.log.error(`Janela de conversa não registrada (tenant ${input.tenantId}): ${err instanceof Error ? err.message : err}`));
    }
    if (input.direction === 'out') await this.checkAlerts(input.tenantId, period);
  }

  async current(tenantId: string, period = periodOf()) {
    const [messages, templates, conversations] = await this.redis.mget(
      key(tenantId, period, 'messages'),
      key(tenantId, period, 'templates'),
      key(tenantId, period, 'conversations'),
    );
    return { messages: Number(messages ?? 0), templates: Number(templates ?? 0), conversations: Number(conversations ?? 0) };
  }

  async limits(tenantId: string): Promise<{ limits: PlanLimits; status: string } | null> {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub) return null;
    return { limits: sub.plan.limits as unknown as PlanLimits, status: sub.status };
  }

  /** Verifica se o tenant pode enviar mais uma mensagem/template. */
  async canSend(tenantId: string, kind: QuotaKind): Promise<QuotaDecision> {
    const plan = await this.limits(tenantId);
    if (!plan) return decideCanSend(null, { messages: 0, templates: 0, conversations: 0 }, kind);
    return decideCanSend(plan, await this.current(tenantId), kind);
  }

  private async checkAlerts(tenantId: string, period: string) {
    const plan = await this.limits(tenantId);
    if (!plan) return;
    const used = await this.current(tenantId, period);
    for (const metric of [unitOf(plan.limits), 'templates'] as const) {
      const included = metric === 'conversations'
        ? (plan.limits.includedConversationsMonth ?? 0)
        : metric === 'messages' ? plan.limits.includedMessagesMonth : plan.limits.includedTemplatesMonth;
      if (!included) continue;
      const ratio = used[metric] / included;
      for (const threshold of USAGE_ALERT_THRESHOLDS) {
        if (ratio < threshold) continue;
        const created = await this.prisma.usageAlert
          .create({ data: { tenantId, period, metric, threshold } })
          .catch(() => null); // unique => já enviado
        if (!created) continue;
        this.log.warn(`[alerta] tenant ${tenantId} atingiu ${threshold * 100}% de ${metric}`);
        const to = await this.adminEmails(tenantId);
        if (!to.length) continue;
        const what = metric === 'conversations' ? 'conversas' : metric === 'messages' ? 'mensagens enviadas' : 'templates';
        const pct = Math.round(threshold * 100);
        const blocked = threshold >= 1 && plan.limits.hardLimit;
        this.mail.send({
          to,
          subject: blocked ? `Limite de ${what} do plano atingido — envio bloqueado` : `Você usou ${pct}% das ${what} do seu plano`,
          text: blocked
            ? `Seu plano atingiu o limite de ${included.toLocaleString('pt-BR')} ${what} neste mês e o envio foi bloqueado até o próximo ciclo.

Para continuar respondendo agora, faça upgrade:

${env.WEB_ORIGIN}/plano`
            : `Seu plano já consumiu ${pct}% das ${included.toLocaleString('pt-BR')} ${what} incluídas neste mês (${used[metric].toLocaleString('pt-BR')} usadas).

${plan.limits.hardLimit ? 'Ao chegar em 100% o envio será bloqueado até o próximo ciclo.' : 'Acima do incluído, o excedente é cobrado na próxima fatura.'}

Veja o consumo e os planos:

${env.WEB_ORIGIN}/plano`,
        }).catch(() => undefined);
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
    // conversas do período, por tenant (a outra unidade cobrável)
    const convRows = await this.prisma.conversationUsage.groupBy({
      by: ['tenantId'],
      where: { startedAt: { gte: start, lt: end } },
      _count: { _all: true },
    });
    const convByTenant = new Map(convRows.map((r) => [r.tenantId, r._count._all]));
    for (const tenantId of convByTenant.keys()) if (!byTenant.has(tenantId)) byTenant.set(tenantId, { sent: 0, in: 0, templates: 0, cost: 0 });

    for (const [tenantId, t] of byTenant) {
      const conversations = convByTenant.get(tenantId) ?? 0;
      const plan = await this.limits(tenantId);
      const L = plan?.limits;
      // o excedente sai da unidade do plano; templates têm conta própria
      const unidade = L ? unitOf(L) : 'messages';
      const overUnit = !L
        ? 0
        : unidade === 'conversations'
          ? Math.max(0, conversations - (L.includedConversationsMonth ?? 0)) * (L.overagePricePerConversation ?? 0)
          : Math.max(0, t.sent - L.includedMessagesMonth) * (L.overagePricePerMessage ?? 0);
      const overTpl = L ? Math.max(0, t.templates - L.includedTemplatesMonth) * (L.overagePricePerTemplate ?? 0) : 0;
      await this.prisma.usageCounter.upsert({
        where: { tenantId_period: { tenantId, period } },
        create: { tenantId, period, messagesSent: t.sent, messagesIn: t.in, templatesSent: t.templates, conversations, providerCost: t.cost, overageAmount: overUnit + overTpl },
        update: { messagesSent: t.sent, messagesIn: t.in, templatesSent: t.templates, conversations, providerCost: t.cost, overageAmount: overUnit + overTpl, reconciledAt: new Date() },
      });
      await this.redis.mset(
        key(tenantId, period, 'messages'), t.sent,
        key(tenantId, period, 'messagesIn'), t.in,
        key(tenantId, period, 'templates'), t.templates,
        key(tenantId, period, 'conversations'), conversations,
      );
    }
    this.log.log(`Reconciliado ${byTenant.size} tenants para ${period}`);
  }
}
