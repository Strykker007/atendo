import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { permissionsOf, type Principal } from './permissions';
import type { Permission } from '@atendo/shared';

/**
 * Resolve as permissões do usuário a cada requisição.
 *
 * O token carrega só o papel, de propósito: permissão vive no perfil, e perfil muda. Se
 * fosse assinada no token, tirar um acesso de alguém só valeria quando o token expirasse —
 * 15 minutos em que a pessoa continua entrando onde já não deveria.
 *
 * O preço é uma consulta por requisição, amortizada por um cache curto. O cache é limpo
 * inteiro quando um perfil ou um vínculo muda: a escrita é rara e a correção importa mais
 * do que economizar entradas.
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, { at: number; permissions: string[] | null; numberIds: string[]; departmentIds: string[]; companyIds: string[] }>();
  /** empresas de cada cliente → números delas (docs/empresas.md) */
  private readonly companies = new Map<string, { at: number; map: Map<string, string[]> }>();
  private static readonly TTL_MS = 15_000;

  constructor(private readonly prisma: PrismaService) {}

  /** Permissões (o que pode fazer), números e departamentos (sobre quais dados) numa consulta só. */
  async scope(user: { id: string; role: Principal['role'] }): Promise<{ permissions: Permission[]; numberIds: string[]; departmentIds: string[]; companyIds: string[] }> {
    const row = await this.load(user.id);
    return {
      permissions: permissionsOf({ role: user.role, profilePermissions: row.permissions }),
      numberIds: row.numberIds,
      departmentIds: row.departmentIds,
      companyIds: row.companyIds,
    };
  }

  /** Empresas do cliente e os números de cada uma. Mapa vazio = cliente não usa empresas. */
  async companyNumbers(tenantId: string): Promise<Map<string, string[]>> {
    const hit = this.companies.get(tenantId);
    if (hit && Date.now() - hit.at < PermissionsService.TTL_MS) return hit.map;
    const rows = await this.prisma.company.findMany({ where: { tenantId }, select: { id: true, numbers: { where: { deletedAt: null }, select: { id: true } } } });
    const map = new Map(rows.map((c) => [c.id, c.numbers.map((n) => n.id)]));
    this.companies.set(tenantId, { at: Date.now(), map });
    return map;
  }

  private async load(userId: string) {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < PermissionsService.TTL_MS) return hit;
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { permissions: true } }, numbers: { select: { numberId: true } }, departments: { select: { departmentId: true } }, companies: { select: { companyId: true } } },
    });
    const entry = {
      at: Date.now(),
      permissions: row?.profile?.permissions ?? null,
      numberIds: (row?.numbers ?? []).map((n) => n.numberId),
      departmentIds: (row?.departments ?? []).map((d) => d.departmentId),
      companyIds: (row?.companies ?? []).map((c) => c.companyId),
    };
    this.cache.set(userId, entry);
    return entry;
  }

  /** Chamar sempre que um perfil for salvo, um usuário trocar de perfil, departamento ou empresa, ou uma empresa mudar de números. */
  invalidate() {
    this.cache.clear();
    this.companies.clear();
  }
}
