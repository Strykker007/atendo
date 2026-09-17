import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_FEATURE_LABEL, type PlanFeature } from '@atendo/shared';
import { UsageService } from './usage.service';

export const FEATURE_KEY = 'plan_feature';
/** Ex.: @RequireFeature('flows') — 403 se o plano do tenant não inclui a funcionalidade. */
export const RequireFeature = (feature: PlanFeature) => SetMetadata(FEATURE_KEY, feature);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usage: UsageService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const feature = this.reflector.getAllAndOverride<PlanFeature>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!feature) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (user?.role === 'super_admin') return true;
    const plan = await this.usage.limits(user?.tenantId);
    if (!plan?.limits.features?.includes(feature)) {
      throw new ForbiddenException(`"${PLAN_FEATURE_LABEL[feature]}" não está incluído no seu plano. Faça upgrade em Plano e uso.`);
    }
    return true;
  }
}
