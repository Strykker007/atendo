import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { DEFAULT_PERMISSIONS, PERMISSIONS, SYSTEM_PROFILES, type Permission } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { grantable } from '../auth/permissions';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class ProfileDto {
  @IsString() @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsArray() permissions: string[];
}

/**
 * Perfis de acesso do cliente. O papel (`Role`) decide só quem é o dono do sistema e qual o
 * ponto de partida; o que vale é o perfil, que o cliente monta como precisa.
 */
@Controller('profiles')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ProfilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Catálogo para a tela montar os campos — sem isto o front teria que repetir a lista. */
  @Get('catalog')
  catalog(@CurrentUser() u: AuthUser) {
    return { permissions: PERMISSIONS, mine: u.permissions ?? [] };
  }

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    await this.ensureSystemProfiles(u.tenantId);
    return this.prisma.accessProfile.findMany({
      where: { tenantId: u.tenantId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, description: true, permissions: true, isSystem: true, customized: true, _count: { select: { users: true } } },
    });
  }

  @Post()
  @RequirePermission('profiles.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) {
    const permissions = grantable({ role: u.role, profilePermissions: u.permissions ?? null }, dto.permissions);
    try {
      return await this.prisma.accessProfile.create({ data: { tenantId: u.tenantId, name: dto.name.trim(), description: dto.description?.trim() || null, permissions } });
    } catch {
      throw new ConflictException('Já existe um perfil com esse nome.');
    }
  }

  @Patch(':id')
  @RequirePermission('profiles.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<ProfileDto>) {
    const current = await this.prisma.accessProfile.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!current) throw new BadRequestException('Perfil não encontrado.');
    // perfil de sistema pode ter as permissões ajustadas, mas não o nome: ele é a referência
    // que a tela de equipe mostra, e renomear "Administrador" confundiria mais do que ajuda
    const name = current.isSystem ? current.name : (dto.name?.trim() ?? current.name);
    const permissions = dto.permissions ? grantable({ role: u.role, profilePermissions: u.permissions ?? null }, dto.permissions) : undefined;

    const updated = await this.prisma.accessProfile.update({
      where: { id },
      // a partir da primeira edição, o perfil padrão deixa de acompanhar o catálogo
      data: { name, description: dto.description?.trim() ?? current.description, permissions, ...(permissions && current.isSystem && { customized: true }) },
    });
    this.permissions.invalidate();
    return updated;
  }

  @Delete(':id')
  @RequirePermission('profiles.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const profile = await this.prisma.accessProfile.findFirst({ where: { id, tenantId: u.tenantId }, include: { _count: { select: { users: true } } } });
    if (!profile) throw new BadRequestException('Perfil não encontrado.');
    if (profile.isSystem) throw new BadRequestException('Os perfis padrão não podem ser excluídos.');
    // apagar com gente dentro jogaria essas pessoas de volta no padrão do papel sem ninguém
    // perceber — é exatamente o tipo de mudança de acesso silenciosa que não pode acontecer
    if (profile._count.users) throw new ConflictException(`${profile._count.users} pessoa(s) usam este perfil. Mova-as antes de excluir.`);
    await this.prisma.accessProfile.delete({ where: { id } });
    this.permissions.invalidate();
    return { ok: true };
  }

  /**
   * Garante os perfis padrão do cliente e os mantém alinhados ao catálogo.
   *
   * Criar e esquecer não serve: quando uma permissão nova entra no catálogo (foi o caso de
   * `campaigns.manage`), um perfil "Administrador" criado antes ficaria sem ela para sempre,
   * e quem estivesse nesse perfil perderia a funcionalidade nova sem ninguém perceber.
   *
   * O alinhamento para em quem o cliente editou (`customized`): aí a escolha é dele.
   */
  private async ensureSystemProfiles(tenantId: string) {
    const existentes = await this.prisma.accessProfile.findMany({ where: { tenantId, isSystem: true } });
    const porNome = new Map(existentes.map((p) => [p.name, p]));

    for (const { name, role } of SYSTEM_PROFILES) {
      const esperado = DEFAULT_PERMISSIONS[role] as Permission[];
      const atual = porNome.get(name);

      if (!atual) {
        await this.prisma.accessProfile
          .create({ data: { tenantId, name, isSystem: true, permissions: esperado, description: `Perfil padrão de ${name.toLowerCase()}` } })
          .catch(() => undefined); // corrida entre duas abas abrindo a tela ao mesmo tempo
        continue;
      }

      if (atual.customized) continue;
      const igual = atual.permissions.length === esperado.length && esperado.every((x) => atual.permissions.includes(x));
      if (!igual) await this.prisma.accessProfile.update({ where: { id: atual.id }, data: { permissions: esperado } });
    }
  }
}
