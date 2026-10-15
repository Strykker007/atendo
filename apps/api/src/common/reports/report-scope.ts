import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../../modules/auth/current-user.decorator';
import { NO_NUMBER } from '../../modules/auth/company-scope';

/** Empresa escolhida na própria página de relatórios: `all` = todas as que a pessoa opera. */
export const ReportCompany = z.union([z.literal('all'), z.string().uuid()]).optional();

/**
 * Números que um relatório cobre (docs/empresas.md#relatórios). `undefined` = o cliente inteiro.
 *
 * Relatório é histórico: além dos números ativos, entram os **excluídos** da empresa (continuam
 * apontando para ela com as conversas, vendas e fila que tiveram) e as empresas **removidas**
 * (o que sobrou nelas são justamente os números excluídos). Os excluídos só entram para quem
 * enxerga todos os números ativos da empresa: quem é restrito a alguns números não ganha o
 * histórico dos outros.
 *
 * `pedida` = empresa escolhida na página de relatórios (independe do seletor do menu). Sem ela,
 * vale o seletor do menu (header `x-company-id`, já convertido em `numberIds`) — é o caso das
 * telas que não têm o filtro próprio (ranking, satisfação).
 */
export async function reportScope(prisma: PrismaService, u: AuthUser, pedida?: string): Promise<string[] | undefined> {
  let empresas: string[] | null;
  let proprios: string[];
  if (pedida) {
    proprios = u.ownNumberIds ?? [];
    if (pedida === 'all') {
      empresas = u.companyRestricted ? (u.companyIds ?? []) : null;
    } else {
      const c = await prisma.company.findFirst({ where: { id: pedida, tenantId: u.tenantId }, select: { id: true, deletedAt: true } });
      if (!c) throw new NotFoundException('Empresa não encontrada');
      if (u.companyRestricted && (c.deletedAt || !u.companyIds?.includes(c.id))) throw new ForbiddenException('Você não tem acesso aos relatórios desta empresa.');
      empresas = [c.id];
    }
  } else {
    if (!u.numberIds?.length) return undefined;
    proprios = u.numberIds;
    empresas = u.companyId ? [u.companyId] : u.companyRestricted ? (u.companyIds ?? []) : null;
  }

  if (empresas === null) return proprios.length ? [...proprios].sort() : undefined;
  if (!empresas.length) return [NO_NUMBER];
  const numeros = await prisma.whatsAppNumber.findMany({ where: { tenantId: u.tenantId, companyId: { in: empresas } }, select: { id: true, deletedAt: true } });
  let final: string[];
  if (!proprios.length) {
    final = numeros.map((n) => n.id);
  } else {
    const vejo = new Set(proprios);
    const todosAtivos = numeros.filter((n) => !n.deletedAt).every((n) => vejo.has(n.id));
    final = numeros.filter((n) => (n.deletedAt ? todosAtivos : vejo.has(n.id))).map((n) => n.id);
  }
  return final.length ? final.sort() : [NO_NUMBER];
}
