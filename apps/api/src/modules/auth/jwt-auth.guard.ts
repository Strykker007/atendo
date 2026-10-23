import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { env } from '../../config/env';
import { TenantGuard } from './tenant.guard';
import type { AuthUser } from './current-user.decorator';
import { PermissionsService } from './permissions.service';
import { COMPANY_HEADER, allowedCompanies, effectiveNumberIds } from './company-scope';
import { ShiftAccessService } from './shift-access.service';

const SHIFT_LOCK_OK = 'shiftLockOk';
/**
 * Rota que funciona com a sessão no modo fim de turno (docs/escalas.md#fim-de-turno): só o que
 * serve para encerrar bem o turno — quem sou, resumo, devolver atendimentos, pedir mais tempo.
 */
export const ShiftLockOk = () => SetMetadata(SHIFT_LOCK_OK, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tenantGuard: TenantGuard,
    private readonly permissions: PermissionsService,
    private readonly shift: ShiftAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException();
    let payload: (AuthUser & { sub: string; iatMs?: number; locked?: boolean }) | undefined;
    try {
      payload = await this.jwt.verifyAsync<AuthUser & { sub: string; impersonatorId?: string; shiftEndsAt?: number; locked?: boolean; lockedUntil?: number; iatMs?: number }>(token, { secret: env.JWT_ACCESS_SECRET });
      req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role, email: payload.email, name: payload.name, impersonatorId: payload.impersonatorId };
      // fim de turno: pela hora gravada no token — zero consulta ao banco por requisição
      const travado = !!payload.locked || (!!payload.shiftEndsAt && Date.now() >= payload.shiftEndsAt * 1000);
      if (travado) {
        req.user.shiftLocked = true;
        req.user.shiftEndsAt = payload.shiftEndsAt;
        req.user.lockedUntil = payload.lockedUntil;
      }
    } catch {
      throw new UnauthorizedException('Sua sessão expirou. Entre novamente para continuar.');
    }
    // Corte imediato (liberação encerrada, escala trocada): um GET no Redis só para quem pode ser
    // travado — admin, dono e "entrando como" nunca são. Token anterior ao corte = travado até renovar
    if (!req.user.shiftLocked && !payload?.impersonatorId && (req.user.role === 'agent' || req.user.role === 'manager')) {
      const corte = await this.shift.cutAt(req.user.id);
      if (corte && (payload?.iatMs ?? 0) <= corte) req.user.shiftLocked = true;
    }
    if (req.user.shiftLocked && !this.reflector.getAllAndOverride<boolean>(SHIFT_LOCK_OK, [ctx.getHandler(), ctx.getClass()])) {
      throw new ForbiddenException({ statusCode: 403, code: 'SHIFT_ENDED', message: 'Seu turno terminou. Encerre a passagem de turno ou peça mais tempo ao gestor.' });
    }
    // a lista fica pronta para TODA rota: além do PermissionsGuard, os services de conversa
    // decidem por permissão (quem vê os atendimentos da equipe, quem transfere os dos outros)
    const scope = await this.permissions.scope(req.user);
    req.user.permissions = scope.permissions;
    req.user.systemOwner = scope.systemOwner;
    req.user.numberIds = scope.numberIds;
    req.user.ownNumberIds = scope.numberIds;
    req.user.companyRestricted = scope.companyIds.length > 0;
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
