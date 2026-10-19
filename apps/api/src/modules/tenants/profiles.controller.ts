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
      select: { id: true, name: true, description: true, permissions: true, isSystem: true, systemRole: true, customized: true, _count: { select: { users: true } } },
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
    // Administrador continua sendo a âncora da conta. Os outros perfis padrão podem receber
    // o vocabulário do cliente (Porteiro, Supervisor…), pois a referência técnica é systemRole.
    const name = current.systemRole === 'tenant_admin' ? current.name : (dto.name?.trim() ?? current.name);
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
    // O administrador é a âncora de recuperação da conta. Os demais perfis, inclusive os
    // padrões que não fazem sentido para este negócio, podem sair.
    if (profile.systemRole === 'tenant_admin') throw new BadRequestException('O perfil Administrador não pode ser excluído.');
    // A relação User.profile usa onDelete:SetNull: quem usava o perfil volta ao acesso padrão
    // do seu papel. A interface informa quantas pessoas serão afetadas antes da confirmação.
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
    const porRole = new Map(existentes.map((p) => [p.systemRole, p]));

    for (const { role } of SYSTEM_PROFILES) {
      const esperado = DEFAULT_PERMISSIONS[role] as Permission[];
      const atual = porRole.get(role);

      // A ausência também é uma escolha: o cliente pode remover os perfis de catálogo que não
      // usa (por exemplo, Gerente numa portaria). Novos clientes já os recebem no provisionamento.
      if (!atual) continue;

      if (atual.customized) continue;
      const igual = atual.permissions.length === esperado.length && esperado.every((x) => atual.permissions.includes(x));
      if (!igual) await this.prisma.accessProfile.update({ where: { id: atual.id }, data: { permissions: esperado } });
    }
  }
}
