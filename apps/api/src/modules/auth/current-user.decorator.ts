import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { Permission } from '@atendo/shared';

export interface AuthUser {
  id: string;
  /** null para super_admin sem cliente (dono do Atendo) — rotas de cliente são bloqueadas pelo TenantGuard */
  tenantId: string;
  role: Role;
  email: string;
  name: string;
  /**
   * Dono do sistema: `super_admin` ou usuário com `isSystemOwner` (docs/donos-do-sistema.md).
   * Libera as rotas `@Roles('super_admin')`; dentro do cliente dele valem o papel e o plano de lá.
   * Preenchido pelo JwtAuthGuard (vem do banco, também "entrando como")
   */
  systemOwner?: boolean;
  /** presente quando o dono do sistema está "entrando como" este tenant */
  impersonatorId?: string;
  /** preenchido pelo JwtAuthGuard em toda rota */
  permissions?: Permission[];
  /** números que o usuário opera; vazio = todos (ver number-scope.ts) */
  numberIds?: string[];
  /** departamentos do usuário; vazio = todos (ver department-scope.ts) */
  departmentIds?: string[];
  /** empresa selecionada no painel (header `x-company-id`), já validada; null/ausente = todas */
  companyId?: string | null;
  /** empresas que a pessoa pode selecionar; ausente = cliente sem empresas (ver company-scope.ts) */
  companyIds?: string[];
  /** números vinculados direto à pessoa (`user_numbers`), antes do recorte da empresa; vazio = todos */
  ownNumberIds?: string[];
  /** a pessoa é vinculada a empresas específicas (`user_companies`); false = enxerga todas */
  companyRestricted?: boolean;
  /** modo fim de turno (docs/escalas.md#fim-de-turno): só rotas `@ShiftLockOk` passam */
  shiftLocked?: boolean;
  /** epoch (s) do fim do turno/liberação, quando a sessão tem escala */
  shiftEndsAt?: number;
  /** epoch (s) em que a passagem acaba e a sessão cai de vez */
  lockedUntil?: number;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
