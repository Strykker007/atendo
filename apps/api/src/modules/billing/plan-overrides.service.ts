import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Plan, Subscription, SubscriptionStatus } from '@prisma/client';
import { OVERRIDABLE_LIMITS, mergeLimits, type PlanFeature, type PlanLimits, type PlanLimitsOverride } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AsaasService } from './asaas.service';
import { addMonths, cycleValue, discounted, overrideActive, overridePrice } from './plan-override';
import { DiscountLedgerService } from './discount-ledger.service';

/** assinatura que ainda cobra: só nela o valor novo precisa chegar ao gateway */
const LIVE: SubscriptionStatus[] = ['active', 'past_due', 'trialing', 'suspended'];

export interface PlanOverrideInput {
  /** mensalidade negociada (equivalente mensal em plano anual); null/ausente = preço do plano */
  priceMonth?: number | null;
  /** só as chaves presentes sobrescrevem; `null` = ilimitado */
  limits?: PlanLimitsOverride;
  /** `AAAA-MM-DD`, último dia de vigência (inclusive); null/ausente = sem data */
  expiresAt?: string | null;
  notes?: string | null;
}

/**
 * Personalização do plano por cliente (docs/05-planos-e-cobranca.md#personalização-por-cliente).
 *
 * Limites: resolvidos na leitura (`UsageService.limits`), então a vigência vale na hora, sem job.
 * Valor: materializado em `subscriptions.priceMonth` — é o "preço contratado" que vencimentos,
 * MRR, margem e o painel do cliente já leem — e levado ao Asaas, onde o valor mora na
 * assinatura. Ao expirar/remover, volta ao preço de tabela do plano.
 */
@Injectable()
export class PlanOverridesService {
  private readonly log = new Logger(PlanOverridesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    private readonly ledger: DiscountLedgerService,
  ) {}

