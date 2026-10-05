import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CountLimit } from '@atendo/shared';
import { UsageService } from './usage.service';

export const LIMIT_KEY = 'plan_limit';
/** Ex.: @RequireLimit('maxNumbers') antes de criar um número. `null` no plano = ilimitado. */
export const RequireLimit = (limit: CountLimit) => SetMetadata(LIMIT_KEY, limit);

@Injectable()
export class PlanLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usage: UsageService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const limit = this.reflector.get<CountLimit>(LIMIT_KEY, ctx.getHandler());
    if (!limit) return true;
    await this.usage.assertRoom(ctx.switchToHttp().getRequest().user?.tenantId, limit);
    return true;
  }
}
