import type { Prisma } from '@prisma/client';
import { numberFilter, type Scoped } from './number-scope';

/**
 * Que parte da equipe a pessoa enxerga e gerencia (docs/empresas.md#equipe).
 *
 * Só vale com `companyIsolation` ligado no cliente (opt-in, docs/empresas.md#separar-por-empresa):
 * desligado, todo mundo vê a equipe toda, como sempre foi.
 *
 * Quem é vinculado a empresas (`user_companies`) vê só quem divide ao menos uma empresa com ele:
 * o gestor predial vê a equipe do condomínio dele; o gerente de contrato, a dos condomínios em que
 * atua. Quem não tem vínculo (gerente da administradora), o admin da conta e o dono do sistema
 * entrando como o cliente veem a equipe toda — mesma régua de `canManageNumber`.
 *
 * Gente sem vínculo a empresa nenhuma fica fora da lista de quem é restrito: ela não é "do
 * condomínio". Transferir para ela continua valendo, pela régua própria da transferência.
 */
export interface TeamViewer {
  role: string;
  impersonatorId?: string;
  companyRestricted?: boolean;
  /** `tenant_settings.companyIsolation` (preenchido pelo guard) */
  companyIsolation?: boolean;
  /** empresas que a pessoa pode selecionar (já validadas pelo guard) */
  companyIds?: string[];
}

/** ids das empresas que limitam a equipe visível; `null` = equipe toda */
export function teamCompanyIds(u: TeamViewer): string[] | null {
  if (!u.companyIsolation || u.role === 'super_admin' || u.role === 'tenant_admin' || u.impersonatorId || !u.companyRestricted) return null;
  return u.companyIds ?? [];
}

/** Filtro de `user` para o Prisma; vazio quando a pessoa vê a equipe toda. */
export function teamWhere(u: TeamViewer): Prisma.UserWhereInput {
  const ids = teamCompanyIds(u);
  return ids ? { companies: { some: { companyId: { in: ids } } } } : {};
}

/**
 * Empresas em que entra a pessoa criada por quem é restrito: sem vínculo ela nasceria vendo
 * todos os condomínios. A empresa selecionada no topo ou, sem seleção, todas as de quem criou.
 * Vazio = não vincula (quem cria vê a equipe toda).
 */
export function creatorCompanyIds(u: TeamViewer & { companyId?: string | null }): string[] {
  const ids = teamCompanyIds(u);
  if (!ids) return [];
  return u.companyId && ids.includes(u.companyId) ? [u.companyId] : ids;
}

/**
 * Números que limitam a planilha de contatos e as transmissões: os de quem pede, só com
 * `companyIsolation` ligado. Desligado = base inteira do cliente, como sempre foi.
 */
export function isolatedNumbers(u: Scoped & { companyIsolation?: boolean }): { in: string[] } | undefined {
  return u.companyIsolation ? numberFilter(u) : undefined;
}
