import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { PlanLimitGuard, RequireLimit } from '../billing/plan-limit.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import type { PlanLimits } from '@atendo/shared';

class CompanyDto {
  @IsString() @MaxLength(60) name: string;
  /** com ou sem pontuação; guardado só com dígitos */
  @IsOptional() @IsString() @MaxLength(20) cnpj?: string | null;
  @IsOptional() @IsString() @MaxLength(200) description?: string | null;
  /** números da empresa; ausente = não mexe. Substitui a lista inteira (número sai de outra empresa) */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) numberIds?: string[];
  /** quem opera a empresa; ausente = não mexe. Substitui a lista inteira */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) userIds?: string[];
}

const SELECT = {
  id: true, name: true, cnpj: true, description: true, createdAt: true,
  numbers: { where: { deletedAt: null }, select: { id: true, label: true, phone: true, color: true }, orderBy: { createdAt: 'asc' } },
  users: { select: { user: { select: { id: true, name: true, isActive: true } } } },
} satisfies Prisma.CompanySelect;

/**
 * Regras de empresas/unidades por cliente (docs/empresas.md). Usado pela tela do cliente
 * (`/companies`, tenant do token) e pela do dono (`/admin/tenants/:tenantId/companies`).
 */
@Injectable()
class CompaniesService {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService) {}

  list(tenantId: string) {
    return this.prisma.company.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: SELECT });
  }

  async create(tenantId: string, dto: CompanyDto) {
    const { numberIds, userIds, ...data } = dto;
    const company = await this.prisma.company.create({ data: { tenantId, ...clean(data) } as Prisma.CompanyUncheckedCreateInput }).catch(duplicate);
    await this.setLinks(tenantId, company.id, numberIds, userIds);
    return this.prisma.company.findUniqueOrThrow({ where: { id: company.id }, select: SELECT });
  }

  async update(tenantId: string, id: string, dto: Partial<CompanyDto>) {
    const { numberIds, userIds, ...data } = dto;
    await this.prisma.company.findFirstOrThrow({ where: { id, tenantId }, select: { id: true } });
    await this.prisma.company.update({ where: { id, tenantId }, data: clean(data) }).catch(duplicate);
    await this.setLinks(tenantId, id, numberIds, userIds);
    return this.prisma.company.findUniqueOrThrow({ where: { id }, select: SELECT });
  }

  /** Os números da empresa ficam sem empresa; conversas e histórico não mudam. */
  async remove(tenantId: string, id: string) {
    const company = await this.prisma.company.delete({ where: { id, tenantId } });
    this.permissions.invalidate();
    return company;
  }

  /** Só números e usuários deste cliente: os ids vêm do corpo da requisição. */
  private async setLinks(tenantId: string, companyId: string, numberIds?: string[], userIds?: string[]) {
    if (numberIds) {
      const ids = [...new Set(numberIds)];
      const valid = await this.prisma.whatsAppNumber.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, select: { id: true } });
      if (valid.length !== ids.length) throw new BadRequestException('Algum número não foi encontrado nesta conta.');
      await this.prisma.$transaction([
        this.prisma.whatsAppNumber.updateMany({ where: { tenantId, companyId, id: { notIn: ids } }, data: { companyId: null } }),
        this.prisma.whatsAppNumber.updateMany({ where: { tenantId, id: { in: ids } }, data: { companyId } }),
      ]);
    }
    if (userIds) {
      const ids = [...new Set(userIds)];
      const valid = await this.prisma.user.findMany({ where: { id: { in: ids }, tenantId, role: { not: 'super_admin' } }, select: { id: true } });
      if (valid.length !== ids.length) throw new BadRequestException('Alguém da lista não foi encontrado na equipe.');
      await this.prisma.$transaction([
        this.prisma.userCompany.deleteMany({ where: { companyId } }),
        this.prisma.userCompany.createMany({ data: valid.map((v) => ({ userId: v.id, companyId })), skipDuplicates: true }),
      ]);
    }
    // o escopo de empresas vem no cache de permissões: sem isto valeria só em 15 s
    if (numberIds || userIds) this.permissions.invalidate();
  }
}

