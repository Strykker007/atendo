import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../../modules/auth/current-user.decorator';

/**
 * Números que um relatório cobre (docs/empresas.md#relatórios). `undefined` = o cliente inteiro.
 *
 * Parte do escopo da requisição (`numberIds`: empresa selecionada ∩ números da pessoa), que só
 * tem números **ativos** — é o que serve para operar. Relatório é histórico: número excluído
 * continua com as conversas, vendas e a fila que teve, e elas são da empresa dele. Sem somar os
 * excluídos, escolher uma empresa escondia esse histórico, que só aparecia em "Todas".
 *
 * Os excluídos entram só quando a pessoa enxerga todos os números ativos dessas empresas: quem
 * é restrito a alguns números não passa a ver o histórico dos outros.
 */
export async function reportScope(prisma: PrismaService, u: AuthUser): Promise<string[] | undefined> {
  if (!u.numberIds?.length) return undefined;
  const empresas = u.companyId ? [u.companyId] : u.companyIds ?? [];
  if (!empresas.length) return [...u.numberIds].sort();
  const numeros = await prisma.whatsAppNumber.findMany({ where: { tenantId: u.tenantId, companyId: { in: empresas } }, select: { id: true, deletedAt: true } });
  const vejo = new Set(u.numberIds);
  const todosAtivos = numeros.filter((n) => !n.deletedAt).every((n) => vejo.has(n.id));
  const excluidos = todosAtivos ? numeros.filter((n) => n.deletedAt).map((n) => n.id) : [];
  return [...new Set([...u.numberIds, ...excluidos])].sort();
}
