import { Body, Controller, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
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
class CreateAgentDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(80) name: string;
  @IsString() @MinLength(8) password: string;
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
  @Roles('super_admin')
  list() {
    return this.prisma.tenant.findMany({ include: { subscription: { include: { plan: true } }, _count: { select: { numbers: true, users: true } } } });
  }

  @Post()
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

  @Get('me/agents')
  @Roles('tenant_admin', 'super_admin')
  agents(@CurrentUser() u: AuthUser) {
    return this.prisma.user.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true } });
  }

  @Post('me/agents')
  @Roles('tenant_admin', 'super_admin')
  @UseGuards(PlanLimitGuard)
  @RequireLimit('maxAgents')
  async createAgent(@CurrentUser() u: AuthUser, @Body() dto: CreateAgentDto) {
    return this.prisma.user.create({
      data: { tenantId: u.tenantId, email: dto.email, name: dto.name, role: 'agent', passwordHash: await this.auth.hashPassword(dto.password) },
      select: { id: true, name: true, email: true, role: true },
    });
  }

  @Patch('me/agents/:id')
  @Roles('tenant_admin', 'super_admin')
  updateAgent(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: { name?: string; isActive?: boolean }) {
    return this.prisma.user.update({ where: { id, tenantId: u.tenantId, role: 'agent' }, data: dto, select: { id: true, name: true, isActive: true } });
  }
}

@Module({ imports: [AuthModule, BillingModule], controllers: [TenantsController] })
export class TenantsModule {}
