import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
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
import { UsageService } from '../billing/usage.service';
import { DuesService } from '../billing/dues.service';
import { nextPeriodEnd } from '../billing/dues';

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

/** Cobrança da empresa (docs/empresas.md#cobrança). Só o dono mexe. */
class CompanyBillingDto {
  /** CONSOLIDATED_GROUP = herda a assinatura do cliente; INDIVIDUAL = assinatura própria */
  @IsIn(['INDIVIDUAL', 'CONSOLIDATED_GROUP']) billingType: 'INDIVIDUAL' | 'CONSOLIDATED_GROUP';
  /** ativa para cobrança: inativa não entra na conta do grupo nem gera vencimento */
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** plano da assinatura própria; obrigatório na primeira vez em INDIVIDUAL */
  @IsOptional() @IsUUID() planId?: string;
  /** preço contratado (equivalente mensal); null = o do plano */
  @IsOptional() @IsNumber() @Min(0) @Max(99_999) priceMonth?: number | null;
  /** próximo vencimento, `AAAA-MM-DD` */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) currentPeriodEnd?: string;
  @IsOptional() @IsIn(['trialing', 'active', 'past_due', 'suspended', 'canceled']) status?: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
}

const SELECT = {
  id: true, name: true, cnpj: true, description: true, createdAt: true, billingType: true, isActive: true,
  subscription: { select: { planId: true, status: true, currentPeriodEnd: true, priceMonth: true, plan: { select: { name: true } } } },
  numbers: { where: { deletedAt: null }, select: { id: true, label: true, phone: true, color: true }, orderBy: { createdAt: 'asc' } },
  users: { select: { user: { select: { id: true, name: true, isActive: true } } } },
} satisfies Prisma.CompanySelect;

/**
 * Regras de empresas/unidades por cliente (docs/empresas.md). Usado pela tela do cliente
 * (`/companies`, tenant do token) e pela do dono (`/admin/tenants/:tenantId/companies`).
 */
