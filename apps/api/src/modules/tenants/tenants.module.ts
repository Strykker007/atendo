import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, Module, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { ShiftAccessService } from '../auth/shift-access.service';
import { ProfilesController } from './profiles.controller';
import { NoTenantOk } from '../auth/tenant.guard';
import { creatorCompanyIds, teamCompanyIds, teamWhere } from '../auth/team-scope';
import { canUseNumber } from '../auth/number-scope';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BillingModule } from '../billing/billing.module';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettingsController } from './tenant-settings.controller';
import { SchedulesService } from './schedules.service';
import { PlanLimitGuard, RequireLimit } from '../billing/plan-limit.guard';
import { StripeService } from '../billing/stripe.service';
import { DuesService } from '../billing/dues.service';
import { PromotionsService } from '../billing/promotions.service';
import { DiscountLedgerService } from '../billing/discount-ledger.service';
import { UsageService } from '../billing/usage.service';
import { freePeriod } from '../billing/plan-rules';
import { TYPING_SPEED_KEYS, countLimit, type Permission, type PlanLimits, type TypingSpeed } from '@atendo/shared';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantTemplatesController } from './tenant-templates.controller';
import { SystemOwnersController } from './system-owners.controller';
import { provisionedTags, templateTagConflictPairs, type TemplateContent } from './tenant-template';
import { TemplateRolloutService } from './template-rollout.service';
import { conflictPair } from '../tags/conflicts';
import { LOGIN_EMAIL_SELECT, loginEmail } from '../auth/login-email';

