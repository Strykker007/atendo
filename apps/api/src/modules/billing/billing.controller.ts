import { BadRequestException, Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PLAN_FEATURES } from '@atendo/shared';
import { aReajustar, dataDoReajuste } from './reprice';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { StripeService } from './stripe.service';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { UsageService, periodOf } from './usage.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Limites de um plano. Espelha `PlanLimits` (packages/shared) com validação — isto vem de
 * formulário, e um `includedMessagesMonth` como texto viraria quota quebrada no meio do mês.
 */
class PlanLimitsDto {
  @IsInt() @Min(0) @Max(1000) maxNumbers: number;
  @IsInt() @Min(0) @Max(1000) maxAgents: number;
  @IsOptional() @IsIn(['messages', 'conversations']) billingUnit?: 'messages' | 'conversations';
  @IsInt() @Min(0) includedMessagesMonth: number;
  @IsOptional() @IsInt() @Min(0) includedConversationsMonth?: number;
  @IsInt() @Min(0) includedTemplatesMonth: number;
  @IsOptional() @IsNumber() @Min(0) overagePricePerMessage?: number | null;
  @IsOptional() @IsNumber() @Min(0) overagePricePerTemplate?: number | null;
  @IsOptional() @IsNumber() @Min(0) overagePricePerConversation?: number | null;
  @IsBoolean() hardLimit: boolean;
  @IsInt() @Min(0) @Max(60) graceDays: number;
  @IsOptional() @IsArray() @IsIn(PLAN_FEATURES, { each: true }) features?: string[];
  @IsOptional() @IsInt() @Min(0) includedAiInteractionsMonth?: number;
  @IsOptional() @IsNumber() @Min(0) overagePricePerAiInteraction?: number | null;
  @IsOptional() @IsNumber() @Min(0) aiMonthlyCostCap?: number;
}

/** O que acontece com quem já assina quando o preço muda. */
class ApplyToExistingDto {
  @IsIn(['never', 'scheduled', 'now']) mode: 'never' | 'scheduled' | 'now';
  /** aviso prévio, em dias, quando `scheduled` */
  @IsOptional() @IsInt() @Min(0) @Max(365) days?: number;
}

class PlanDto {
  @IsString() @MaxLength(40) name: string;
  @IsNumber() @Min(0) @Max(99_999) priceMonth: number;
  /** custo estimado para servir um cliente deste plano por mês */
  @IsOptional() @IsNumber() @Min(0) @Max(99_999) costMonth?: number;
  @IsIn(['fixed', 'usage', 'hybrid']) billingModel: 'fixed' | 'usage' | 'hybrid';
  @ValidateNested() @Type(() => PlanLimitsDto) limits: PlanLimitsDto;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** só é lido quando o preço muda; ausente = mantém quem já assina no preço atual */
  @IsOptional() @ValidateNested() @Type(() => ApplyToExistingDto) applyToExisting?: ApplyToExistingDto;
}

class CheckoutDto {

