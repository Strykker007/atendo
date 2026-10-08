import { BadRequestException, Body, Controller, Get, Logger, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
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
import { DuesService } from '../billing/dues.service';
import { freePeriod } from '../billing/plan-rules';
import { SYSTEM_PROFILES, TYPING_SPEED_KEYS, countLimit, type PlanLimits, type TypingSpeed } from '@atendo/shared';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantTemplatesController } from './tenant-templates.controller';
import { provisionedLossReasons, type TemplateContent } from './tenant-template';

class CreateTenantDto {
  @IsString() @MaxLength(80) name: string;
  @Matches(/^[a-z0-9-]{3,40}$/) slug: string;
  @IsUUID() planId: string;
  @IsEmail() adminEmail: string;
  @IsString() @MaxLength(80) adminName: string;
  /** Sem senha = o admin recebe convite por e-mail para definir a dele */
  @IsOptional() @IsString() @MinLength(8) adminPassword?: string;
  /**
   * Modelo de perfil (Farmácia, Clínica…). Ausente = o modelo marcado como padrão (se houver);
   * `null` = nenhum: só os três perfis do catálogo.
   */
  @IsOptional() @IsUUID() templateId?: string | null;
}
/** Dados cadastrais. String vazia limpa o campo. */
class TenantProfileDto {
  @IsOptional() @IsString() @MaxLength(150) legalName?: string;
  /** CPF (11) ou CNPJ (14) — pontuação é removida antes de validar */
  @IsOptional() @IsString() @MaxLength(20) document?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(120) billingEmail?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(10) zipCode?: string;
  @IsOptional() @IsString() @MaxLength(150) street?: string;
  @IsOptional() @IsString() @MaxLength(20) addressNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) complement?: string;
  @IsOptional() @IsString() @MaxLength(80) district?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(2) state?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
class UpdateTenantDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(['trialing', 'active', 'past_due', 'suspended', 'canceled']) subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
  /** vencimento do plano (`AAAA-MM-DD`). Só para assinatura sem gateway: no Stripe/Asaas quem manda é o gateway */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) currentPeriodEnd?: string;
  @IsOptional() @ValidateNested() @Type(() => TenantProfileDto) profile?: TenantProfileDto;
  /** INDIVIDUAL = preço cheio do plano; CONSOLIDATED_GROUP = plano × empresas ativas (docs/empresas.md#cobrança) */
  @IsOptional() @IsIn(['INDIVIDUAL', 'CONSOLIDATED_GROUP']) billingType?: 'INDIVIDUAL' | 'CONSOLIDATED_GROUP';
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
  /** E-mail é o login (único na plataforma): trocar encerra as sessões da pessoa. */
  @IsOptional() @IsEmail() @MaxLength(120) email?: string;
  /** Só entre atendente e gerente, e só o admin da conta muda; admin não é promovido por aqui. */
  @IsOptional() @IsIn(['agent', 'manager']) role?: 'agent' | 'manager';
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Perfil de acesso; string vazia desvincula e volta ao padrão do papel. */
  @IsOptional() @IsString() profileId?: string;
  /** Números que a pessoa opera. Lista vazia = todos (ver number-scope.ts). */
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) numberIds?: string[];
  /** Redefinir senha do atendente */
  @IsOptional() @IsString() @MinLength(8) password?: string;
  /** Velocidade do "digitando…" simulado das mensagens que ele não digitou (TYPING_SPEEDS) */
  @IsOptional() @IsIn(TYPING_SPEED_KEYS) typingSpeed?: TypingSpeed;
}

