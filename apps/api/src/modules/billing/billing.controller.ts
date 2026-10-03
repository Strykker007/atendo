import { BadRequestException, Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PLAN_FEATURES } from '@atendo/shared';
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

class PlanDto {
  @IsString() @MaxLength(40) name: string;
  @IsNumber() @Min(0) @Max(99_999) priceMonth: number;
  @IsIn(['fixed', 'usage', 'hybrid']) billingModel: 'fixed' | 'usage' | 'hybrid';
  @ValidateNested() @Type(() => PlanLimitsDto) limits: PlanLimitsDto;
  @IsOptional() @IsBoolean() isActive?: boolean;
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
    const plans = await this.prisma.plan.findMany({ orderBy: [{ isActive: 'desc' }, { priceMonth: 'asc' }], include: { _count: { select: { subscriptions: true } } } });
    return plans.map(({ _count, ...p }) => ({ ...p, priceMonth: Number(p.priceMonth), subscribers: _count.subscriptions, billingEnabled: this.stripe.enabled }));
  }

  @Post('plans')
  @NoTenantOk()
  @Roles('super_admin')
  async createPlan(@Body() dto: PlanDto) {
    const plan = await this.prisma.plan.create({ data: { name: dto.name.trim(), priceMonth: dto.priceMonth, billingModel: dto.billingModel, limits: dto.limits as object, isActive: dto.isActive ?? true } });
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
      data: { name: dto.name.trim(), priceMonth: dto.priceMonth, billingModel: dto.billingModel, limits: dto.limits as object, ...(dto.isActive !== undefined && { isActive: dto.isActive }) },
    });
    // preço no Stripe é imutável: mudar valor exige criar outro price e apontar o plano para ele
    if (this.stripe.enabled) {
      if (Number(atual.priceMonth) !== dto.priceMonth) await this.stripe.repricePlan(plan.id).catch((err) => this.log.warn(`plano ${plan.name}: preço não propagou para o Stripe: ${err?.message ?? err}`));
      else await this.stripe.syncPlans().catch((err) => this.log.warn(`plano ${plan.name}: sync com o Stripe falhou: ${err?.message ?? err}`));
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
      return { period: periodOf(), billingEnabled: this.stripe.enabled, cancelAtPeriodEnd: false, graceUntil: null, planId: null, used: { messages: 0, templates: 0, conversations: 0, numbers: 0, agents: 0, messagesIn: 0 }, limits: null, status: null, plan: null, priceMonth: null, currentPeriodEnd: null, overageAmount: 0, noTenant: true };
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
      priceMonth: sub ? Number(sub.plan.priceMonth) : null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      overageAmount: counter ? Number(counter.overageAmount) : 0,
    };
  }
}