/**
 * Empresas/unidades do cliente (docs/empresas.md). Cadastrar, renomear e decidir quais números
 * e quais pessoas pertencem a cada uma é configuração da conta (`settings.manage`); a listagem
 * do seletor (`/companies/mine`) é de todo mundo. Quantas empresas cabem vem do plano
 * (`PlanLimits.maxCompanies`).
 */
@Controller('companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class CompaniesController {
  constructor(private readonly prisma: PrismaService, private readonly companies: CompaniesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.companies.list(u.tenantId);
  }

  /** O que o seletor do topo oferece: só as empresas que a pessoa opera. */
  @Get('mine')
  async mine(@CurrentUser() u: AuthUser) {
    if (!u.companyIds?.length) return [];
    return this.prisma.company.findMany({ where: { tenantId: u.tenantId, id: { in: u.companyIds } }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }

  @Post()
  @RequirePermission('settings.manage')
  @UseGuards(PlanLimitGuard)
  @RequireLimit('maxCompanies')
  create(@CurrentUser() u: AuthUser, @Body() dto: CompanyDto) {
    return this.companies.create(u.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<CompanyDto>) {
    return this.companies.update(u.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.companies.remove(u.tenantId, id);
  }
}

/**
 * Empresas de qualquer cliente pela conta do dono, sem precisar "Entrar como". O dono **não**
 * esbarra no `maxCompanies` do plano: o limite existe para o autoatendimento do cliente, e é o
 * dono quem decide abrir exceção (a tela avisa quando passa do plano).
 */
@Controller('admin/tenants/:tenantId/companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@NoTenantOk()
@Roles('super_admin')
class AdminCompaniesController {
  constructor(private readonly prisma: PrismaService, private readonly companies: CompaniesService) {}

  @Get()
  async list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true } });
    return this.companies.list(tenantId);
  }

  /** O que o formulário precisa do cliente: números, equipe e o limite do plano. */
  @Get('options')
  async options(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    const [numbers, users, sub] = await Promise.all([
      this.prisma.whatsAppNumber.findMany({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, label: true, phone: true } }),
      this.prisma.user.findMany({ where: { tenantId, role: { not: 'super_admin' } }, orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true } }),
      this.prisma.subscription.findUnique({ where: { tenantId }, select: { plan: { select: { limits: true } } } }),
    ]);
    return { numbers, users, maxCompanies: (sub?.plan.limits as PlanLimits | undefined)?.maxCompanies ?? null };
  }

  @Post()
  async create(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CompanyDto) {
    await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true } });
    return this.companies.create(tenantId, dto);
  }

  @Patch(':id')
  update(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id') id: string, @Body() dto: Partial<CompanyDto>) {
    return this.companies.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id') id: string) {
    return this.companies.remove(tenantId, id);
  }
}

function clean(data: Partial<Pick<CompanyDto, 'name' | 'cnpj' | 'description'>>) {
  const out: Prisma.CompanyUpdateInput = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new BadRequestException('Informe o nome da empresa.');
    out.name = name;
  }
  if (data.cnpj !== undefined) {
    const digits = (data.cnpj ?? '').replace(/\D/g, '');
    if (digits && digits.length !== 14) throw new BadRequestException('CNPJ deve ter 14 dígitos.');
    out.cnpj = digits || null;
  }
  if (data.description !== undefined) out.description = data.description?.trim() || null;
  return out;
}

function duplicate(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('Já existe uma empresa com esse nome.');
  throw err;
}

@Module({ imports: [AuthModule, BillingModule], controllers: [CompaniesController, AdminCompaniesController], providers: [CompaniesService] })
export class CompaniesModule {}
