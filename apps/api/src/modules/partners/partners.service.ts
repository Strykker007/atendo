import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  cpfCnpjDigits, isValidCpfCnpj, monthPeriodOf, nextTier, normalizePayoutPixKey, sortTiers, tierRate, weekPeriodOf,
  type PartnerTierRule, type PayoutPixKeyType,
} from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PartnerCommissionsService } from './partner-commissions.service';
import { PayoutSecurityService } from './payout-security.service';

type Actor = { id: string; name: string };
const num = (v: unknown) => Number(v ?? 0);

export interface PartnerInput {
  name?: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  setupRate?: number | null;
  status?: 'active' | 'suspended' | 'ended';
  notes?: string | null;
}

/** Cadastro dos VogoPartners — só o dono do sistema (docs/37-vogopartners.md#cadastro). */
@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly commissions: PartnerCommissionsService,
    private readonly security: PayoutSecurityService,
  ) {}

  async list() {
    await this.commissions.sync();
    const [partners, defaults] = await Promise.all([
      this.prisma.partner.findMany({
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        include: { tiers: true, _count: { select: { tenants: true, users: true } } },
      }),
      this.commissions.defaultTiers(),
    ]);
    const now = new Date();
    const [month, week] = [monthPeriodOf(now), weekPeriodOf(now)];
    return Promise.all(partners.map(async (p) => {
      const tiers: PartnerTierRule[] = p.tiers.length ? p.tiers.map((t) => ({ minClients: t.minClients, rate: num(t.rate) })) : defaults;
      const [active, monthBase, weekSetup, open] = await Promise.all([
        this.commissions.activeClients(p.id),
        this.prisma.partnerCommission.aggregate({ where: { partnerId: p.id, kind: 'recurring', status: 'pending', period: month }, _sum: { baseAmount: true } }),
        this.prisma.partnerCommission.aggregate({ where: { partnerId: p.id, kind: 'setup', status: 'pending', period: week }, _sum: { amount: true } }),
        this.prisma.partnerPayout.aggregate({ where: { partnerId: p.id, status: { notIn: ['paid'] } }, _sum: { amount: true } }),
      ]);
      const rate = tierRate(tiers, active);
      return {
        id: p.id, name: p.name, document: p.document, email: p.email, phone: p.phone, status: p.status,
        pixKey: p.pixKey, pixKeyType: p.pixKeyType, pixKeyChangedAt: p.pixKeyChangedAt,
        setupRate: p.setupRate === null ? null : num(p.setupRate), customTiers: p.tiers.length > 0, tiers: sortTiers(tiers),
        clients: p._count.tenants, logins: p._count.users, activeClients: active, rate, nextTier: nextTier(tiers, active),
        /** previsão do mês corrente (base × % da faixa de hoje) e instalações da semana */
        monthEstimate: Math.round(num(monthBase._sum.baseAmount) * rate) / 100,
        weekSetup: num(weekSetup._sum.amount),
        openPayouts: num(open._sum.amount),
      };
    }));
  }

  async get(id: string) {
    const p = await this.prisma.partner.findUnique({
      where: { id },
      include: {
        tiers: { orderBy: { minClients: 'asc' } },
        users: { select: { id: true, name: true, email: true, isActive: true, invitedAt: true, passwordSetAt: true, lastLoginAt: true, primaryUserId: true, primaryUser: { select: { email: true, lastLoginAt: true, tenant: { select: { name: true } } } } }, orderBy: { createdAt: 'asc' } },
        tenants: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, name: true, isActive: true, createdAt: true, partnerAttributedAt: true, subscription: { select: { status: true, awaitingActivation: true, priceMonth: true, plan: { select: { name: true, isFree: true } } } } },
        },
      },
    });
    if (!p) throw new NotFoundException('Parceiro não encontrado');
    const [rate, setupRate, events] = await Promise.all([
      this.commissions.currentRate(id),
      this.commissions.setupRateOf(id),
      this.prisma.partnerEvent.findMany({ where: { partnerId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return {
      ...p,
      // vínculo (docs/37-vogopartners.md#parceiro-que-ja-usa-o-atendo): entra pelo login que já tem
      users: p.users.map(({ primaryUser, primaryUserId, ...u }) => ({
        ...u,
        email: u.email ?? primaryUser?.email ?? null,
        linked: !!primaryUserId,
        linkedTenant: primaryUser?.tenant?.name ?? null,
        lastLoginAt: u.lastLoginAt ?? primaryUser?.lastLoginAt ?? null,
      })),
      setupRate: p.setupRate === null ? null : num(p.setupRate), effectiveSetupRate: setupRate,
      tiers: p.tiers.map((t) => ({ id: t.id, minClients: t.minClients, rate: num(t.rate) })),
      current: { ...rate, nextTier: nextTier(rate.tiers, rate.activeClients) },
      tenants: p.tenants.map((t) => ({ ...t, subscription: t.subscription && { ...t.subscription, priceMonth: t.subscription.priceMonth === null ? null : num(t.subscription.priceMonth) } })),
      events,
    };
  }

  private clean(dto: PartnerInput) {
    const data: Prisma.PartnerUncheckedUpdateInput = {};
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('Informe o nome.');
      data.name = dto.name.trim();
    }
    if (dto.document !== undefined) {
      const d = cpfCnpjDigits(dto.document ?? '');
      if (d && !isValidCpfCnpj(d)) throw new BadRequestException('CPF/CNPJ inválido.');
      data.document = d || null;
    }
    if (dto.email !== undefined) data.email = dto.email?.trim().toLowerCase() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.replace(/\D/g, '') || null;
    if (dto.setupRate !== undefined) data.setupRate = dto.setupRate;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    return data;
  }

  async create(dto: PartnerInput & { name: string; login?: { name: string; email: string } }, actor: Actor) {
    const data = this.clean(dto) as Prisma.PartnerUncheckedCreateInput;
    // confere o login ANTES de criar: e-mail recusado não pode deixar um parceiro sem login para trás
    if (dto.login) await this.loginTarget(dto.login.email.trim().toLowerCase());
    const p = await this.prisma.partner.create({ data: { ...data, name: dto.name.trim() } });
    await this.security.event('partner.created', actor, { partnerId: p.id, data: { name: p.name } });
    if (dto.login) await this.addLogin(p.id, dto.login, actor);
    return this.get(p.id);
  }

  async update(id: string, dto: PartnerInput, actor: Actor) {
    const before = await this.prisma.partner.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Parceiro não encontrado');
    const data = this.clean(dto);
    await this.prisma.partner.update({ where: { id }, data });
    await this.security.event('partner.updated', actor, { partnerId: id, data: JSON.parse(JSON.stringify(dto)) });
    // suspenso/encerrado: sessões abertas do parceiro caem no próximo refresh (o login confere o status)
    return this.get(id);
  }

  /**
   * Chave Pix: a parte mais sensível do cadastro — é para onde o dinheiro vai. Exige o código do
   * autenticador, abre a carência, devolve para rascunho o que já estava autorizado e avisa os donos.
   */
  async setPixKey(id: string, dto: { pixKey: string; pixKeyType: PayoutPixKeyType; code: string }, actor: Actor, ip?: string) {
    await this.security.assertCode(actor.id, dto.code);
    const p = await this.prisma.partner.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Parceiro não encontrado');
    const key = normalizePayoutPixKey(dto.pixKeyType, dto.pixKey);
    if (!key) throw new BadRequestException('Chave Pix inválida para o tipo escolhido.');
    if (key === p.pixKey && dto.pixKeyType === p.pixKeyType) return this.get(id);
    const settings = await this.commissions.settings();
    await this.prisma.$transaction([
      // 1ª chave não tem carência: não havia para onde o dinheiro ir antes
      this.prisma.partner.update({ where: { id }, data: { pixKey: key, pixKeyType: dto.pixKeyType, pixKeyChangedAt: p.pixKey ? new Date() : null } }),
      this.prisma.partnerPayout.updateMany({ where: { partnerId: id, status: { in: ['awaiting_second', 'approved'] } }, data: { status: 'draft', approvals: [], pixKey: null, pixKeyType: null } }),
    ]);
    await this.security.event('partner.pix_key', actor, { partnerId: id, ip, data: { from: p.pixKey, to: key, type: dto.pixKeyType } });
    await this.security.notifyOwners(
      `Chave Pix do parceiro ${p.name} ${p.pixKey ? 'trocada' : 'cadastrada'}`,
      `${actor.name} ${p.pixKey ? `trocou a chave Pix de ${p.name}: ${p.pixKey} → ${key}` : `cadastrou a chave Pix de ${p.name}: ${key}`} (${dto.pixKeyType}).${p.pixKey ? ` Pagamentos a este parceiro ficam bloqueados por ${settings.pixKeyCooldownHours}h.` : ''} Se não foi combinado, revise em Parceiros e troque as senhas.`,
    );
    return this.get(id);
  }

  /** Faixas próprias do parceiro (lista vazia = volta às padrão) ou, com `partnerId` null, as padrão. */
  async setTiers(partnerId: string | null, tiers: PartnerTierRule[], actor: Actor) {
    const seen = new Set<number>();
    for (const t of tiers) {
      if (!Number.isInteger(t.minClients) || t.minClients < 0) throw new BadRequestException('Clientes da faixa: número inteiro, 0 ou mais.');
      if (!(t.rate >= 0 && t.rate <= 100)) throw new BadRequestException('Percentual da faixa entre 0 e 100.');
      if (seen.has(t.minClients)) throw new BadRequestException(`Duas faixas começando em ${t.minClients} clientes.`);
      seen.add(t.minClients);
    }
    if (partnerId === null && !tiers.length) throw new BadRequestException('O programa precisa de ao menos uma faixa padrão.');
    if (partnerId && !(await this.prisma.partner.count({ where: { id: partnerId } }))) throw new NotFoundException('Parceiro não encontrado');
    await this.prisma.$transaction([
      this.prisma.partnerTier.deleteMany({ where: { partnerId } }),
      this.prisma.partnerTier.createMany({ data: sortTiers(tiers).map((t) => ({ partnerId, minClients: t.minClients, rate: t.rate })) }),
    ]);
    await this.security.event('partner.tiers', actor, { partnerId: partnerId ?? undefined, data: { tiers: tiers as unknown as Prisma.InputJsonValue } });
    return partnerId ? this.get(partnerId) : this.settingsView();
  }

  // ---------- logins do parceiro ----------

  /**
   * Quem é o dono do e-mail. Livre → null (login novo, com convite). Já usa o Atendo (ex.: dono ou
   * gerente de uma farmácia) → a pessoa, para o parceiro virar um **vínculo** dela
   * (docs/multiempresa.md): entra com o mesmo e-mail e senha e troca no seletor. Uma pessoa é
   * parceira de um parceiro só.
   */
  private async loginTarget(email: string) {
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, name: true, isActive: true, primaryUserId: true } });
    if (!existing) return null;
    const personId = existing.primaryUserId ?? existing.id;
    const ja = await this.prisma.user.findFirst({ where: { role: 'partner', OR: [{ id: personId }, { primaryUserId: personId }] }, select: { partner: { select: { name: true } } } });
    if (ja) throw new BadRequestException(`Este e-mail já é login do parceiro ${ja.partner?.name ?? '(removido)'}.`);
    if (!existing.isActive) throw new BadRequestException('Este e-mail é de um usuário desativado. Reative-o antes de usá-lo como parceiro.');
    return { personId, name: existing.name };
  }

  async addLogin(partnerId: string, dto: { name: string; email: string }, actor: Actor) {
    const email = dto.email.trim().toLowerCase();
    const p = await this.prisma.partner.findUnique({ where: { id: partnerId }, select: { name: true } });
    if (!p) throw new NotFoundException('Parceiro não encontrado');
    const pessoa = await this.loginTarget(email);
    if (pessoa) {
      // já tem login no Atendo: sem convite nem senha nova — o portal aparece no seletor dela
      const link = await this.prisma.user.create({
        data: { tenantId: null, partnerId, primaryUserId: pessoa.personId, email: null, name: pessoa.name, role: 'partner', passwordHash: await this.auth.hashPassword(randomBytes(24).toString('base64url')) },
        select: { id: true },
      });
      await this.security.event('partner.login_created', actor, { partnerId, data: { email, linked: true } });
      return { userId: link.id, linked: true, inviteLink: null, emailSent: false };
    }
    const user = await this.prisma.user.create({
      data: { tenantId: null, partnerId, email, name: dto.name.trim(), role: 'partner', passwordHash: await this.auth.hashPassword(randomBytes(24).toString('base64url')), invitedAt: new Date() },
      select: { id: true },
    });
    const sent = await this.auth.sendInvite(user.id, actor.name, `${p.name} (VogoPartner)`).catch(() => null);
    await this.security.event('partner.login_created', actor, { partnerId, data: { email } });
    return { userId: user.id, linked: false, inviteLink: sent ?? (await this.auth.inviteLink(user.id)).link, emailSent: !!sent };
  }

  async loginInviteLink(partnerId: string, userId: string) {
    const u = await this.prisma.user.findFirst({ where: { id: userId, partnerId, role: 'partner' }, select: { passwordSetAt: true, primaryUserId: true } });
    if (!u) throw new NotFoundException('Login não encontrado');
    if (u.primaryUserId) throw new BadRequestException('Este parceiro entra com o e-mail e a senha que já usa no Atendo; não há convite.');
    if (u.passwordSetAt) throw new BadRequestException('Este login já definiu a senha.');
    return this.auth.inviteLink(userId);
  }

  async setLoginActive(partnerId: string, userId: string, isActive: boolean, actor: Actor) {
    const r = await this.prisma.user.updateMany({ where: { id: userId, partnerId, role: 'partner' }, data: { isActive } });
    if (!r.count) throw new NotFoundException('Login não encontrado');
    if (!isActive) await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => undefined);
    await this.security.event(isActive ? 'partner.login_enabled' : 'partner.login_disabled', actor, { partnerId, data: { userId } });
    return this.get(partnerId);
  }

  // ---------- clientes ----------

  /** Vincula (ou desvincula) um cliente. A comissão conta dos pagamentos a partir de agora. */
  async setTenantPartner(tenantId: string, partnerId: string | null, actor: Actor) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, partnerId: true } });
    if (!t) throw new NotFoundException('Cliente não encontrado');
    if (partnerId && !(await this.prisma.partner.count({ where: { id: partnerId } }))) throw new NotFoundException('Parceiro não encontrado');
    if (t.partnerId === partnerId) return { ok: true };
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { partnerId, partnerAttributedAt: partnerId ? new Date() : null } });
    for (const pid of [t.partnerId, partnerId].filter(Boolean) as string[]) {
      await this.security.event('partner.tenant', actor, { partnerId: pid, data: { tenantId, tenant: t.name, from: t.partnerId, to: partnerId } });
    }
    return { ok: true };
  }

  /** Clientes sem parceiro (para vincular). */
  unassignedTenants(q?: string) {
    return this.prisma.tenant.findMany({
      where: { partnerId: null, ...(q && { name: { contains: q, mode: 'insensitive' } }) },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
      take: 30,
    });
  }

  // ---------- configuração ----------

  async settingsView() {
    const [s, tiers] = await Promise.all([this.commissions.settings(), this.commissions.defaultTiers()]);
    return {
      setupRate: num(s.setupRate), setupFee: num(s.setupFee), minPayout: num(s.minPayout), pixKeyCooldownHours: s.pixKeyCooldownHours,
      secondApprovalAbove: s.secondApprovalAbove === null ? null : num(s.secondApprovalAbove), dailyLimit: s.dailyLimit === null ? null : num(s.dailyLimit),
      defaultTiers: tiers,
    };
  }

  /** Configuração do programa. Afrouxar a segurança (teto, 2º dono, carência) exige o código. */
  async updateSettings(dto: { setupRate?: number; setupFee?: number; minPayout?: number; pixKeyCooldownHours?: number; secondApprovalAbove?: number | null; dailyLimit?: number | null; code?: string }, actor: Actor, ip?: string) {
    const security = dto.pixKeyCooldownHours !== undefined || dto.secondApprovalAbove !== undefined || dto.dailyLimit !== undefined;
    if (security) await this.security.assertCode(actor.id, dto.code);
    const { code: _c, ...data } = dto;
    await this.prisma.partnerSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    await this.security.event('settings.updated', actor, { ip, data: JSON.parse(JSON.stringify(data)) });
    return this.settingsView();
  }

  events(take = 100) {
    return this.prisma.partnerEvent.findMany({ orderBy: { createdAt: 'desc' }, take });
  }
}