  @IsUUID() planId: string;
}

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class BillingController {
  private readonly log = new Logger(BillingController.name);
  constructor(
    private readonly usage: UsageService,
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly finance: FinanceService,
  ) {}

  /** Financeiro completo do dono: MRR, faturado/recebido/atrasado, custos, margem, por plano, série mensal. */
  @Get('finance')
  @NoTenantOk()
  @Roles('super_admin')
  financeOverview(@Query('months') months?: string) {
    return this.finance.overview(Math.min(24, Math.max(1, Number(months) || 12)));
  }

  /** Planos disponíveis para assinar (público dentro do app). */
  @Get('plans')
  @NoTenantOk()
  plans() {
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonth: 'asc' }, select: { id: true, name: true, priceMonth: true, billingModel: true, limits: true, stripePriceId: true } });
  }

  /**
   * Catálogo completo para o dono: inclui os inativos e diz quantos clientes cada plano tem —
   * é o número que decide se dá para mexer no preço ou se o jeito é criar outro.
   */
  @Get('plans/all')
  @NoTenantOk()
  @Roles('super_admin')
  async allPlans() {
    const plans = await this.prisma.plan.findMany({ orderBy: [{ isActive: 'desc' }, { priceMonth: 'asc' }], include: { subscriptions: { select: { status: true, priceMonth: true } } } });
    return plans.map(({ subscriptions, ...p }) => {
      const preco = Number(p.priceMonth);
      return {
        ...p,
        priceMonth: preco,
        costMonth: Number(p.costMonth),
        subscribers: subscriptions.length,
        // quantos pagam valor diferente do atual: é o número que mostra quanto está parado no
        // passado, e some sozinho quando o reajuste roda
        onOldPrice: aReajustar(subscriptions.map((s, i) => ({ id: String(i), status: s.status, priceMonth: s.priceMonth === null ? null : Number(s.priceMonth) })), preco).length,
        billingEnabled: this.stripe.enabled,
      };
    });
  }

  @Post('plans')
  @NoTenantOk()
  @Roles('super_admin')
  async createPlan(@Body() dto: PlanDto) {
    const plan = await this.prisma.plan.create({ data: { name: dto.name.trim(), priceMonth: dto.priceMonth, costMonth: dto.costMonth ?? 0, billingModel: dto.billingModel, limits: dto.limits as object, isActive: dto.isActive ?? true } });
    // cria produto e preço no Stripe na hora: plano sem price não aparece no checkout, e
    // descobrir isso só quando o cliente clica em assinar é tarde. A falha não derruba a
    // criação — o plano já existe, e a tela mostra "sem Stripe" até sincronizar
    if (this.stripe.enabled) await this.stripe.syncPlans().catch((err) => this.log.warn(`plano ${plan.name} criado sem price no Stripe: ${err?.message ?? err}`));
    return this.prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
  }

  @Patch('plans/:id')
  @NoTenantOk()
  @Roles('super_admin')
  async updatePlan(@Param('id') id: string, @Body() dto: PlanDto) {
    const atual = await this.prisma.plan.findUniqueOrThrow({ where: { id } });
    const plan = await this.prisma.plan.update({
      where: { id },
      data: { name: dto.name.trim(), priceMonth: dto.priceMonth, costMonth: dto.costMonth ?? 0, billingModel: dto.billingModel, limits: dto.limits as object, ...(dto.isActive !== undefined && { isActive: dto.isActive }) },
    });
    const mudouPreco = Number(atual.priceMonth) !== dto.priceMonth;
    // preço no Stripe é imutável: mudar valor exige criar outro price e apontar o plano para ele
    if (this.stripe.enabled) {
      if (mudouPreco) await this.stripe.repricePlan(plan.id).catch((err) => this.log.warn(`plano ${plan.name}: preço não propagou para o Stripe: ${err?.message ?? err}`));
      else await this.stripe.syncPlans().catch((err) => this.log.warn(`plano ${plan.name}: sync com o Stripe falhou: ${err?.message ?? err}`));
    }

    /**
     * Quem já assina. Por padrão nada acontece — era o comportamento anterior e continua sendo
     * o seguro. Agendar é o caminho normal: o cliente é avisado hoje e o valor muda na data,
     * com tempo de decidir, inclusive de sair. "Agora" existe para corrigir erro de digitação
     * no preço, não para reajustar sem aviso.
     */
    if (mudouPreco && dto.applyToExisting && dto.applyToExisting.mode !== 'never') {
      const quando = dto.applyToExisting.mode === 'now' ? new Date() : dataDoReajuste(dto.applyToExisting.days ?? 30);
      await this.prisma.plan.update({ where: { id }, data: { priceAppliesToExistingAt: quando } });
      if (dto.applyToExisting.mode === 'now') await this.stripe.applyDuePriceChanges().catch((err) => this.log.error(`reajuste imediato falhou: ${err?.message ?? err}`));
      else await this.stripe.notifyPriceChange(id, quando).catch((err) => this.log.warn(`aviso de reajuste não saiu: ${err?.message ?? err}`));
    }
    return this.prisma.plan.findUniqueOrThrow({ where: { id } });
  }

  /** Só apaga plano que ninguém assinou; o resto se desativa, para não quebrar o histórico. */
  @Delete('plans/:id')
  @NoTenantOk()
  @Roles('super_admin')
  async deletePlan(@Param('id') id: string) {
    const assinaturas = await this.prisma.subscription.count({ where: { planId: id } });
    if (assinaturas > 0) throw new BadRequestException(`${assinaturas} cliente(s) estão neste plano. Desative-o em vez de apagar — apagar levaria junto o histórico de faturamento deles.`);
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id } });
    await this.prisma.plan.delete({ where: { id } });
    if (plan.stripePriceId && this.stripe.enabled) {
      await this.stripe.archivePlan(plan.stripePriceId).catch((err) => this.log.warn(`plano ${plan.name} apagado, mas o produto seguiu ativo no Stripe: ${err?.message ?? err}`));
    }
    return { ok: true };
  }

  /** Faturas do tenant (espelho do Stripe). */
  @Get('invoices')
  invoices(@CurrentUser() user: AuthUser) {
    return this.prisma.invoice.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 24 });
  }

  @Post('checkout')
  @RequirePermission('billing.manage')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.stripe.checkout(user.tenantId, dto.planId);
  }

  @Post('portal')
  @RequirePermission('billing.manage')
  portal(@CurrentUser() user: AuthUser) {
    return this.stripe.portal(user.tenantId);
  }

  /** Margem por cliente no período (dono do Atendo). */
  @Get('margin')
  @NoTenantOk()
  @Roles('super_admin')
  margin(@Query('period') period?: string) {
    return this.stripe.margin(period || undefined);
  }

  @Post('sync-plans')
  @NoTenantOk()
  @Roles('super_admin')
  async syncPlans() {
    await this.stripe.syncPlans();
    return { ok: true };
  }

  /** Uso do mês corrente vs limites do plano — alimenta o banner de 80%/100% no painel. */
  @Get('usage')
  @NoTenantOk()
  async current(@CurrentUser() user: AuthUser) {
    // dono do sistema não é cliente: não tem plano nem uso
    if (!user.tenantId) {
      return { period: periodOf(), billingEnabled: this.stripe.enabled, cancelAtPeriodEnd: false, graceUntil: null, planId: null, used: { messages: 0, templates: 0, conversations: 0, numbers: 0, agents: 0, messagesIn: 0 }, limits: null, status: null, plan: null, priceMonth: null, priceChange: null, currentPeriodEnd: null, overageAmount: 0, noTenant: true };
    }
    const [used, plan, sub, numbers, agents, counter] = await Promise.all([
      this.usage.current(user.tenantId),
      this.usage.limits(user.tenantId),
      this.prisma.subscription.findUnique({ where: { tenantId: user.tenantId }, include: { plan: true } }),
      this.prisma.whatsAppNumber.count({ where: { tenantId: user.tenantId, isActive: true } }),
      this.prisma.user.count({ where: { tenantId: user.tenantId, isActive: true, role: { in: ['agent', 'manager'] } } }),
      this.prisma.usageCounter.findUnique({ where: { tenantId_period: { tenantId: user.tenantId, period: periodOf() } } }),
    ]);
    return {
      period: periodOf(),
      billingEnabled: this.stripe.enabled,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      graceUntil: sub?.graceUntil ?? null,
      planId: sub?.planId ?? null,
      used: { ...used, numbers, agents, messagesIn: counter?.messagesIn ?? 0 },
      limits: plan?.limits ?? null,
      status: sub?.status ?? null,
      plan: sub?.plan.name ?? null,
      // o que ELE paga, não o preço de tabela: quem assinou antes de um reajuste continua no
      // valor contratado, e mostrar o do catálogo seria avisar de uma cobrança que não existe
      priceMonth: sub ? Number(sub.priceMonth ?? sub.plan.priceMonth) : null,
      /** reajuste já avisado e ainda não aplicado — a tela do cliente mostra antes de chegar */
      priceChange:
        sub && sub.plan.priceAppliesToExistingAt && Number(sub.priceMonth ?? sub.plan.priceMonth) !== Number(sub.plan.priceMonth)
          ? { priceMonth: Number(sub.plan.priceMonth), at: sub.plan.priceAppliesToExistingAt }
          : null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      overageAmount: counter ? Number(counter.overageAmount) : 0,
    };
  }
}