@Injectable()
class CompaniesService {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService, private readonly dues: DuesService) {}

  list(tenantId: string) {
    return this.prisma.company.findMany({ where: { tenantId, deletedAt: null }, orderBy: { name: 'asc' }, select: SELECT });
  }

  async create(tenantId: string, dto: CompanyDto) {
    const { numberIds, userIds, ...data } = dto;
    const company = await this.prisma.company.create({ data: { tenantId, ...clean(data) } as Prisma.CompanyUncheckedCreateInput }).catch(duplicate);
    await this.setLinks(tenantId, company.id, numberIds, userIds);
    // empresa nova herda a assinatura: no grupo consolidado o valor sobe uma unidade
    await this.dues.syncGroupUnits(tenantId);
    return this.prisma.company.findUniqueOrThrow({ where: { id: company.id }, select: SELECT });
  }

  async update(tenantId: string, id: string, dto: Partial<CompanyDto>) {
    const { numberIds, userIds, ...data } = dto;
    await this.prisma.company.findFirstOrThrow({ where: { id, tenantId, deletedAt: null }, select: { id: true } });
    await this.prisma.company.update({ where: { id, tenantId }, data: clean(data) }).catch(duplicate);
    await this.setLinks(tenantId, id, numberIds, userIds);
    return this.prisma.company.findUniqueOrThrow({ where: { id }, select: SELECT });
  }

  /**
   * Remover não apaga (docs/empresas.md#remover): a empresa some do painel, do seletor e da
   * cobrança, mas fica para os relatórios. Os números **ativos** ficam sem empresa e seguem
   * operando, levando o próprio histórico; os já **excluídos** continuam apontando para ela, e é
   * esse histórico que o relatório mostra como "<nome> · removida em dd/mm/aaaa". O sufixo no nome
   * libera o nome para uma empresa nova (`@@unique([tenantId, name])`).
   */
  async remove(tenantId: string, id: string) {
    const atual = await this.prisma.company.findFirstOrThrow({ where: { id, tenantId, deletedAt: null }, select: { name: true } });
    const quando = new Date();
    const sufixo = ` · removida em ${quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    const company = await this.prisma.$transaction(async (tx) => {
      await tx.whatsAppNumber.updateMany({ where: { tenantId, companyId: id, deletedAt: null }, data: { companyId: null } });
      await tx.userCompany.deleteMany({ where: { companyId: id } });
      // mesma empresa removida duas vezes no dia (recriada e removida de novo): desempata pelo id
      const livre = !(await tx.company.findFirst({ where: { tenantId, name: atual.name + sufixo }, select: { id: true } }));
      return tx.company.update({ where: { id }, data: { deletedAt: quando, isActive: false, name: (atual.name + sufixo + (livre ? '' : ` (${id.slice(0, 4)})`)).slice(0, 200) } });
    });
    this.permissions.invalidate();
    await this.dues.syncGroupUnits(tenantId);
    return company;
  }

  /**
   * Modo de cobrança da empresa. INDIVIDUAL cria/atualiza a assinatura própria; voltar para o
   * grupo mantém a linha antiga (histórico) mas ela deixa de valer. Recalcula o grupo no fim.
   */
  async setBilling(tenantId: string, id: string, dto: CompanyBillingDto) {
    const company = await this.prisma.company.findFirstOrThrow({ where: { id, tenantId, deletedAt: null }, select: { id: true, subscription: true } });
    await this.prisma.company.update({ where: { id }, data: { billingType: dto.billingType, ...(dto.isActive !== undefined && { isActive: dto.isActive }) } });
    if (dto.billingType === 'INDIVIDUAL') {
      const end = dto.currentPeriodEnd ? new Date(`${dto.currentPeriodEnd}T23:59:59-03:00`) : undefined;
      const fields = {
        ...(dto.planId && { planId: dto.planId }),
        ...(dto.priceMonth !== undefined && { priceMonth: dto.priceMonth }),
        ...(end && { currentPeriodEnd: end }),
        ...(dto.status && { status: dto.status, canceledAt: dto.status === 'canceled' ? new Date() : null }),
      };
      if (company.subscription) {
        await this.prisma.companySubscription.update({ where: { companyId: id }, data: fields });
      } else {
        if (!dto.planId) throw new BadRequestException('Escolha o plano da assinatura própria da empresa.');
        const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: dto.planId } });
        const now = new Date();
        await this.prisma.companySubscription.create({
          data: { tenantId, companyId: id, planId: plan.id, status: dto.status ?? 'active', currentPeriodStart: now, currentPeriodEnd: end ?? nextPeriodEnd(now, plan.billingCycle === 'yearly' ? 'yearly' : 'monthly'), priceMonth: dto.priceMonth ?? null },
        });
      }
    }
    await this.dues.syncGroupUnits(tenantId);
    return this.prisma.company.findUniqueOrThrow({ where: { id }, select: SELECT });
  }

  /** Só números e usuários deste cliente: os ids vêm do corpo da requisição. */
  private async setLinks(tenantId: string, companyId: string, numberIds?: string[], userIds?: string[]) {
    if (numberIds) {
      const ids = [...new Set(numberIds)];
      const valid = await this.prisma.whatsAppNumber.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, select: { id: true } });
      if (valid.length !== ids.length) throw new BadRequestException('Algum número não foi encontrado nesta conta.');
      await this.prisma.$transaction([
        // número excluído fica com a empresa: é o histórico dela nos relatórios (docs/empresas.md#remover)
        this.prisma.whatsAppNumber.updateMany({ where: { tenantId, companyId, deletedAt: null, id: { notIn: ids } }, data: { companyId: null } }),
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
    return this.prisma.company.findMany({ where: { tenantId: u.tenantId, id: { in: u.companyIds }, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
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
  constructor(private readonly prisma: PrismaService, private readonly companies: CompaniesService, private readonly usage: UsageService) {}

  @Get()
  async list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true } });
    return this.companies.list(tenantId);
  }

  /** O que o formulário precisa do cliente: números, equipe e o limite do plano. */
  @Get('options')
  async options(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    const [numbers, users, plan] = await Promise.all([
      this.prisma.whatsAppNumber.findMany({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, label: true, phone: true } }),
      this.prisma.user.findMany({ where: { tenantId, role: { not: 'super_admin' } }, orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true } }),
      // limite efetivo: com a personalização do dono por cima do plano
      this.usage.limits(tenantId),
    ]);
    return { numbers, users, maxCompanies: plan?.limits.maxCompanies ?? null };
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

  /** Assinatura própria ou herdada do grupo (docs/empresas.md#cobrança). */
  @Put(':id/billing')
  billing(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id') id: string, @Body() dto: CompanyBillingDto) {
    return this.companies.setBilling(tenantId, id, dto);
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
