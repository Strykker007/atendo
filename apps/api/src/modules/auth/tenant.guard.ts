import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const NO_TENANT_OK = 'no_tenant_ok';
/** Marca rotas que o dono do sistema (sem tenant) pode chamar. Todo o resto é área de cliente. */
export const NoTenantOk = () => SetMetadata(NO_TENANT_OK, true);

/**
 * Global: usuário autenticado sem tenant (super_admin) só acessa rotas marcadas com @NoTenantOk.
 * Evita 500 por `tenantId: null` em consultas de cliente e deixa a regra explícita.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || user.tenantId) return true;
    const ok = this.reflector.getAllAndOverride<boolean>(NO_TENANT_OK, [ctx.getHandler(), ctx.getClass()]);
    if (!ok) throw new ForbiddenException('Esta área é de clientes. Como dono do sistema, use Financeiro (dono).');
    return true;
  }
}
