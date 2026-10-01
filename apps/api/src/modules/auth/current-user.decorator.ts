import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { Permission } from '@atendo/shared';

export interface AuthUser {
  id: string;
  /** null para super_admin (dono do Atendo, sem tenant) — rotas de cliente são bloqueadas pelo TenantGuard */
  tenantId: string;
  role: Role;
  email: string;
  name: string;
  /** presente quando o dono do sistema está "entrando como" este tenant */
  impersonatorId?: string;
  /** preenchido pelo JwtAuthGuard em toda rota */
  permissions?: Permission[];
  /** números que o usuário opera; vazio = todos (ver number-scope.ts) */
  numberIds?: string[];
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