  /** O que a tela do dono precisa: plano base, personalização e limites efetivos. */
  async get(tenantId: string) {
    const [sub, o] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      this.prisma.planOverride.findUnique({ where: { tenantId }, include: { promotion: { select: { name: true } } } }),
    ]);
    const base = sub ? (sub.plan.limits as unknown as PlanLimits) : null;
    const active = !!sub && overrideActive(o, sub.planId);
    return {
      subscription: sub && {
        planId: sub.planId, status: sub.status, gateway: sub.gateway, units: sub.units,
        priceMonth: sub.priceMonth === null ? null : Number(sub.priceMonth),
        plan: { id: sub.plan.id, name: sub.plan.name, priceMonth: Number(sub.plan.priceMonth), billingCycle: sub.plan.billingCycle, isFree: sub.plan.isFree, limits: base },
      },
      override: o && { ...o, priceMonth: o.priceMonth === null ? null : Number(o.priceMonth), limits: o.limits as PlanLimitsOverride },
      active,
      /** por que não vale, quando existe e não vale */
      inactiveReason: !o || active ? null : sub && o.planId !== sub.planId ? 'other_plan' : 'expired',
      effectiveLimits: base ? (active ? mergeLimits(base, o!.limits as PlanLimitsOverride) : base) : null,
    };
  }

  async save(tenantId: string, input: PlanOverrideInput, by?: { id: string; name: string }) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub) throw new BadRequestException('Cliente sem assinatura: escolha um plano antes de personalizar.');
    const limits = cleanLimits(input.limits);
    const price = input.priceMonth ?? null;
    if (price !== null && price <= 0) throw new BadRequestException('Valor personalizado deve ser maior que zero. Para não cobrar, use um plano gratuito.');
    if (price !== null && sub.plan.isFree) throw new BadRequestException('Plano gratuito não tem mensalidade. Personalize só os limites ou mude o cliente para um plano pago.');
    // no Stripe o valor é o `price` do catálogo: um valor por cliente exigiria um price avulso
    if (price !== null && sub.gateway === 'stripe' && sub.externalId && sub.status !== 'canceled') {
      throw new BadRequestException('Valor personalizado não funciona com assinatura no Stripe. Migre o cliente para o Asaas ou para uma assinatura sem gateway, ou personalize só os limites.');
    }
    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) throw new BadRequestException('Data limite inválida.');
      // "vale até dia 10" = o dia 10 inteiro, no horário de Brasília
      expiresAt = new Date(`${input.expiresAt}T23:59:59.999-03:00`);
      if (expiresAt.getTime() <= Date.now()) throw new BadRequestException('A data limite já passou.');
    }
    if (price === null && !Object.keys(limits).length) throw new BadRequestException('Nada para personalizar: informe um valor ou ao menos um limite.');

    const before = await this.prisma.planOverride.findUnique({ where: { tenantId } });
    // só mexe no valor se esta personalização tem valor ou a anterior (que valia) tinha
    const target = price ?? (overridePrice(before, sub.planId) !== null ? Number(sub.plan.priceMonth) : null);
    // gateway antes do banco: se o Asaas recusar, nada muda aqui (o banco não diz um valor e o Asaas cobra outro)
    if (target !== null) await this.pushPrice(sub, target);

    const data = { planId: sub.planId, priceMonth: price, limits: limits as object, expiresAt, endedAt: null, notes: input.notes?.trim() || null };
    const saved = await this.prisma.planOverride.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    if (target !== null) await this.prisma.subscription.update({ where: { tenantId }, data: { priceMonth: target } });
    // livro de descontos: nova linha só quando valor ou vigência mudaram (mexer só em limite não é desconto)
    const valia = overridePrice(before, sub.planId);
    if (price !== null && (valia !== price || before?.expiresAt?.getTime() !== expiresAt?.getTime())) {
      await this.ledger.open({ tenantId, plan: sub.plan, priceMonth: price, kind: 'negotiated', source: 'manual', endsAt: expiresAt, by });
    } else if (price === null && valia !== null) await this.ledger.close(tenantId);
    this.log.log(`tenant ${tenantId}: plano ${sub.plan.name} personalizado (valor ${price ?? 'do plano'}, ${Object.keys(limits).length} limite(s), até ${expiresAt?.toISOString() ?? 'sem data'})`);
    return saved;
  }

  /** Remove a personalização: limites voltam aos do plano na hora; valor volta ao de tabela. */
  async remove(tenantId: string) {
    const o = await this.prisma.planOverride.findUnique({ where: { tenantId } });
    if (!o) return { ok: true };
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (sub && overridePrice(o, sub.planId) !== null) {
      await this.pushPrice(sub, Number(sub.plan.priceMonth));
      await this.prisma.subscription.update({ where: { tenantId }, data: { priceMonth: sub.plan.priceMonth } });
    }
    await this.prisma.planOverride.delete({ where: { tenantId } });
    await this.ledger.close(tenantId);
    this.log.log(`tenant ${tenantId}: personalização do plano removida`);
    return { ok: true };
  }

  /**
   * Job diário: personalização cuja vigência acabou devolve o valor do plano à assinatura (e ao
   * Asaas). Os limites já deixaram de valer sozinhos na leitura. Falha no gateway não marca
   * `endedAt` — amanhã tenta de novo, em vez de o banco e o Asaas discordarem calados.
   */
  async expireDue(now = new Date()) {
    const due = await this.prisma.planOverride.findMany({
      where: { endedAt: null, expiresAt: { lte: now } },
      include: { tenant: { select: { subscription: { include: { plan: true } } } } },
    });
    for (const o of due) {
      const sub = o.tenant.subscription;
      try {
        // ainda no plano personalizado e com valor próprio: volta ao de tabela
        if (sub && sub.planId === o.planId && o.priceMonth !== null) {
          await this.pushPrice(sub, Number(sub.plan.priceMonth));
          await this.prisma.subscription.update({ where: { id: sub.id }, data: { priceMonth: sub.plan.priceMonth } });
        }
        await this.prisma.planOverride.update({ where: { id: o.id }, data: { endedAt: now } });
        this.log.log(`tenant ${o.tenantId}: personalização do plano expirou — valor e limites do plano voltaram`);
      } catch (err) {
        this.log.error(`tenant ${o.tenantId}: fim da personalização não aplicado: ${(err as Error)?.message ?? err}`);
      }
    }
  }

  /**
   * Aplica uma promoção a UM cliente, por decisão do dono: vale fora da janela e em plano que não
   * está na promoção (é exceção consciente). Substitui a personalização que houver — valor,
   * limites e vigência — e conta como aproveitada (`promotionId`).
   */
  async applyPromotion(tenantId: string, promotionId: string, source: 'manual' | 'bulk', by?: { id: string; name: string }, now = new Date()) {
    const [sub, promo] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      this.prisma.promotion.findUniqueOrThrow({ where: { id: promotionId } }),
    ]);
    if (!sub) throw new BadRequestException('Cliente sem assinatura: escolha um plano antes.');
    if (sub.plan.isFree || Number(sub.plan.priceMonth) <= 0) throw new BadRequestException('Plano gratuito não tem mensalidade para descontar.');
    if (sub.gateway === 'stripe' && sub.externalId && sub.status !== 'canceled') throw new BadRequestException('Promoção não funciona com assinatura no Stripe (o valor é o do catálogo).');
    const price = discounted(Number(sub.plan.priceMonth), Number(promo.discountPercent));
    const expiresAt = addMonths(now, promo.durationMonths);
    await this.pushPrice(sub, price);
    const data = {
      planId: sub.planId, priceMonth: price, limits: {}, expiresAt, endedAt: null, promotionId: promo.id,
      notes: `Promoção "${promo.name}": ${Number(promo.discountPercent)}% por ${promo.durationMonths} ${promo.durationMonths === 1 ? 'mês' : 'meses'}${source === 'bulk' ? ' (aplicada a todos)' : ''}`,
    };
    await this.prisma.planOverride.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    await this.prisma.subscription.update({ where: { tenantId }, data: { priceMonth: price } });
    await this.ledger.open({ tenantId, plan: sub.plan, priceMonth: price, kind: 'promotion', source, promotion: promo, endsAt: expiresAt, by }, this.prisma, now);
    this.log.log(`tenant ${tenantId}: promoção ${promo.name} aplicada pelo dono (${source})`);
  }

  /**
   * "Aplicar a todos": a promoção vai para todo cliente que assina hoje um dos planos dela. Pula
   * (e diz por quê) quem já tem personalização valendo — não se mexe em acordo feito —, quem já
   * aproveitou esta promoção, e quem está no Stripe. Um cliente que falha não para os outros.
   */
  async applyPromotionToAll(promotionId: string, by?: { id: string; name: string }) {
    const promo = await this.prisma.promotion.findUniqueOrThrow({ where: { id: promotionId } });
    const subs = await this.prisma.subscription.findMany({
      where: { planId: { in: promo.planIds }, status: { in: ['active', 'trialing', 'past_due'] }, plan: { isFree: false } },
      include: { tenant: { select: { name: true, isActive: true, planOverride: true } } },
    });
    let applied = 0;
    const skipped: { tenant: string; reason: string }[] = [];
    for (const s of subs) {
      const o = s.tenant.planOverride;
      if (!s.tenant.isActive) { skipped.push({ tenant: s.tenant.name, reason: 'cliente desativado' }); continue; }
      if (o?.promotionId === promo.id) { skipped.push({ tenant: s.tenant.name, reason: 'já tem esta promoção' }); continue; }
      // qualquer personalização valendo (até só de limites): a promoção a substituiria inteira
      if (overrideActive(o, s.planId)) { skipped.push({ tenant: s.tenant.name, reason: o.priceMonth !== null ? 'já tem valor negociado' : 'já tem limites personalizados' }); continue; }
      if (s.gateway === 'stripe' && s.externalId) { skipped.push({ tenant: s.tenant.name, reason: 'assinatura no Stripe' }); continue; }
      try {
        await this.applyPromotion(s.tenantId, promo.id, 'bulk', by);
        applied++;
      } catch (err) {
        skipped.push({ tenant: s.tenant.name, reason: (err as Error)?.message ?? 'erro' });
      }
    }
    return { applied, skipped };
  }

  /** Leva a mensalidade ao Asaas (próximas cobranças; a já emitida não muda). */
  private async pushPrice(sub: Subscription & { plan: Plan }, priceMonth: number) {
    if (Number(sub.priceMonth ?? sub.plan.priceMonth) === priceMonth) return;
    if (sub.gateway !== 'asaas' || !sub.externalId || !LIVE.includes(sub.status)) return;
    try {
      await this.asaas.updateSubscriptionValue(sub.externalId, cycleValue(priceMonth, sub.plan.billingCycle, sub.units));
    } catch (err) {
      throw new BadRequestException(`O Asaas não aceitou o valor novo: ${(err as Error)?.message ?? err}`);
    }
  }
}

/** Fica só o que foi informado (ausente = herda do plano). Inteiros ≥ 0 ou null (ilimitado). */
function cleanLimits(raw: PlanLimitsOverride | undefined): PlanLimitsOverride {
  const out: PlanLimitsOverride = {};
  if (!raw) return out;
  for (const k of OVERRIDABLE_LIMITS) {
    const v = raw[k];
    if (v === undefined) continue;
    if (v !== null && (!Number.isInteger(v) || v < 0)) throw new BadRequestException(`Limite inválido: ${k}`);
    out[k] = v;
  }
  if (raw.features) out.features = [...new Set(raw.features)] as PlanFeature[];
  return out;
}
