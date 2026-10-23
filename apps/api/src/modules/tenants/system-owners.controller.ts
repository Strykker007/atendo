import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { PermissionsService } from '../auth/permissions.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { TenantProvisioningService } from './tenant-provisioning.service';

class PromoteDto {
  @IsUUID() userId!: string;
}

class InviteOwnerDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsEmail() email!: string;
}

class LinkDto {
  @IsUUID() tenantId!: string;
  @IsIn(['tenant_admin', 'manager', 'agent']) role!: 'tenant_admin' | 'manager' | 'agent';
}

/** dono = super_admin (sem cliente) ou usuário marcado — docs/donos-do-sistema.md */
const OWNER = { OR: [{ role: 'super_admin' as const }, { isSystemOwner: true }] };
const SELECT = { id: true, name: true, email: true, role: true, isActive: true, isSystemOwner: true, invitedAt: true, passwordSetAt: true, lastLoginAt: true, tenant: { select: { id: true, name: true } } } as const;

/**
 * Donos do sistema (docs/donos-do-sistema.md): quem tem as telas de dono e a equipe do suporte.
 * Dois jeitos de ser dono: `super_admin` sem cliente, ou marcação `isSystemOwner` num usuário de
 * um cliente (continua com o papel e o plano de lá). Só dono mexe aqui; o sistema nunca fica sem
 * dono ativo, e ninguém tira a si mesmo.
 */
@Controller('super-admin/owners')
@UseGuards(JwtAuthGuard, RolesGuard)
@NoTenantOk()
@Roles('super_admin')
export class SystemOwnersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly permissions: PermissionsService,
    private readonly provisioning: TenantProvisioningService,
  ) {}

  @Get()
  list() {
    return this.prisma.user.findMany({ where: OWNER, select: SELECT, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  /** Usuários de clientes que podem virar dono (busca por nome ou e-mail). */
  @Get('candidates')
  candidates(@Query('q') q?: string) {
    const termo = (q ?? '').trim();
    if (termo.length < 2) return [];
    return this.prisma.user.findMany({
      where: { isActive: true, isSystemOwner: false, role: { not: 'super_admin' }, OR: [{ email: { contains: termo, mode: 'insensitive' } }, { name: { contains: termo, mode: 'insensitive' } }] },
      select: { id: true, name: true, email: true, role: true, tenant: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      take: 10,
    });
  }

  /** Marca um usuário existente de um cliente como dono. */
  @Post()
  async promote(@Body() dto: PromoteDto) {
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { role: true, isSystemOwner: true, isActive: true } });
    if (!target || !target.isActive) throw new BadRequestException('Usuário não encontrado ou desativado.');
    if (target.role === 'super_admin' || target.isSystemOwner) throw new BadRequestException('Este usuário já é dono do sistema.');
    const row = await this.prisma.user.update({ where: { id: dto.userId }, data: { isSystemOwner: true }, select: SELECT });
    this.permissions.invalidate();
    return row;
  }

  /** Dono novo, sem cliente: convite para definir a senha (e-mail quando houver; o link volta sempre). */
  @Post('invite')
  async invite(@CurrentUser() u: AuthUser, @Body() dto: InviteOwnerDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) {
      throw new BadRequestException('Já existe um usuário com este e-mail. Para torná-lo dono, busque por ele em "Usuário existente".');
    }
    const user = await this.prisma.user.create({
      data: { tenantId: null, email, name: dto.name.trim(), role: 'super_admin', passwordHash: await this.auth.hashPassword(randomBytes(24).toString('base64url')), invitedAt: new Date() },
      select: SELECT,
    });
    const enviado = await this.auth.sendInvite(user.id, u.name, 'Atendo (donos do sistema)').catch(() => null);
    return { ...user, inviteLink: enviado ?? (await this.auth.inviteLink(user.id)).link, emailSent: !!enviado };
  }

  /** Novo link de convite de um dono que ainda não definiu a senha (o anterior deixa de valer). */
  @Post(':id/invite-link')
  async inviteLink(@Param('id') id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, ...OWNER }, select: { passwordSetAt: true } });
    if (!target) throw new BadRequestException('Dono não encontrado.');
    if (target.passwordSetAt) throw new BadRequestException('Este dono já definiu a senha.');
    return this.auth.inviteLink(id);
  }

  /**
   * Vincula um dono sem cliente a um cliente existente, com o papel escolhido: continua dono (pela
   * marcação) e passa a ter o menu do cliente. As sessões abertas caem para o novo vínculo valer já.
   */
  @Post(':id/link')
  async link(@Param('id') id: string, @Body() dto: LinkDto) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { role: true, tenantId: true } });
    if (!target || target.role !== 'super_admin' || target.tenantId) throw new BadRequestException('Só um dono sem cliente pode ser vinculado a um cliente.');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId }, select: { id: true } });
    if (!tenant) throw new BadRequestException('Cliente não encontrado.');
    await this.prisma.user.update({ where: { id }, data: { tenantId: tenant.id, role: dto.role, isSystemOwner: true } });
    await this.provisioning.linkRoleProfile(tenant.id, id, dto.role);
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    this.permissions.invalidate();
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: SELECT });
  }

  /**
   * Tira de dono. Marcado: perde só a marcação (continua no cliente dele). `super_admin` sem
   * cliente não tem outro acesso: é desativado.
   */
  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (id === (u.impersonatorId ?? u.id)) throw new BadRequestException('Você não pode tirar a si mesmo de dono.');
    const target = await this.prisma.user.findFirst({ where: { id, ...OWNER }, select: { role: true, tenantId: true, isActive: true } });
    if (!target) throw new BadRequestException('Dono não encontrado.');
    const outros = await this.prisma.user.count({ where: { ...OWNER, isActive: true, id: { not: id } } });
    if (!outros) throw new BadRequestException('O sistema precisa de pelo menos um dono ativo.');
    if (target.role === 'super_admin' && !target.tenantId) {
      await this.prisma.user.update({ where: { id }, data: { isActive: false } });
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    } else {
      await this.prisma.user.update({ where: { id }, data: { isSystemOwner: false } });
    }
    this.permissions.invalidate();
    return { ok: true };
  }
}
