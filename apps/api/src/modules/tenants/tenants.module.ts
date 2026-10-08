import { BadRequestException, Body, Controller, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { ProfilesController } from './profiles.controller';
import { NoTenantOk } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BillingModule } from '../billing/billing.module';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettingsController } from './tenant-settings.controller';
import { SchedulesService } from './schedules.service';
import { PlanLimitGuard, RequireLimit } from '../billing/plan-limit.guard';
import { StripeService } from '../billing/stripe.service';
import { freePeriod } from '../billing/plan-rules';
import { seedDefaultFlows } from './default-flows';

class CreateTenantDto {
  @IsString() @MaxLength(80) name: string;
  @Matches(/^[a-z0-9-]{3,40}$/) slug: string;
  @IsUUID() planId: string;
  @IsEmail() adminEmail: string;
  @IsString() @MaxLength(80) adminName: string;
  /** Sem senha = o admin recebe convite por e-mail para definir a dele */
  @IsOptional() @IsString() @MinLength(8) adminPassword?: string;
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
  /** Opcional: com senha = cria direto (modo antigo); sem senha = manda convite por e-mail */
  @IsOptional() @IsString() @MinLength(8) password?: string;
  /** agent (padrão) ou manager */
  @IsOptional() @IsIn(['agent', 'manager']) role?: 'agent' | 'manager';
}
class UpdateAgentDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Perfil de acesso; string vazia desvincula e volta ao padrão do papel. */
  @IsOptional() @IsString() profileId?: string;
  /** Números que a pessoa opera. Lista vazia = todos (ver number-scope.ts). */
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) numberIds?: string[];
  /** Redefinir senha do atendente */
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

