import { BadRequestException, Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PLAN_FEATURES, isStripeBillable, type BillingCycle } from '@atendo/shared';
import { aReajustar, dataDoReajuste } from './reprice';
import { normalizePlan } from './plan-rules';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { StripeService } from './stripe.service';
import { AsaasService } from './asaas.service';
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
  /** `null` = ilimitado (vale para os quatro limites de quantidade) */
  @IsOptional() @IsInt() @Min(0) @Max(1000) maxNumbers: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) maxAgents: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) maxFlows?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) maxQuickReplies?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) maxCompanies?: number | null;
  @IsOptional() @IsIn(['messages', 'conversations']) billingUnit?: 'messages' | 'conversations';
  /** incluídos/mês: `null` = ilimitado */
  @IsOptional() @IsInt() @Min(0) includedMessagesMonth: number | null;
  @IsOptional() @IsInt() @Min(0) includedConversationsMonth?: number | null;
  @IsOptional() @IsInt() @Min(0) includedTemplatesMonth: number | null;
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
  /** valor anual, só lido com `billingCycle = yearly` */
  @IsOptional() @IsNumber() @Min(0) @Max(999_999) priceYear?: number | null;
  /** gratuito: sem gateway nem fatura; o mesmo que `billingCycle = free` */
  @IsOptional() @IsBoolean() isFree?: boolean;
  @IsOptional() @IsIn(['free', 'monthly', 'yearly', 'custom']) billingCycle?: BillingCycle;
  /** dias de gratuidade; ausente/null em plano gratuito = permanente */
  @IsOptional() @IsInt() @Min(1) @Max(3650) durationDays?: number | null;
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
    private readonly asaas: AsaasService,
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
  /**
   * Planos disponíveis. O cliente só vê o que dá para assinar online (mensal/anual); gratuito
   * e personalizado são atribuídos pelo dono, que recebe todos — é a lista da tela de Clientes.
   */
  @Get('plans')
  @NoTenantOk()
  plans(@CurrentUser() user: AuthUser) {
    return this.prisma.plan.findMany({
      where: { isActive: true, ...(user.role !== 'super_admin' && { billingCycle: { in: ['monthly', 'yearly'] } }) },
      orderBy: { priceMonth: 'asc' },
      select: { id: true, name: true, priceMonth: true, priceYear: true, isFree: true, billingCycle: true, durationDays: true, billingModel: true, limits: true, stripePriceId: true },
    });
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
        priceYear: p.priceYear === null ? null : Number(p.priceYear),
        costMonth: Number(p.costMonth),
        subscribers: subscriptions.length,
        // quantos pagam valor diferente do atual: é o número que mostra quanto está parado no
        // passado, e some sozinho quando o reajuste roda
        onOldPrice: aReajustar(subscriptions.map((s, i) => ({ id: String(i), status: s.status, priceMonth: s.priceMonth === null ? null : Number(s.priceMonth) })), preco).length,
        // "sem Stripe" só faz sentido quando o Stripe é quem vende: no Asaas o plano não tem price
        billingEnabled: this.stripe.enabled && !this.asaas.enabled,
      };
    });
  }

  @Post('plans')
  @NoTenantOk()
  @Roles('super_admin')
  async createPlan(@Body() dto: PlanDto) {
    const n = normalizePlan(dto);
    const plan = await this.prisma.plan.create({ data: { name: dto.name.trim(), ...n, limits: n.limits as object, costMonth: dto.costMonth ?? 0, isActive: dto.isActive ?? true } });
    // cria produto e preço no Stripe na hora: plano sem price não aparece no checkout, e
    // descobrir isso só quando o cliente clica em assinar é tarde. A falha não derruba a
    // criação — o plano já existe, e a tela mostra "sem Stripe" até sincronizar.
    // Gratuito e personalizado não têm price: não passam pelo gateway
    if (this.stripe.enabled && isStripeBillable(n.billingCycle)) await this.stripe.syncPlans().catch((err) => this.log.warn(`plano ${plan.name} criado sem price no Stripe: ${err?.message ?? err}`));
    return this.prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
  }

  @Patch('plans/:id')
  @NoTenantOk()
  @Roles('super_admin')
  async updatePlan(@Param('id') id: string, @Body() dto: PlanDto) {
    const atual = await this.prisma.plan.findUniqueOrThrow({ where: { id }, include: { _count: { select: { subscriptions: true } } } });
    const n = normalizePlan(dto);
    const mudouCiclo = atual.billingCycle !== n.billingCycle;
    // trocar a modalidade com gente assinando deixaria assinatura no Stripe cobrando plano
    // gratuito (ou cliente "pago" sem cobrança nenhuma). Plano novo + troca do cliente é o caminho
    if (mudouCiclo && atual._count.subscriptions > 0) {
      throw new BadRequestException(`${atual._count.subscriptions} cliente(s) estão neste plano: não dá para trocar a modalidade de cobrança. Crie um plano novo e mude os clientes para ele.`);
    }
    const plan = await this.prisma.plan.update({
      where: { id },
      data: { name: dto.name.trim(), ...n, limits: n.limits as object, costMonth: dto.costMonth ?? 0, ...(dto.isActive !== undefined && { isActive: dto.isActive }) },
    });
    const mudouPreco = Number(atual.priceMonth) !== n.priceMonth || Number(atual.priceYear ?? 0) !== Number(n.priceYear ?? 0);
    // virou gratuito/personalizado: o price antigo sai do Stripe, senão continuaria vendável lá
    if (!isStripeBillable(n.billingCycle)) {
      if (atual.stripePriceId) {
        await this.prisma.plan.update({ where: { id }, data: { stripePriceId: null } });
        if (this.stripe.enabled) await this.stripe.archivePlan(atual.stripePriceId).catch((err) => this.log.warn(`plano ${plan.name}: price antigo seguiu ativo no Stripe: ${err?.message ?? err}`));
      }
      return this.prisma.plan.findUniqueOrThrow({ where: { id } });
    }
    // preço no Stripe é imutável: mudar valor (ou o intervalo mensal↔anual) exige criar outro
    // price e apontar o plano para ele
    if (this.stripe.enabled) {
      if (mudouPreco || mudouCiclo) await this.stripe.repricePlan(plan.id).catch((err) => this.log.warn(`plano ${plan.name}: preço não propagou para o Stripe: ${err?.message ?? err}`));
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

  /** Asaas tem precedência quando as duas chaves existem (docs/05 — coexistência). */
  private gateway(): 'asaas' | 'stripe' | null {
    return this.asaas.enabled ? 'asaas' : this.stripe.enabled ? 'stripe' : null;
  }

  /** Uso do mês corrente vs limites do plano — alimenta o banner de 80%/100% no painel. */
  @Get('usage')
  @NoTenantOk()
  async current(@CurrentUser() user: AuthUser) {
    // dono do sistema não é cliente: não tem plano nem uso
    if (!user.tenantId) {
      return { period: periodOf(), billingEnabled: !!this.gateway(), gateway: this.gateway(), subscriptionGateway: null, cancelAtPeriodEnd: false, graceUntil: null, planId: null, used: { messages: 0, templates: 0, conversations: 0, numbers: 0, agents: 0, flows: 0, quickReplies: 0, companies: 0, messagesIn: 0 }, limits: null, status: null, plan: null, freePlan: null, billingCycle: null, priceMonth: null, priceChange: null, currentPeriodEnd: null, overageAmount: 0, noTenant: true };
    }
    const [used, plan, sub, numbers, agents, counter, flows, quickReplies, companies] = await Promise.all([
      this.usage.current(user.tenantId),
      this.usage.limits(user.tenantId),
      this.prisma.subscription.findUnique({ where: { tenantId: user.tenantId }, include: { plan: true } }),
      this.prisma.whatsAppNumber.count({ where: { tenantId: user.tenantId, isActive: true } }),
      this.prisma.user.count({ where: { tenantId: user.tenantId, isActive: true, role: { in: ['agent', 'manager'] } } }),
      this.prisma.usageCounter.findUnique({ where: { tenantId_period: { tenantId: user.tenantId, period: periodOf() } } }),
      this.prisma.flow.count({ where: { tenantId: user.tenantId, isActive: true } }),
      this.prisma.quickReply.count({ where: { folder: { tenantId: user.tenantId } } }),
      this.prisma.company.count({ where: { tenantId: user.tenantId } }),
    ]);
    return {
      period: periodOf(),
      billingEnabled: !!this.gateway(),
      /** gateway dos checkouts novos (asaas = PIX/cartão no modal; stripe = redireciona) */
      gateway: this.gateway(),
      /** gateway onde a assinatura atual nasceu — decide portal do Stripe x cobrança do Asaas */
      subscriptionGateway: sub?.gateway ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      graceUntil: sub?.graceUntil ?? null,
      planId: sub?.planId ?? null,
      used: { ...used, numbers, agents, flows, quickReplies, companies, messagesIn: counter?.messagesIn ?? 0 },
      limits: plan?.limits ?? null,
      status: sub?.status ?? null,
      plan: sub?.plan.name ?? null,
      /** plano gratuito: sem fatura; `durationDays` null = permanente, senão termina em currentPeriodEnd */
      freePlan: sub?.plan.isFree ? { durationDays: sub.plan.durationDays } : null,
      billingCycle: sub?.plan.billingCycle ?? null,
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
