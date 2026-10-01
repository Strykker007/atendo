import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, type Permission } from '@atendo/shared';
import type { AuthUser } from './current-user.decorator';

export const PERMISSION_KEY = 'permission';
/** Exige uma permissão do catálogo. Substitui `@Roles` onde a regra é "o que pode fazer". */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

/**
 * Só compara: quem resolve a lista é o `JwtAuthGuard`, que a deixa em `user.permissions`
 * para toda rota — inclusive as que decidem por permissão dentro do service (conversas).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Sem permissão');
    // o dono do sistema dá suporte entrando como o cliente: passa por qualquer checagem
    if (user.role === 'super_admin') return true;
    if (!user.permissions?.includes(required)) throw new ForbiddenException(`Seu perfil de acesso não inclui: ${PERMISSIONS[required]}`);
    return true;
  }
}