/** Gestão de clientes (super_admin) e de atendentes (tenant_admin). */
@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly permissions: PermissionsService,
    private readonly stripe: StripeService,
  ) {}

  @Get()
  @NoTenantOk()
  @Roles('super_admin')
  list() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { subscription: { include: { plan: { select: { id: true, name: true, priceMonth: true, isFree: true, billingCycle: true, durationDays: true } } } }, users: { where: { role: 'tenant_admin' }, select: { email: true, name: true }, take: 1 }, _count: { select: { numbers: true, users: true, conversations: true } } },
    });
  }

  /** Dono ajusta plano/status manualmente (sem passar pelo Stripe) ou ativa/desativa o cliente. */
  @Patch(':id')
  @NoTenantOk()
  @Roles('super_admin')
  async updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    if (dto.name !== undefined || dto.isActive !== undefined) await this.prisma.tenant.update({ where: { id }, data: { name: dto.name, isActive: dto.isActive } });
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId: id }, select: { planId: true } });
    // troca de plano (inclusive para um gratuito, que cancela a cobrança no Stripe) — ver assignPlan
    if (dto.planId && dto.planId !== sub?.planId) await this.stripe.assignPlan(id, dto.planId, dto.subscriptionStatus);
    else if (dto.subscriptionStatus && sub) await this.prisma.subscription.update({ where: { tenantId: id }, data: { status: dto.subscriptionStatus, graceUntil: null } });
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
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: dto.planId } });
    // gratuito nasce ativo, sem cartão, e com o fim da degustação (se houver) como fim do período;
    // pago segue como antes: `trialing` até o primeiro checkout
    const { start, end } = freePeriod(plan.isFree ? plan.durationDays : null);
    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        subscription: { create: { planId: dto.planId, status: plan.isFree ? 'active' : 'trialing', currentPeriodStart: start, currentPeriodEnd: end, ...(plan.isFree && { priceMonth: 0 }) } },
      },
      include: { subscription: true },
    });
    await seedDefaultFlows(this.prisma, tenant.id);
    if (dto.adminPassword) {
      await this.prisma.user.create({ data: { tenantId: tenant.id, email: dto.adminEmail, name: dto.adminName, role: 'tenant_admin', passwordHash: await this.auth.hashPassword(dto.adminPassword), passwordSetAt: new Date() } });
    } else {
      await this.auth.invite({ name: 'Equipe Atendo', tenantId: tenant.id }, { email: dto.adminEmail, name: dto.adminName, role: 'tenant_admin' }, tenant.name);
    }
    return tenant;
  }

  /** Todos podem listar (precisam para transferir); só admin gerencia. */
  @Get('me/agents')
  agents(@CurrentUser() u: AuthUser) {
    return this.prisma.user.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, invitedAt: true, passwordSetAt: true, profile: { select: { id: true, name: true } }, numbers: { select: { numberId: true } }, departments: { select: { departmentId: true } } } });
  }

  @Post('me/agents')
  @RequirePermission('team.manage')
  @UseGuards(PlanLimitGuard)
  @RequireLimit('maxAgents')
  async createAgent(@CurrentUser() u: AuthUser, @Body() dto: CreateAgentDto) {
    // gerente só cria atendentes; admin cria atendentes e gerentes
    const role = dto.role === 'manager' && u.role !== 'manager' ? 'manager' : 'agent';
    if (!dto.password) {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
      const { user, link } = await this.auth.invite({ name: u.name, tenantId: u.tenantId }, { email: dto.email, name: dto.name, role }, tenant.name);
      // devolve o link mesmo quando o e-mail saiu: e-mail cai em spam e some
      const invite = link ?? (await this.auth.inviteLink(user.id)).link;
      return { id: user.id, name: user.name, email: user.email, role: user.role, invited: true, inviteLink: invite, emailSent: !!link };
    }
    return this.prisma.user.create({
      data: { tenantId: u.tenantId, email: dto.email, name: dto.name, role, passwordHash: await this.auth.hashPassword(dto.password), passwordSetAt: new Date() },
      select: { id: true, name: true, email: true, role: true },
    });
  }

  /** Reenvia o convite (usuário que ainda não definiu senha). */
  @Post('me/agents/:id/resend-invite')
  @RequirePermission('team.manage')
  async resendInvite(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const [target, tenant] = await Promise.all([
      this.prisma.user.findFirstOrThrow({ where: { id, tenantId: u.tenantId } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } }),
    ]);
    const link = await this.auth.sendInvite(target.id, u.name, tenant.name).catch(() => null);
    return { ok: true, emailSent: !!link, inviteLink: link ?? (await this.auth.inviteLink(target.id)).link };
  }

  /**
   * Link de convite para o admin mandar pelo canal que quiser (WhatsApp, por exemplo).
   * Gerar um novo invalida o anterior.
   */
  @Post('me/agents/:id/invite-link')
  @RequirePermission('team.manage')
  async inviteLink(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const target = await this.prisma.user.findFirstOrThrow({ where: { id, tenantId: u.tenantId }, select: { id: true, passwordSetAt: true } });
    if (target.passwordSetAt) throw new BadRequestException('Este usuário já definiu a senha. Para trocar, use "Redefinir senha".');
    return this.auth.inviteLink(target.id);
  }

  @Patch('me/agents/:id')
  @RequirePermission('team.manage')
  async updateAgent(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    const { password, profileId, numberIds, ...rest } = dto;
    // `passwordSetAt` é o que libera o login de quem foi convidado: sem isto, definir a
    // senha pelo painel não adiantava nada e o usuário continuava travado no convite
    const base = profileId === undefined ? rest : { ...rest, profileId: profileId || null };
    if (profileId) {
      // perfil de outro cliente não entra: o id vem do corpo da requisição
      const ok = await this.prisma.accessProfile.count({ where: { id: profileId, tenantId: u.tenantId } });
      if (!ok) throw new BadRequestException('Perfil de acesso não encontrado.');
    }
    const data = password
      ? { ...base, passwordHash: await this.auth.hashPassword(password), passwordSetAt: new Date() }
      : base;
    // revoga sessões ativas ao trocar senha ou desativar
    if (password || dto.isActive === false) {
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    // gerente não altera admins nem outros gerentes
    const editable = u.role === 'manager' ? (['agent'] as const) : (['agent', 'manager'] as const);
    const updated = await this.prisma.user.update({ where: { id, tenantId: u.tenantId, role: { in: [...editable] } }, data, select: { id: true, name: true, isActive: true } });

    if (numberIds) {
      // só números deste cliente: os ids vêm do corpo da requisição
      const valid = await this.prisma.whatsAppNumber.findMany({ where: { id: { in: numberIds }, tenantId: u.tenantId, deletedAt: null }, select: { id: true } });
      await this.prisma.$transaction([
        this.prisma.userNumber.deleteMany({ where: { userId: id } }),
        this.prisma.userNumber.createMany({ data: valid.map((n) => ({ userId: id, numberId: n.id })), skipDuplicates: true }),
      ]);
    }
    if (profileId !== undefined || numberIds) this.permissions.invalidate();
    return updated;
  }
}

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [TenantsController, TenantSettingsController, ProfilesController],
  providers: [TenantSettingsService, SchedulesService],
  exports: [TenantSettingsService, SchedulesService],
})
export class TenantsModule {}
