import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  /** null para super_admin (dono do Atendo, sem tenant) — rotas de cliente são bloqueadas pelo TenantGuard */
  tenantId: string;
  role: Role;
  email: string;
  name: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
