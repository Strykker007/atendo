import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
 * Empresas/unidades do cliente (docs/empresas.md). Cadastrar, renomear e decidir quais números
 * e quais pessoas pertencem a cada uma é configuração da conta (`settings.manage`); a listagem
 * do seletor (`/companies/mine`) é de todo mundo. Quantas empresas cabem vem do plano
 * (`PlanLimits.maxCompanies`).
 */
@Controller('companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class CompaniesController {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.company.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' }, select: SELECT });
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
  async create(@CurrentUser() u: AuthUser, @Body() dto: CompanyDto) {
    const { numberIds, userIds, ...data } = dto;
    const company = await this.prisma.company.create({ data: { tenantId: u.tenantId, ...clean(data) } as Prisma.CompanyUncheckedCreateInput }).catch(duplicate);
    await this.setLinks(u.tenantId, company.id, numberIds, userIds);
    return this.prisma.company.findUniqueOrThrow({ where: { id: company.id }, select: SELECT });
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<CompanyDto>) {
    const { numberIds, userIds, ...data } = dto;
    await this.prisma.company.findFirstOrThrow({ where: { id, tenantId: u.tenantId }, select: { id: true } });
    await this.prisma.company.update({ where: { id, tenantId: u.tenantId }, data: clean(data) }).catch(duplicate);
    await this.setLinks(u.tenantId, id, numberIds, userIds);
    return this.prisma.company.findUniqueOrThrow({ where: { id }, select: SELECT });
  }

  /** Os números da empresa ficam sem empresa; conversas e histórico não mudam. */
  @Delete(':id')
  @RequirePermission('settings.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const company = await this.prisma.company.delete({ where: { id, tenantId: u.tenantId } });
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

@Module({ imports: [AuthModule, BillingModule], controllers: [CompaniesController] })
export class CompaniesModule {}
