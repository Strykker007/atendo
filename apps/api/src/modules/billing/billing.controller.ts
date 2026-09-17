import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { StripeService } from './stripe.service';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { UsageService, periodOf } from './usage.service';
import { PrismaService } from '../../common/prisma/prisma.service';

class CheckoutDto {
  @IsUUID() planId: string;
}

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(
    private readonly usage: UsageService,
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly finance: FinanceService,
  ) {}

  /** Financeiro completo do dono: MRR, faturado/recebido/atrasado, custos, margem, por plano, série mensal. */
  @Get('finance')
  @Roles('super_admin')
  financeOverview(@Query('months') months?: string) {
    return this.finance.overview(Math.min(24, Math.max(1, Number(months) || 12)));
  }

  /** Planos disponíveis para assinar (público dentro do app). */
  @Get('plans')
  plans() {
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonth: 'asc' }, select: { id: true, name: true, priceMonth: true, billingModel: true, limits: true, stripePriceId: true } });
  }

  /** Faturas do tenant (espelho do Stripe). */
  @Get('invoices')
  invoices(@CurrentUser() user: AuthUser) {
    return this.prisma.invoice.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 24 });
  }

  @Post('checkout')
  @Roles('tenant_admin', 'super_admin')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.stripe.checkout(user.tenantId, dto.planId);
  }

  @Post('portal')
  @Roles('tenant_admin', 'super_admin')
  portal(@CurrentUser() user: AuthUser) {
    return this.stripe.portal(user.tenantId);
  }

  /** Margem por cliente no período (dono do Atendo). */
  @Get('margin')
  @Roles('super_admin')
  margin(@Query('period') period?: string) {
    return this.stripe.margin(period || undefined);
  }

  @Post('sync-plans')
  @Roles('super_admin')
  async syncPlans() {
    await this.stripe.syncPlans();
    return { ok: true };
  }

  /** Uso do mês corrente vs limites do plano — alimenta o banner de 80%/100% no painel. */
  @Get('usage')
  async current(@CurrentUser() user: AuthUser) {
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
