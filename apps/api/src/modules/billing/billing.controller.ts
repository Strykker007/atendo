import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { UsageService, periodOf } from './usage.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(
    private readonly usage: UsageService,
    private readonly prisma: PrismaService,
  ) {}

  /** Uso do mês corrente vs limites do plano — alimenta o banner de 80%/100% no painel. */
  @Get('usage')
  async current(@CurrentUser() user: AuthUser) {
    const [used, plan, sub] = await Promise.all([
      this.usage.current(user.tenantId),
      this.usage.limits(user.tenantId),
      this.prisma.subscription.findUnique({ where: { tenantId: user.tenantId }, include: { plan: true } }),
    ]);
    return { period: periodOf(), used, limits: plan?.limits ?? null, status: sub?.status ?? null, plan: sub?.plan.name ?? null };
  }
}