const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** Normaliza os dados cadastrais: vazio vira null, documento/telefone/CEP só dígitos, UF maiúscula. */
function cleanProfile(p: TenantProfileDto) {
  const out: Record<string, string | null> = {};
  for (const [k, raw] of Object.entries(p) as [keyof TenantProfileDto, string | undefined][]) {
    if (raw === undefined) continue;
    const v = raw.trim();
    out[k] = v === '' ? null : k === 'document' || k === 'phone' || k === 'zipCode' ? onlyDigits(v) : k === 'state' ? v.toUpperCase() : v;
  }
  if (out.document && out.document.length !== 11 && out.document.length !== 14) throw new BadRequestException('CPF deve ter 11 dígitos e CNPJ, 14.');
  if (out.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.billingEmail)) throw new BadRequestException('E-mail financeiro inválido.');
  if (out.state && !/^[A-Z]{2}$/.test(out.state)) throw new BadRequestException('UF deve ter duas letras.');
  return out;
}

/** Gestão de clientes (super_admin) e de atendentes (tenant_admin). */
@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
class TenantsController {
  private readonly log = new Logger('Tenants');
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly permissions: PermissionsService,
    private readonly stripe: StripeService,
    private readonly dues: DuesService,
    private readonly provisioning: TenantProvisioningService,
  ) {}

  @Get()
  @NoTenantOk()
  @Roles('super_admin')
  list() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { subscription: { include: { plan: { select: { id: true, name: true, priceMonth: true, isFree: true, billingCycle: true, durationDays: true } } } }, users: { where: { role: 'tenant_admin' }, select: { email: true, name: true }, take: 1 },
        // plano de cada empresa na própria listagem: com assinatura própria, o plano do cliente não diz tudo
        companies: { orderBy: { name: 'asc' }, select: { id: true, name: true, billingType: true, isActive: true, subscription: { select: { planId: true, status: true, currentPeriodEnd: true, priceMonth: true, plan: { select: { name: true } } } } } },
        _count: { select: { numbers: true, users: true, conversations: true } } },
    });
  }

  /** Dono ajusta plano/status manualmente (sem passar pelo Stripe) ou ativa/desativa o cliente. */
  @Patch(':id')
  @NoTenantOk()
  @Roles('super_admin')
  async updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    const perfil = dto.profile ? cleanProfile(dto.profile) : {};
    if (dto.name !== undefined || dto.isActive !== undefined || dto.profile) await this.prisma.tenant.update({ where: { id }, data: { name: dto.name, isActive: dto.isActive, ...perfil } });
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId: id }, select: { planId: true, gateway: true } });
    // troca de plano (inclusive para um gratuito, que cancela a cobrança no Stripe) — ver assignPlan
    if (dto.planId && dto.planId !== sub?.planId) await this.stripe.assignPlan(id, dto.planId, dto.subscriptionStatus);
    else if (dto.subscriptionStatus && sub) await this.prisma.subscription.update({ where: { tenantId: id }, data: { status: dto.subscriptionStatus, graceUntil: null } });
    // depois da troca de plano: assignPlan recalcula o período, e a data escolhida tem de prevalecer
    if (dto.currentPeriodEnd) {
      if (!sub) throw new BadRequestException('Cliente sem assinatura.');
      // o webhook do gateway sobrescreveria a data na próxima cobrança
      if (sub.gateway) throw new BadRequestException(`O vencimento desta assinatura é controlado pelo ${sub.gateway === 'stripe' ? 'Stripe' : 'Asaas'}.`);
      // fim do dia no horário de Brasília: "vence dia 10" vale o dia 10 inteiro
      await this.prisma.subscription.update({ where: { tenantId: id }, data: { currentPeriodEnd: new Date(`${dto.currentPeriodEnd}T23:59:59-03:00`) } });
    }
    if (dto.billingType) {
      // no Stripe o valor é o price do plano (sem quantidade): o grupo cobraria uma unidade só
      const live = await this.prisma.subscription.findUnique({ where: { tenantId: id }, select: { gateway: true, externalId: true, status: true } });
      if (dto.billingType === 'CONSOLIDATED_GROUP' && live?.gateway === 'stripe' && live.externalId && live.status !== 'canceled') {
        throw new BadRequestException('Cobrança por grupo não funciona com assinatura no Stripe. Migre o cliente para o Asaas ou para uma assinatura sem gateway.');
      }
      await this.prisma.tenant.update({ where: { id }, data: { billingType: dto.billingType } });
      await this.dues.syncGroupUnits(id);
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

  /**
   * Cliente novo, num passo só: cliente, assinatura, configuração, perfis (Administrador,
   * Gerente, Atendente + extras do modelo), respostas, fluxos e o admin — **na mesma transação**.
   * Antes um e-mail de admin repetido deixava um cliente órfão sem ninguém para entrar.
   * O convite por e-mail sai só depois do commit: e-mail não volta atrás.
   */
  @Post()
  @NoTenantOk()
  @Roles('super_admin')
  async create(@Body() dto: CreateTenantDto) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: dto.planId } });
    const template = dto.templateId
      ? await this.prisma.tenantTemplate.findUnique({ where: { id: dto.templateId } })
      : dto.templateId === undefined ? await this.prisma.tenantTemplate.findFirst({ where: { isDefault: true } }) : null;
    if (dto.templateId && !template) throw new BadRequestException('Modelo de perfil não encontrado.');
    const content = template ? (template.content as unknown as TemplateContent) : null;
    // tudo ou nada também no limite do plano: cliente nascendo acima do limite já começa travado
    const maxReplies = countLimit(plan.limits as unknown as PlanLimits, 'maxQuickReplies');
    if (content && maxReplies !== null && content.quickReplies.length > maxReplies) {
      throw new BadRequestException(`O modelo "${template!.name}" tem ${content.quickReplies.length} respostas rápidas e o plano ${plan.name} permite ${maxReplies}.`);
    }
    if (await this.prisma.user.count({ where: { email: dto.adminEmail } })) throw new BadRequestException('Este e-mail já está em uso.');
    // gratuito nasce ativo, sem cartão, e com o fim da degustação (se houver) como fim do período;
    // pago segue como antes: `trialing` até o primeiro checkout
    const { start, end } = freePeriod(plan.isFree ? plan.durationDays : null);
    // hash fora da transação: é lento de propósito, e a transação segura locks enquanto espera
    const passwordHash = await this.auth.hashPassword(dto.adminPassword ?? randomBytes(24).toString('base64url'));
    const { tenant, admin } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          templateId: template?.id ?? null,
          subscription: { create: { planId: dto.planId, status: plan.isFree ? 'active' : 'trialing', currentPeriodStart: start, currentPeriodEnd: end, ...(plan.isFree && { priceMonth: 0 }) } },
        },
        include: { subscription: true },
      });
      // gravado aqui e não no `@default` do schema: a configuração nasce no primeiro acesso, e mudar
      // o default trocaria a lista de clientes antigos que ainda não abriram a configuração
      await tx.tenantSettings.create({ data: { tenantId: tenant.id, lossReasons: provisionedLossReasons(content) } });
      await this.provisioning.provision(tx, tenant.id, content);
      const adminProfile = await tx.accessProfile.findFirstOrThrow({ where: { tenantId: tenant.id, isSystem: true, name: SYSTEM_PROFILES.find((p) => p.role === 'tenant_admin')!.name }, select: { id: true } });
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id, email: dto.adminEmail, name: dto.adminName, role: 'tenant_admin', passwordHash,
          profileId: template ? adminProfile.id : null,
          ...(dto.adminPassword ? { passwordSetAt: new Date() } : { invitedAt: new Date() }),
        },
      });
      return { tenant, admin };
    }, { timeout: 30_000 });
    if (!dto.adminPassword) {
      // o e-mail é melhor esforço: sem provedor configurado, o dono usa o link copiável da equipe
      await this.auth.sendInvite(admin.id, 'Equipe Atendo', tenant.name).catch((err) => this.log.warn(`Convite por e-mail não enviado para ${dto.adminEmail}: ${err instanceof Error ? err.message : err}`));
    }
    return tenant;
  }

  /** Todos podem listar (precisam para transferir); só admin gerencia. */
  @Get('me/agents')
  agents(@CurrentUser() u: AuthUser) {
    return this.prisma.user.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true, email: true, role: true, isActive: true, typingSpeed: true, lastLoginAt: true, invitedAt: true, passwordSetAt: true, profile: { select: { id: true, name: true } }, numbers: { select: { numberId: true } }, departments: { select: { departmentId: true } } } });
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
      await this.provisioning.linkRoleProfile(u.tenantId, user.id, role);
      // devolve o link mesmo quando o e-mail saiu: e-mail cai em spam e some
      const invite = link ?? (await this.auth.inviteLink(user.id)).link;
      return { id: user.id, name: user.name, email: user.email, role: user.role, invited: true, inviteLink: invite, emailSent: !!link };
    }
    const created = await this.prisma.user.create({
      data: { tenantId: u.tenantId, email: dto.email, name: dto.name, role, passwordHash: await this.auth.hashPassword(dto.password), passwordSetAt: new Date() },
      select: { id: true, name: true, email: true, role: true },
    });
    await this.provisioning.linkRoleProfile(u.tenantId, created.id, role);
    return created;
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
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('Informe o nome.');
    if (dto.name !== undefined) rest.name = dto.name.trim();
    // gerente não promove ninguém a gerente (mesma regra do convite)
    if (dto.role !== undefined && u.role === 'manager') throw new BadRequestException('Só o admin da conta muda o papel.');
    if (dto.email !== undefined) {
      rest.email = dto.email.trim();
      const taken = await this.prisma.user.count({ where: { email: rest.email, id: { not: id } } });
      if (taken) throw new BadRequestException('Este e-mail já está em uso.');
    }
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
    // gerente não altera admins nem outros gerentes. Só a velocidade de digitação vale para qualquer
    // um da equipe (admin também atende) — não dá acesso nem tira de ninguém. O nome, o admin da
    // conta edita de qualquer pessoa (inclusive de outro admin): é só rótulo, não muda acesso
    const only = (keys: string[]) => Object.entries(dto).every(([k, v]) => keys.includes(k) || v === undefined);
    const editable = only(['typingSpeed'])
      ? (['agent', 'manager', 'tenant_admin'] as const)
      : u.role === 'manager' ? (['agent'] as const)
      : u.role === 'tenant_admin' && only(['name', 'typingSpeed']) ? (['agent', 'manager', 'tenant_admin'] as const)
      : (['agent', 'manager'] as const);
    const updated = await this.prisma.user.update({ where: { id, tenantId: u.tenantId, role: { in: [...editable] } }, data, select: { id: true, name: true, email: true, role: true, isActive: true } });
    // revoga sessões ativas ao trocar senha, desativar, ou mudar login/papel (vão no token).
    // Depois do update: se a edição for recusada, ninguém é deslogado à toa
    if (password || dto.isActive === false || dto.email !== undefined || dto.role !== undefined) {
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    if (numberIds) {
      // só números deste cliente: os ids vêm do corpo da requisição
      const valid = await this.prisma.whatsAppNumber.findMany({ where: { id: { in: numberIds }, tenantId: u.tenantId, deletedAt: null }, select: { id: true } });
      await this.prisma.$transaction([
        this.prisma.userNumber.deleteMany({ where: { userId: id } }),
        this.prisma.userNumber.createMany({ data: valid.map((n) => ({ userId: id, numberId: n.id })), skipDuplicates: true }),
      ]);
    }
    // trocou o papel e continua num perfil padrão: acompanha o novo papel (perfil sob medida fica)
    if (dto.role !== undefined && profileId === undefined) {
      const cur = await this.prisma.user.findUnique({ where: { id }, select: { profile: { select: { isSystem: true } } } });
      if (cur?.profile?.isSystem) await this.provisioning.linkRoleProfile(u.tenantId, id, dto.role);
    }
    if (profileId !== undefined || numberIds || dto.role !== undefined) this.permissions.invalidate();
    return updated;
  }
}

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [TenantsController, TenantSettingsController, ProfilesController, TenantTemplatesController],
  providers: [TenantSettingsService, SchedulesService, TenantProvisioningService],
  exports: [TenantSettingsService, SchedulesService],
})
export class TenantsModule {}
