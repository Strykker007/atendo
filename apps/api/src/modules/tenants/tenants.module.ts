import { Body, Controller, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BillingModule } from '../billing/billing.module';
import { PlanLimitGuard, RequireLimit } from '../billing/plan-limit.guard';

class CreateTenantDto {
  @IsString() @MaxLength(80) name: string;
  @Matches(/^[a-z0-9-]{3,40}$/) slug: string;
  @IsUUID() planId: string;
  @IsEmail() adminEmail: string;
  @IsString() @MaxLength(80) adminName: string;
  @IsString() @MinLength(8) adminPassword: string;
}
class UpdateTenantDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(['trialing', 'active', 'past_due', 'suspended', 'canceled']) subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
}
class CreateAgentDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(80) name: string;
  @IsString() @MinLength(8) password: string;
  /** agent (padrão) ou manager */
  @IsOptional() @IsIn(['agent', 'manager']) role?: 'agent' | 'manager';
}
class UpdateAgentDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Redefinir senha do atendente */
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

/** Gestão de clientes (super_admin) e de atendentes (tenant_admin). */
@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @NoTenantOk()
  @Roles('super_admin')
  list() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { subscription: { include: { plan: { select: { id: true, name: true, priceMonth: true } } } }, users: { where: { role: 'tenant_admin' }, select: { email: true, name: true }, take: 1 }, _count: { select: { numbers: true, users: true, conversations: true } } },
    });
  }

  /** Dono ajusta plano/status manualmente (sem passar pelo Stripe) ou ativa/desativa o cliente. */
  @Patch(':id')
  @NoTenantOk()
  @Roles('super_admin')
  async updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    if (dto.name !== undefined || dto.isActive !== undefined) await this.prisma.tenant.update({ where: { id }, data: { name: dto.name, isActive: dto.isActive } });
    if (dto.planId || dto.subscriptionStatus) {
      const now = new Date();
      const end = new Date(now);
      end.setMonth(end.getMonth() + 1);
      await this.prisma.subscription.upsert({
        where: { tenantId: id },
        create: { tenantId: id, planId: dto.planId!, status: dto.subscriptionStatus ?? 'active', currentPeriodStart: now, currentPeriodEnd: end },
        update: { ...(dto.planId && { planId: dto.planId }), ...(dto.subscriptionStatus && { status: dto.subscriptionStatus, graceUntil: null }) },
      });
    }
    return this.prisma.tenant.findUniqueOrThrow({ where: { id }, include: { subscription: { include: { plan: true } } } });
  }

  /** "Entrar como": o dono recebe um token com o tenant escolhido (papel admin). */
  @Post(':id/impersonate')
  @NoTenantOk()
  @Roles('super_admin')
  impersonate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.auth.impersonate(u, id);
  }

  @Post()
  @NoTenantOk()
  @Roles('super_admin')
  async create(@Body() dto: CreateTenantDto) {
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);
    return this.prisma.tenant.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        subscription: { create: { planId: dto.planId, status: 'trialing', currentPeriodStart: now, currentPeriodEnd: end } },
        users: { create: { email: dto.adminEmail, name: dto.adminName, role: 'tenant_admin', passwordHash: await this.auth.hashPassword(dto.adminPassword) } },
      },
      include: { subscription: true },
    });
  }

  /** Todos podem listar (precisam para transferir); só admin gerencia. */
  @Get('me/agents')
  agents(@CurrentUser() u: AuthUser) {
    return this.prisma.user.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true } });
  }

  @Post('me/agents')
  @Roles('tenant_admin', 'manager', 'super_admin')
  @UseGuards(PlanLimitGuard)
  @RequireLimit('maxAgents')
  async createAgent(@CurrentUser() u: AuthUser, @Body() dto: CreateAgentDto) {
    // gerente só cria atendentes; admin cria atendentes e gerentes
    const role = dto.role === 'manager' && u.role !== 'manager' ? 'manager' : 'agent';
    return this.prisma.user.create({
      data: { tenantId: u.tenantId, email: dto.email, name: dto.name, role, passwordHash: await this.auth.hashPassword(dto.password) },
      select: { id: true, name: true, email: true, role: true },
    });
  }

  @Patch('me/agents/:id')
  @Roles('tenant_admin', 'manager', 'super_admin')
  async updateAgent(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    const { password, ...rest } = dto;
    const data = password ? { ...rest, passwordHash: await this.auth.hashPassword(password) } : rest;
    // revoga sessões ativas ao trocar senha ou desativar
    if (password || dto.isActive === false) {
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    // gerente não altera admins nem outros gerentes
    const editable = u.role === 'manager' ? (['agent'] as const) : (['agent', 'manager'] as const);
    return this.prisma.user.update({ where: { id, tenantId: u.tenantId, role: { in: [...editable] } }, data, select: { id: true, name: true, isActive: true } });
  }
}

@Module({ imports: [AuthModule, BillingModule], controllers: [TenantsController] })
export class TenantsModule {}
