import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { env } from '../../config/env';
import { TenantGuard } from './tenant.guard';
import type { AuthUser } from './current-user.decorator';
import { PermissionsService } from './permissions.service';
import { COMPANY_HEADER, allowedCompanies, effectiveNumberIds } from './company-scope';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly tenantGuard: TenantGuard,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<AuthUser & { sub: string; impersonatorId?: string }>(token, { secret: env.JWT_ACCESS_SECRET });
      req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role, email: payload.email, name: payload.name, impersonatorId: payload.impersonatorId };
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
    // a lista fica pronta para TODA rota: além do PermissionsGuard, os services de conversa
    // decidem por permissão (quem vê os atendimentos da equipe, quem transfere os dos outros)
    const scope = await this.permissions.scope(req.user);
    req.user.permissions = scope.permissions;
    req.user.numberIds = scope.numberIds;
    req.user.departmentIds = scope.departmentIds;

    // empresa/unidade vira números (ver company-scope.ts): só consulta quando o cliente tem empresas
    if (req.user.tenantId && req.user.role !== 'super_admin') {
      const companyNumbers = await this.permissions.companyNumbers(req.user.tenantId);
      if (companyNumbers.size) {
        const pedida = req.headers[COMPANY_HEADER];
        const efetivo = effectiveNumberIds({
          userNumberIds: scope.numberIds,
          userCompanyIds: scope.companyIds,
          companyNumbers,
          activeCompanyId: typeof pedida === 'string' ? pedida : null,
        });
        req.user.numberIds = efetivo.numberIds;
        req.user.companyId = efetivo.companyId;
        req.user.companyIds = allowedCompanies(scope.companyIds, companyNumbers);
      }
    }

    // dono do sistema (sem tenant) só entra em rotas marcadas com @NoTenantOk
    return this.tenantGuard.canActivate(ctx);
  }
}