const VINCULO_SEM_CONVITE = 'Esta pessoa entra pelo login de outra empresa (vínculo): não tem convite.';

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
  /** Perfil escolhido para a pessoa. Ele decide as permissões; o papel técnico é derivado dele. */
  @IsOptional() @IsUUID() profileId?: string;
}
class BulkPersonDto {
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  /** perfil desta pessoa; ausente = o `profileId` do lote */
  @IsOptional() @IsUUID() profileId?: string;
}
/** Várias pessoas de uma vez, cada uma no seu perfil, sempre por convite (docs/18-perfis-de-acesso.md#cadastro-em-massa). */
class BulkAgentsDto {
  @IsOptional() @IsIn(['agent', 'manager']) role?: 'agent' | 'manager';
  @IsOptional() @IsUUID() profileId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => BulkPersonDto) people: BulkPersonDto[];
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
    private readonly promotions: PromotionsService,
    private readonly ledger: DiscountLedgerService,
    private readonly shift: ShiftAccessService,
    private readonly usage: UsageService,
  ) {}

  @Get()
  @NoTenantOk()
  @Roles('super_admin')
  async list() {
    const rows = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { subscription: { include: { plan: { select: { id: true, name: true, priceMonth: true, isFree: true, billingCycle: true, durationDays: true } } } },
        // personalização do plano (valor/limites negociados) — a coluna Plano mostra o selo
        planOverride: { select: { planId: true, priceMonth: true, expiresAt: true } },
        users: { where: { role: 'tenant_admin' }, select: { ...LOGIN_EMAIL_SELECT, name: true }, take: 1 },
        // plano de cada empresa na própria listagem: com assinatura própria, o plano do cliente não diz tudo
        companies: { where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, billingType: true, isActive: true, subscription: { select: { planId: true, status: true, currentPeriodEnd: true, priceMonth: true, plan: { select: { name: true } } } } } },
        _count: { select: { numbers: true, users: true, conversations: true } } },
    });
    // admin que é vínculo (docs/multiempresa.md) aparece com o login dele
    return rows.map((t) => ({ ...t, users: t.users.map((x) => ({ name: x.name, email: loginEmail(x) ?? '' })) }));
  }

  /** Dono ajusta plano/status manualmente (sem passar pelo Stripe) ou ativa/desativa o cliente. */
  @Patch(':id')
  @NoTenantOk()
  @Roles('super_admin')
  async updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    const perfil = dto.profile ? cleanProfile(dto.profile) : {};
    // ativar/desativar tem efeitos (sessões, números, cobrança): só pelas rotas próprias
    if (dto.isActive !== undefined) {
      const atual = await this.prisma.tenant.findUnique({ where: { id }, select: { isActive: true } });
      if (atual && atual.isActive !== dto.isActive) throw new BadRequestException(`Use POST /tenants/${id}/${dto.isActive ? 'reactivate' : 'deactivate'} (docs/desativar-cliente.md).`);
    }
    if (dto.name !== undefined || dto.profile) await this.prisma.tenant.update({ where: { id }, data: { name: dto.name, ...perfil } });
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
    // promoção de entrada aberta para o plano: o cliente já nasce com o desconto (docs/05#promoções)
    const promo = await this.promotions.quote(plan, null);
    // hash fora da transação: é lento de propósito, e a transação segura locks enquanto espera
    const passwordHash = await this.auth.hashPassword(dto.adminPassword ?? randomBytes(24).toString('base64url'));
    const { tenant, admin } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          templateId: template?.id ?? null,
          subscription: { create: { planId: dto.planId, status: plan.isFree ? 'active' : 'trialing', currentPeriodStart: start, currentPeriodEnd: end, ...(plan.isFree && { priceMonth: 0 }), ...(promo && { priceMonth: promo.priceMonth }) } },
          ...(promo && { planOverride: { create: this.promotions.overrideData(dto.planId, promo) } }),
        },
        include: { subscription: true },
      });
      // configurações de atendimento do modelo (encerramento sem venda, assinatura, nomes dos resultados)
      await tx.tenantSettings.create({ data: { tenantId: tenant.id, ...content?.settings } });
      // livro de descontos: nasceu com promoção (docs/05#livro-de-descontos)
      if (promo) await this.ledger.open({ tenantId: tenant.id, plan, priceMonth: promo.priceMonth, kind: 'promotion', source: 'tenant_create', promotion: promo.promotion, endsAt: promo.expiresAt }, tx);
      // tags do modelo, na ordem dele (é a das colunas do Kanban). As marcadas para o encerramento
      // (Comprou / Não comprou) viram MOTIVOS de encerramento — a lista própria, separada das tags
      // (docs/06-modelo-de-dados.md#encerramento); continuam tag só se também forem etapa do Kanban
      const modelo = provisionedTags(content);
      const deEncerramento = modelo.filter((t) => t.showOnWon || t.showOnLost);
      await tx.tag.createMany({ data: modelo.filter((t) => t.isKanban || !(t.showOnWon || t.showOnLost)).map((t, position) => ({ tenantId: tenant.id, name: t.name, position, isKanban: !!t.isKanban, ...(t.color && { color: t.color }) })), skipDuplicates: true });
      // "conflita com" do modelo: só entre as que ficaram tag (as que viraram motivo não são tag aqui)
      const pares = templateTagConflictPairs(modelo);
      if (pares.length) {
        const idPorNome = new Map((await tx.tag.findMany({ where: { tenantId: tenant.id }, select: { id: true, name: true } })).map((t) => [t.name.toLowerCase(), t.id]));
        const data = pares.map(([a, b]) => [idPorNome.get(a), idPorNome.get(b)] as const).filter((p): p is readonly [string, string] => !!p[0] && !!p[1]).map(([a, b]) => conflictPair(a, b));
        if (data.length) await tx.tagConflict.createMany({ data, skipDuplicates: true });
      }
      await tx.closeReason.createMany({
        data: deEncerramento.map((t, position) => ({ tenantId: tenant.id, name: t.name, position, outcome: t.showOnWon && t.showOnLost ? 'both' : t.showOnWon ? 'won' : 'lost', ...(t.color && { color: t.color }) })),
        skipDuplicates: true,
      });
      await this.provisioning.provision(tx, tenant.id, content);
      const adminProfile = await tx.accessProfile.findFirstOrThrow({ where: { tenantId: tenant.id, isSystem: true, systemRole: 'tenant_admin' }, select: { id: true } });
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

  /**
   * Todos podem listar (filtros, nomes na tela); só admin gerencia. Quem é vinculado a empresas vê
   * só a equipe delas (docs/empresas.md#equipe) — transferir usa outra lista, com régua própria.
   */
  @Get('me/agents')
  async agents(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.user.findMany({ where: { tenantId: u.tenantId, ...teamWhere(u) }, select: { id: true, name: true, ...LOGIN_EMAIL_SELECT, primaryUserId: true, role: true, isActive: true, typingSpeed: true, lastLoginAt: true, invitedAt: true, passwordSetAt: true, scheduleId: true, isTemporary: true, accessExpiresAt: true, expiredAt: true, profile: { select: { id: true, name: true } }, numbers: { select: { numberId: true } }, departments: { select: { departmentId: true } } } });
    // vínculo (pessoa de outra empresa, docs/multiempresa.md): mostra o login dela; não tem convite pendente
    return rows.map(({ primaryUser: _p, primaryUserId, ...r }) => ({ ...r, email: loginEmail({ email: r.email, primaryUser: _p }) ?? '', linked: !!primaryUserId }));
  }

  @Post('me/agents')
  @RequirePermission('team.manage')
  @UseGuards(PlanLimitGuard)
  @RequireLimit('maxAgents')
  async createAgent(@CurrentUser() u: AuthUser, @Body() dto: CreateAgentDto) {
    const { profileId, role } = await this.agentAccess(u, dto);
    if (!dto.password) {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
      return this.inviteAgent(u, tenant.name, dto, profileId, role);
    }
    const created = await this.prisma.user.create({
      data: { tenantId: u.tenantId, email: dto.email, name: dto.name, role, ...(profileId && { profileId }), passwordHash: await this.auth.hashPassword(dto.password), passwordSetAt: new Date() },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!profileId) await this.provisioning.linkRoleProfile(u.tenantId, created.id, role);
    await this.linkToCreatorCompanies(u, created.id);
    return created;
  }

  /**
   * Cadastro em massa: cada pessoa com o seu perfil, por convite. Cada pessoa é independente —
   * e-mail repetido ou já usado, ou perfil que quem cria não pode dar, vira erro só daquela linha. O limite do plano vale para o lote inteiro
   * (antes de criar qualquer uma), para não deixar metade da equipe de fora sem aviso.
   */
  @Post('me/agents/bulk')
  @RequirePermission('team.manage')
  async createAgentsBulk(@CurrentUser() u: AuthUser, @Body() dto: BulkAgentsDto) {
    // mesma regra do individual, uma vez por perfil distinto da lista
    const acessos = new Map<string, Promise<{ profileId?: string; role: 'agent' | 'manager' }>>();
    const acessoDe = (profileId?: string) => {
      const k = profileId ?? '';
      if (!acessos.has(k)) acessos.set(k, this.agentAccess(u, { profileId, role: dto.role }));
      return acessos.get(k)!;
    };
    const norm = (e: string) => e.trim().toLowerCase();
    const vistos = new Set<string>();
    const existentes = new Set((await this.prisma.user.findMany({ where: { email: { in: dto.people.map((p) => p.email.trim()), mode: 'insensitive' } }, select: { email: true } })).map((x) => norm(x.email!)));
    const linhas = dto.people.map((p) => {
      const email = p.email.trim();
      const erro: string | null = existentes.has(norm(email)) ? 'E-mail já cadastrado' : vistos.has(norm(email)) ? 'Repetido na lista' : null;
      vistos.add(norm(email));
      return { name: p.name.trim(), email, profileId: p.profileId ?? dto.profileId, erro };
    });
    for (const l of linhas) {
      if (l.erro) continue;
      try { await acessoDe(l.profileId); } catch (err) { l.erro = err instanceof Error ? err.message : 'Perfil inválido'; }
    }
    await this.usage.assertRoom(u.tenantId, 'maxAgents', linhas.filter((l) => !l.erro).length);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
    const results = [];
    // em sequência: cada convite é um e-mail, e o provedor não gosta de rajada
    for (const l of linhas) {
      if (l.erro) { results.push({ name: l.name, email: l.email, ok: false, error: l.erro }); continue; }
      try {
        const { profileId, role } = await acessoDe(l.profileId);
        const r = await this.inviteAgent(u, tenant.name, l, profileId, role);
        results.push({ name: l.name, email: l.email, ok: true, inviteLink: r.inviteLink, emailSent: r.emailSent });
      } catch (err) {
        results.push({ name: l.name, email: l.email, ok: false, error: err instanceof Error ? err.message : 'Falha ao criar' });
      }
    }
    return { created: results.filter((r) => r.ok).length, results };
  }

  /**
   * Perfil e papel de quem está sendo criado. O perfil é o que define o acesso; o papel técnico
   * só preserva compatibilidade com filas e dados legados: perfil padrão de gerente vira manager;
   * todo outro perfil vira agent.
   */
  private async agentAccess(u: AuthUser, dto: { profileId?: string; role?: 'agent' | 'manager' }) {
    let profileId: string | undefined;
    let role: 'agent' | 'manager' = dto.role === 'manager' ? 'manager' : 'agent';
    if (dto.profileId) {
      const profile = await this.prisma.accessProfile.findFirst({ where: { id: dto.profileId, tenantId: u.tenantId }, select: { id: true, systemRole: true, permissions: true } });
      if (!profile || profile.systemRole === 'tenant_admin') throw new BadRequestException('Perfil de acesso não encontrado.');
      if (u.role !== 'super_admin' && profile.permissions.some((permission) => !u.permissions?.includes(permission as Permission))) {
        throw new BadRequestException('Você não pode atribuir um perfil com permissões que não possui.');
      }
      profileId = profile.id;
      role = profile.systemRole === 'manager' ? 'manager' : 'agent';
    }
    // gerente só cria pessoas do nível operacional
    if (role === 'manager' && u.role === 'manager') throw new BadRequestException('Só o admin da conta pode criar um perfil de gerente.');
    return { profileId, role };
  }

  /** Quem é vinculado a empresas cria gente já vinculada (`creatorCompanyIds`). */
  private async linkToCreatorCompanies(u: AuthUser, userId: string) {
    const alvo = creatorCompanyIds(u);
    if (!alvo.length) return;
    await this.prisma.userCompany.createMany({ data: alvo.map((companyId) => ({ userId, companyId })), skipDuplicates: true });
    this.permissions.invalidate();
  }

  /** Alguém da equipe que quem pede enxerga; fora do escopo = 404 (não confirma que existe). */
  private async teamMember(u: AuthUser, id: string) {
    const row = await this.prisma.user.findFirst({ where: { id, tenantId: u.tenantId, ...teamWhere(u) }, select: { id: true, passwordSetAt: true, primaryUserId: true } });
    if (!row) throw new NotFoundException('Pessoa não encontrada na sua equipe.');
    return row;
  }

  /** Cria a pessoa por convite (e-mail + link copiável). */
  private async inviteAgent(u: AuthUser, tenantName: string, person: { email: string; name: string }, profileId: string | undefined, role: 'agent' | 'manager') {
    const { user, link } = await this.auth.invite({ name: u.name, tenantId: u.tenantId }, { email: person.email, name: person.name, role }, tenantName);
    if (profileId) await this.prisma.user.update({ where: { id: user.id }, data: { profileId } });
    else await this.provisioning.linkRoleProfile(u.tenantId, user.id, role);
    await this.linkToCreatorCompanies(u, user.id);
    // devolve o link mesmo quando o e-mail saiu: e-mail cai em spam e some
    const invite = link ?? (await this.auth.inviteLink(user.id)).link;
    return { id: user.id, name: user.name, email: user.email, role: user.role, invited: true, inviteLink: invite, emailSent: !!link };
  }

  /** Reenvia o convite (usuário que ainda não definiu senha). */
  @Post('me/agents/:id/resend-invite')
  @RequirePermission('team.manage')
  async resendInvite(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const [target, tenant] = await Promise.all([
      this.teamMember(u, id),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } }),
    ]);
    if (target.primaryUserId) throw new BadRequestException(VINCULO_SEM_CONVITE);
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
    const target = await this.teamMember(u, id);
    if (target.primaryUserId) throw new BadRequestException(VINCULO_SEM_CONVITE);
    if (target.passwordSetAt) throw new BadRequestException('Este usuário já definiu a senha. Para trocar, use "Redefinir senha".');
    return this.auth.inviteLink(target.id);
  }

  @Patch('me/agents/:id')
  @RequirePermission('team.manage')
  async updateAgent(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    const { password, profileId, numberIds, ...rest } = dto;
    await this.teamMember(u, id);
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('Informe o nome.');
    if (dto.name !== undefined) rest.name = dto.name.trim();
    // gerente não promove ninguém a gerente (mesma regra do convite)
    if (dto.role !== undefined && u.role === 'manager') throw new BadRequestException('Só o admin da conta muda o papel.');
    if (dto.email !== undefined || password) {
      // vínculo: login e senha são os da pessoa, na empresa principal dela (docs/multiempresa.md)
      const alvo = await this.prisma.user.findFirst({ where: { id, tenantId: u.tenantId }, select: { primaryUserId: true } });
      if (alvo?.primaryUserId) throw new BadRequestException('Esta pessoa entra pelo login de outra empresa: e-mail e senha só ela troca, no próprio perfil.');
    }
    if (dto.email !== undefined) {
      // login em minúsculas; a unicidade é conferida sem diferenciar maiúsculas (o índice do banco diferencia)
      rest.email = dto.email.trim().toLowerCase();
      const taken = await this.prisma.user.count({ where: { email: { equals: rest.email, mode: 'insensitive' }, id: { not: id } } });
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
    // conta edita de qualquer pessoa (inclusive de outro admin): é só rótulo, não muda acesso.
    // O e-mail (login) de outro admin — ou o próprio — também só o admin da conta troca
    const only = (keys: string[]) => Object.entries(dto).every(([k, v]) => keys.includes(k) || v === undefined);
    const editable = only(['typingSpeed'])
      ? (['agent', 'manager', 'tenant_admin'] as const)
      : u.role === 'manager' ? (['agent'] as const)
      : u.role === 'tenant_admin' && only(['name', 'email', 'typingSpeed']) ? (['agent', 'manager', 'tenant_admin'] as const)
      : (['agent', 'manager'] as const);
    // Dono do sistema na equipe (docs/donos-do-sistema.md): trocar senha, login, papel, perfil ou
    // desativar daria a quem é só admin do cliente a conta de dono — e com ela todos os clientes.
    // Nome e velocidade de digitação seguem livres; o resto, só outro dono
    if (!u.systemOwner && !only(['name', 'typingSpeed'])) {
      const alvo = await this.prisma.user.findFirst({ where: { id, tenantId: u.tenantId }, select: { isSystemOwner: true } });
      if (alvo?.isSystemOwner) throw new ForbiddenException('Esta pessoa é dona do sistema: só outro dono altera o acesso dela.');
    }
    const updated = await this.prisma.user.update({ where: { id, tenantId: u.tenantId, role: { in: [...editable] } }, data, select: { id: true, name: true, email: true, role: true, isActive: true } });
    // revoga sessões ativas ao trocar senha, desativar, ou mudar login/papel (vão no token).
    // Depois do update: se a edição for recusada, ninguém é deslogado à toa
    if (password || dto.isActive === false || dto.email !== undefined || dto.role !== undefined) {
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      // desativado: o access token já emitido para de valer agora, não daqui a 15 min
      if (dto.isActive === false) await this.shift.cutSessions([id]);
    }

    if (numberIds) {
      // só números deste cliente: os ids vêm do corpo da requisição
      // quem é restrito só mexe nos números que opera: o vínculo da pessoa com números de outro
      // condomínio (gerente de contrato) fica como está
      const restrito = teamCompanyIds(u) !== null;
      const valid = (await this.prisma.whatsAppNumber.findMany({ where: { id: { in: numberIds }, tenantId: u.tenantId, deletedAt: null }, select: { id: true } })).filter((n) => !restrito || canUseNumber(u, n.id));
      await this.prisma.$transaction([
        this.prisma.userNumber.deleteMany({ where: { userId: id, ...(restrito && { numberId: { in: u.numberIds ?? [] } }) } }),
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
  controllers: [TenantsController, TenantSettingsController, ProfilesController, TenantTemplatesController, SystemOwnersController],
  providers: [TenantSettingsService, SchedulesService, TenantProvisioningService, TemplateRolloutService],
  exports: [TenantSettingsService, SchedulesService, TenantProvisioningService],
})
export class TenantsModule {}
