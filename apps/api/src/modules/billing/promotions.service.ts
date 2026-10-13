import { BadRequestException, Injectable } from '@nestjs/common';
import type { Plan, PlanOverride, Promotion } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addMonths, discounted, promotionFor } from './plan-override';

export interface PromotionInput {
  name: string;
  discountPercent: number;
  durationMonths: number;
  planIds: string[];
  /** `AAAA-MM-DD`; ausente = a partir de agora */
  startsAt?: string | null;
  /** `AAAA-MM-DD`, último dia para assinar (inclusive, horário de Brasília) */
  endsAt: string;
  isActive?: boolean;
}

/** O que o cliente ganha ao assinar agora: promoção, mensalidade com desconto e fim do desconto. */
export interface PromotionQuote {
  promotion: Promotion;
  priceMonth: number;
  expiresAt: Date;
}

/** Início do dia / fim do dia no horário de Brasília. */
const inicioSP = (d: string) => new Date(`${d}T00:00:00.000-03:00`);
const fimSP = (d: string) => new Date(`${d}T23:59:59.999-03:00`);

/**
 * Promoções de entrada (docs/05-planos-e-cobranca.md#promoções): x% por N meses para quem
 * assinar os planos escolhidos até uma data. Não têm motor próprio: na hora de assinar viram
 * uma `PlanOverride` do cliente (`overrideData`), e a personalização cuida do resto.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.promotion.findMany({ orderBy: [{ isActive: 'desc' }, { endsAt: 'desc' }], include: { _count: { select: { overrides: true } } } });
    return rows.map(({ _count, ...p }) => ({ ...p, discountPercent: Number(p.discountPercent), redemptions: _count.overrides }));
  }

  async create(input: PromotionInput) {
    return this.prisma.promotion.create({ data: await this.clean(input) });
  }

  async update(id: string, input: PromotionInput) {
    await this.prisma.promotion.findUniqueOrThrow({ where: { id } });
    // quem já ganhou fica com o que ganhou: mudar a promoção vale só para quem assinar daqui para frente
    return this.prisma.promotion.update({ where: { id }, data: await this.clean(input) });
  }

  /** Quem já ganhou mantém o desconto até o fim do prazo dele (a personalização é do cliente). */
  async remove(id: string) {
    await this.prisma.promotion.delete({ where: { id } });
    return { ok: true };
  }

  /** Promoções abertas agora (ativas e dentro da janela de adesão). */
  open(now = new Date()) {
    return this.prisma.promotion.findMany({ where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } } });
  }

  /** Desconto que este cliente ganha ao assinar `plan` agora, ou null. `current` = personalização que ele já tem. */
  async quote(plan: Plan, current: PlanOverride | null, now = new Date(), abertas?: Promotion[]): Promise<PromotionQuote | null> {
    if (plan.isFree || Number(plan.priceMonth) <= 0) return null;
    const p = promotionFor(abertas ?? (await this.open(now)), plan.id, current, now);
    if (!p) return null;
    return { promotion: p, priceMonth: discounted(Number(plan.priceMonth), Number(p.discountPercent)), expiresAt: addMonths(now, p.durationMonths) };
  }

  /** Dados da personalização que a promoção vira (upsert em `plan_overrides`). */
  overrideData(planId: string, q: PromotionQuote) {
    return {
      planId,
      priceMonth: q.priceMonth,
      limits: {},
      expiresAt: q.expiresAt,
      endedAt: null,
      promotionId: q.promotion.id,
      notes: `Promoção "${q.promotion.name}": ${Number(q.promotion.discountPercent)}% por ${q.promotion.durationMonths} ${q.promotion.durationMonths === 1 ? 'mês' : 'meses'}`,
    };
  }

  private async clean(input: PromotionInput) {
    const planIds = [...new Set(input.planIds)];
    const plans = await this.prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true, isFree: true } });
    if (plans.length !== planIds.length) throw new BadRequestException('Plano não encontrado.');
    const gratis = plans.find((p) => p.isFree);
    if (gratis) throw new BadRequestException(`"${gratis.name}" é gratuito: não tem o que descontar.`);
    const startsAt = input.startsAt ? inicioSP(input.startsAt) : new Date();
    const endsAt = fimSP(input.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('A data final tem de ser depois do início.');
    return { name: input.name.trim(), discountPercent: input.discountPercent, durationMonths: input.durationMonths, planIds, startsAt, endsAt, isActive: input.isActive ?? true };
  }
}
