import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlanLimits } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from './usage.service';

export const LIMIT_KEY = 'plan_limit';
/** Ex.: @RequireLimit('maxNumbers') antes de criar um número. */
export const RequireLimit = (limit: keyof Pick<PlanLimits, 'maxNumbers' | 'maxAgents'>) => SetMetadata(LIMIT_KEY, limit);

@Injectable()
export class PlanLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const limit = this.reflector.get<keyof PlanLimits>(LIMIT_KEY, ctx.getHandler());
    if (!limit) return true;
    const tenantId: string = ctx.switchToHttp().getRequest().user?.tenantId;
    const plan = await this.usage.limits(tenantId);
    if (!plan) throw new ForbiddenException('Sem assinatura ativa');

    const count =
      limit === 'maxNumbers'
        ? await this.prisma.whatsAppNumber.count({ where: { tenantId, isActive: true } })
        : await this.prisma.user.count({ where: { tenantId, isActive: true, role: 'agent' } });
    if (count >= Number(plan.limits[limit])) {
      throw new ForbiddenException(`Limite do plano atingido: ${limit} = ${plan.limits[limit]}. Faça upgrade.`);
    }
    return true;
  }
}
