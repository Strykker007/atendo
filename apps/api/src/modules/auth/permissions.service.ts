import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { permissionsOf, type Principal } from './permissions';
import type { Permission } from '@atendo/shared';
import { NO_NUMBER } from './company-scope';

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
  private readonly cache = new Map<string, { at: number; tenantId: string | null; defaultNumberIds: string[]; permissions: string[] | null; numberIds: string[]; departmentIds: string[]; companyIds: string[]; systemOwner: boolean }>();
  /** números de cada cliente com reservado e departamento (docs/18-perfis-de-acesso.md#número-reservado, docs/departamentos.md#hierarquia) */
  private readonly tenantNumbers = new Map<string, { at: number; rows: { id: string; reserved: boolean; departmentId: string | null }[] }>();
  /** árvore de departamentos de cada cliente: id → pai (docs/departamentos.md#hierarquia) */
  private readonly deptTrees = new Map<string, { at: number; parent: Map<string, string | null> }>();
  /** empresas de cada cliente → números delas (docs/empresas.md) */
  private readonly companies = new Map<string, { at: number; map: Map<string, string[]>; isolated: boolean }>();
  private static readonly TTL_MS = 15_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Permissões (o que pode fazer), números e departamentos (sobre quais dados) numa consulta só.
   * `numberIds` é o escopo efetivo (vazio = todos); `linkedNumberIds`, o que está marcado em Equipe.
   * Diferem quando o cliente tem número reservado: quem não tem marcação opera todos os NÃO reservados.
   */
  async scope(user: { id: string; role: Principal['role']; impersonatorId?: string }): Promise<{ permissions: Permission[]; numberIds: string[]; linkedNumberIds: string[]; defaultNumberIds: string[]; departmentIds: string[]; companyIds: string[]; systemOwner: boolean }> {
    const row = await this.load(user.id);
    // "entrando como": admin completo do cliente visitado. Perfil, números, departamentos e
    // empresas são do cliente de origem do dono (docs/donos-do-sistema.md) — aplicados aqui,
    // recortariam o cliente visitado por ids de outro cliente
    if (user.impersonatorId) {
      return { permissions: permissionsOf({ role: user.role, profilePermissions: null }), numberIds: [], linkedNumberIds: [], defaultNumberIds: [], departmentIds: [], companyIds: [], systemOwner: row.systemOwner };
    }
    const permissions = permissionsOf({ role: user.role, profilePermissions: row.permissions });
    const admin = user.role === 'tenant_admin' || user.role === 'super_admin';
    // alcance de departamento (docs/departamentos.md#hierarquia): quem tem "ver toda a equipe" vê o
    // departamento dele e os que ficam abaixo; os demais, só os departamentos de que participam
    const departmentIds = row.departmentIds.length && row.tenantId && !admin && permissions.includes('conversations.view_all')
      ? await this.departmentReach(row.tenantId, row.departmentIds)
      : row.departmentIds;
    let numberIds = row.numberIds;
    // sem números marcados, admin da conta (e o dono) vê todos; os demais ficam com os NÃO reservados
    // e, se estão em departamento, com os números sem departamento ou de departamento ao alcance.
    // Lista vazia aqui seria "todos" — por isso o NO_NUMBER
    if (!numberIds.length && row.tenantId && !admin) {
      const numeros = await this.numbersOf(row.tenantId);
      const temReservado = numeros.some((n) => n.reserved);
      const alcance = new Set(departmentIds);
      const porDepto = alcance.size > 0 && numeros.some((n) => n.departmentId && !alcance.has(n.departmentId));
      if (temReservado || porDepto) {
        const abertos = numeros.filter((n) => !n.reserved && (!alcance.size || !n.departmentId || alcance.has(n.departmentId))).map((n) => n.id);
        numberIds = abertos.length ? abertos : [NO_NUMBER];
      }
    }
    return {
      // lido do banco (com o cache curto), não do token: tirar a marcação vale em segundos
      systemOwner: row.systemOwner,
      permissions,
      numberIds,
      linkedNumberIds: row.numberIds,
      // só os que a pessoa ainda opera (o número pode ter sido reservado ou tirado dela depois)
      defaultNumberIds: row.defaultNumberIds.filter((id) => !numberIds.length || numberIds.includes(id)),
      departmentIds,
      companyIds: row.companyIds,
    };
  }

  /** Os departamentos dados e todos os que ficam abaixo deles (filhos, netos…). */
  async departmentReach(tenantId: string, ownIds: readonly string[]): Promise<string[]> {
    let hit = this.deptTrees.get(tenantId);
    if (!hit || Date.now() - hit.at >= PermissionsService.TTL_MS) {
      const rows = await this.prisma.department.findMany({ where: { tenantId }, select: { id: true, parentId: true } });
      hit = { at: Date.now(), parent: new Map(rows.map((d) => [d.id, d.parentId])) };
      this.deptTrees.set(tenantId, hit);
    }
    return departmentDescendants(hit.parent, ownIds);
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

  /** Números não reservados do cliente; null quando nenhum é reservado (o caso comum: nada muda). */
  async openNumbersOf(tenantId: string): Promise<string[] | null> {
    const rows = await this.numbersOf(tenantId);
    return rows.some((n) => n.reserved) ? rows.filter((n) => !n.reserved).map((n) => n.id) : null;
  }

  private async numbersOf(tenantId: string) {
    const hit = this.tenantNumbers.get(tenantId);
    if (hit && Date.now() - hit.at < PermissionsService.TTL_MS) return hit.rows;
    const rows = await this.prisma.whatsAppNumber.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, reserved: true, defaultDepartmentId: true } });
    const entry = { at: Date.now(), rows: rows.map((n) => ({ id: n.id, reserved: n.reserved, departmentId: n.defaultDepartmentId })) };
    this.tenantNumbers.set(tenantId, entry);
    return entry.rows;
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
      select: { tenantId: true, defaultNumberIds: true, primaryUserId: true, profile: { select: { permissions: true } }, numbers: { select: { numberId: true } }, departments: { select: { departmentId: true } }, companies: { select: { companyId: true } } },
    });
    // dono é a PESSOA (docs/multiempresa.md): qualquer linha dela marcada ou super_admin — pelo papel
    // guardado, não o do token ("entrando como" o token diz tenant_admin)
    const personId = row?.primaryUserId ?? userId;
    const donas = row
      ? await this.prisma.user.count({ where: { isActive: true, OR: [{ id: personId }, { primaryUserId: personId }], AND: [{ OR: [{ isSystemOwner: true }, { role: 'super_admin' }] }] } })
      : 0;
    const entry = {
      at: Date.now(),
      tenantId: row?.tenantId ?? null,
      defaultNumberIds: row?.defaultNumberIds ?? [],
      permissions: row?.profile?.permissions ?? null,
      numberIds: (row?.numbers ?? []).map((n) => n.numberId),
      departmentIds: (row?.departments ?? []).map((d) => d.departmentId),
      companyIds: (row?.companies ?? []).map((c) => c.companyId),
      systemOwner: donas > 0,
    };
    this.cache.set(userId, entry);
    return entry;
  }

  /** Chamar sempre que um perfil for salvo, um usuário trocar de perfil, departamento, empresa ou marcação de dono, uma empresa mudar de números ou um número for criado, excluído, (des)reservado ou trocar de departamento, ou um departamento mudar de pai. */
  invalidate() {
    this.cache.clear();
    this.companies.clear();
    this.tenantNumbers.clear();
    this.deptTrees.clear();
  }
}

/** Fecho para baixo da árvore (id → pai). Ciclo não trava: cada departamento entra uma vez. */
export function departmentDescendants(parent: ReadonlyMap<string, string | null>, ownIds: readonly string[]): string[] {
  const filhos = new Map<string, string[]>();
  for (const [id, pai] of parent) if (pai) filhos.set(pai, [...(filhos.get(pai) ?? []), id]);
  const visto = new Set<string>();
  const fila = [...ownIds];
  while (fila.length) {
    const id = fila.shift()!;
    if (visto.has(id)) continue;
    visto.add(id);
    fila.push(...(filhos.get(id) ?? []));
  }
  return [...visto];
}
