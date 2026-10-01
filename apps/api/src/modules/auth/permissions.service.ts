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
  private readonly cache = new Map<string, { at: number; permissions: string[] | null }>();
  private static readonly TTL_MS = 15_000;

  constructor(private readonly prisma: PrismaService) {}

  async of(user: { id: string; role: Principal['role'] }): Promise<Permission[]> {
    return permissionsOf({ role: user.role, profilePermissions: await this.profilePermissions(user.id) });
  }

  /** `null` = usuário sem perfil; vale o padrão do papel. */
  private async profilePermissions(userId: string): Promise<string[] | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < PermissionsService.TTL_MS) return hit.permissions;
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: { profile: { select: { permissions: true } } } });
    const permissions = row?.profile?.permissions ?? null;
    this.cache.set(userId, { at: Date.now(), permissions });
    return permissions;
  }

  /** Chamar sempre que um perfil for salvo ou um usuário trocar de perfil. */
  invalidate() {
    this.cache.clear();
  }
}
