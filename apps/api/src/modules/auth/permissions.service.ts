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
  private readonly cache = new Map<string, { at: number; permissions: string[] | null; numberIds: string[]; departmentIds: string[]; companyIds: string[]; systemOwner: boolean }>();
  /** empresas de cada cliente → números delas (docs/empresas.md) */
  private readonly companies = new Map<string, { at: number; map: Map<string, string[]>; isolated: boolean }>();
  private static readonly TTL_MS = 15_000;

  constructor(private readonly prisma: PrismaService) {}

  /** Permissões (o que pode fazer), números e departamentos (sobre quais dados) numa consulta só. */
  async scope(user: { id: string; role: Principal['role']; impersonatorId?: string }): Promise<{ permissions: Permission[]; numberIds: string[]; departmentIds: string[]; companyIds: string[]; systemOwner: boolean }> {
    const row = await this.load(user.id);
    // "entrando como": admin completo do cliente visitado. Perfil, números, departamentos e
    // empresas são do cliente de origem do dono (docs/donos-do-sistema.md) — aplicados aqui,
    // recortariam o cliente visitado por ids de outro cliente
    if (user.impersonatorId) {
      return { permissions: permissionsOf({ role: user.role, profilePermissions: null }), numberIds: [], departmentIds: [], companyIds: [], systemOwner: row.systemOwner };
    }
    return {
      // lido do banco (com o cache curto), não do token: tirar a marcação vale em segundos
      systemOwner: row.systemOwner,
      permissions: permissionsOf({ role: user.role, profilePermissions: row.permissions }),
      numberIds: row.numberIds,
      departmentIds: row.departmentIds,
      companyIds: row.companyIds,
    };
  }

  /** Empresas do cliente e os números de cada uma. Mapa vazio = cliente não usa empresas. */
  async companyNumbers(tenantId: string): Promise<Map<string, string[]>> {
    return (await this.companiesOf(tenantId)).map;
  }

  /**
   * `tenant_settings.companyIsolation`: o recorte por empresa vale também para equipe, planilha de
   * contatos e transmissões (docs/empresas.md#separar-por-empresa). Mesmo cache das empresas.
   */
  async companyIsolation(tenantId: string): Promise<boolean> {
    return (await this.companiesOf(tenantId)).isolated;
  }

  private async companiesOf(tenantId: string) {
    const hit = this.companies.get(tenantId);
    if (hit && Date.now() - hit.at < PermissionsService.TTL_MS) return hit;
    const [rows, settings] = await Promise.all([
      this.prisma.company.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, numbers: { where: { deletedAt: null }, select: { id: true } } } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { companyIsolation: true } }),
    ]);
    const entry = { at: Date.now(), map: new Map(rows.map((c) => [c.id, c.numbers.map((n) => n.id)])), isolated: !!settings?.companyIsolation };
    this.companies.set(tenantId, entry);
    return entry;
  }

  private async load(userId: string) {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < PermissionsService.TTL_MS) return hit;
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { primaryUserId: true, profile: { select: { permissions: true } }, numbers: { select: { numberId: true } }, departments: { select: { departmentId: true } }, companies: { select: { companyId: true } } },
    });
    // dono é a PESSOA (docs/multiempresa.md): qualquer linha dela marcada ou super_admin — pelo papel
    // guardado, não o do token ("entrando como" o token diz tenant_admin)
    const personId = row?.primaryUserId ?? userId;
    const donas = row
      ? await this.prisma.user.count({ where: { isActive: true, OR: [{ id: personId }, { primaryUserId: personId }], AND: [{ OR: [{ isSystemOwner: true }, { role: 'super_admin' }] }] } })
      : 0;
    const entry = {
      at: Date.now(),
      permissions: row?.profile?.permissions ?? null,
      numberIds: (row?.numbers ?? []).map((n) => n.numberId),
      departmentIds: (row?.departments ?? []).map((d) => d.departmentId),
      companyIds: (row?.companies ?? []).map((c) => c.companyId),
      systemOwner: donas > 0,
    };
    this.cache.set(userId, entry);
    return entry;
  }

  /** Chamar sempre que um perfil for salvo, um usuário trocar de perfil, departamento, empresa ou marcação de dono, ou uma empresa mudar de números. */
  invalidate() {
    this.cache.clear();
    this.companies.clear();
  }
}
