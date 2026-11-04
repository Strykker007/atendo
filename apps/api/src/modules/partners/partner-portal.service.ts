import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { monthPeriodOf, nextTier, periodLabel, weekPeriodOf, type PartnerCommissionKind } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ActivationService } from '../billing/activation.service';
import { contractedCharge } from '../billing/asaas.service';
import { TenantCreationService, type NewTenantInput } from '../tenants/tenant-creation.service';
import { PartnerCommissionsService } from './partner-commissions.service';
import { PayoutSecurityService } from './payout-security.service';

const num = (v: unknown) => Number(v ?? 0);
const maskPix = (k: string | null) => (!k ? null : k.length <= 6 ? '•••' : `${k.slice(0, 3)}•••${k.slice(-3)}`);

/**
 * Portal do VogoPartner (docs/37-vogopartners.md#portal-do-parceiro). Tudo filtrado pelo
 * `partnerId` do token — nunca por id vindo da tela. O parceiro cadastra e configura clientes;
 * valores (plano, instalação, comissão) ele só vê.
 */
@Injectable()
export class PartnerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissions: PartnerCommissionsService,
    private readonly creation: TenantCreationService,
    private readonly activation: ActivationService,
    private readonly security: PayoutSecurityService,
  ) {}

  /** Parceiro ativo do token, ou 403. Toda rota do portal passa por aqui. */
  async partnerOf(partnerId: string | undefined) {
    const p = partnerId ? await this.prisma.partner.findUnique({ where: { id: partnerId } }) : null;
    if (!p || p.status !== 'active') throw new ForbiddenException('Seu acesso de parceiro está suspenso. Fale com a equipe.');
    return p;
  }

  async me(partnerId: string | undefined) {
    const p = await this.partnerOf(partnerId);
    await this.commissions.sync(p.id);
    const now = new Date();
    const [month, week] = [monthPeriodOf(now), weekPeriodOf(now)];
    const [rate, setupRate, settings, clients, monthBase, weekSetup, pending, paid] = await Promise.all([
      this.commissions.currentRate(p.id),
      this.commissions.setupRateOf(p.id),
      this.commissions.settings(),
      this.prisma.tenant.count({ where: { partnerId: p.id } }),
      this.prisma.partnerCommission.aggregate({ where: { partnerId: p.id, kind: 'recurring', status: 'pending', period: month }, _sum: { baseAmount: true } }),
      this.prisma.partnerCommission.aggregate({ where: { partnerId: p.id, kind: 'setup', status: 'pending', period: week }, _sum: { amount: true } }),
      this.prisma.partnerPayout.aggregate({ where: { partnerId: p.id, status: { not: 'paid' } }, _sum: { amount: true } }),
      this.prisma.partnerPayout.aggregate({ where: { partnerId: p.id, status: 'paid' }, _sum: { amount: true } }),
    ]);
    return {
      id: p.id, name: p.name, pixKey: maskPix(p.pixKey), pixKeyType: p.pixKeyType,
      clients, activeClients: rate.activeClients, rate: rate.rate, tiers: rate.tiers, nextTier: nextTier(rate.tiers, rate.activeClients),
      setupRate, setupFee: num(settings.setupFee),
      month: { period: month, label: periodLabel('recurring', month), base: num(monthBase._sum.baseAmount), estimate: Math.round(num(monthBase._sum.baseAmount) * rate.rate) / 100 },
      week: { period: week, label: periodLabel('setup', week), amount: num(weekSetup._sum.amount) },
      toReceive: num(pending._sum.amount), received: num(paid._sum.amount),
    };
  }

  async clients(partnerId: string | undefined) {
    const p = await this.partnerOf(partnerId);
    const month = monthPeriodOf(new Date());
    const rows = await this.prisma.tenant.findMany({
      where: { partnerId: p.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, isActive: true, createdAt: true, partnerAttributedAt: true,
        subscription: { select: { status: true, awaitingActivation: true, currentPeriodEnd: true, priceMonth: true, units: true, plan: true } },
        activationCharges: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, totalValue: true, invoiceUrl: true, dueDate: true, paidAt: true } },
        partnerCommissions: { where: { partnerId: p.id, period: month, kind: 'recurring', status: 'pending' }, select: { baseAmount: true } },
      },
    });
    return rows.map((t) => ({
      id: t.id, name: t.name, isActive: t.isActive, createdAt: t.createdAt, since: t.partnerAttributedAt,
      plan: t.subscription ? { name: t.subscription.plan.name, isFree: t.subscription.plan.isFree, monthly: t.subscription.plan.isFree ? 0 : contractedCharge(t.subscription).value } : null,
      status: t.subscription?.status ?? null, awaitingActivation: !!t.subscription?.awaitingActivation, dueAt: t.subscription?.currentPeriodEnd ?? null,
      activation: t.activationCharges[0] ? { ...t.activationCharges[0], totalValue: num(t.activationCharges[0].totalValue) } : null,
      paidThisMonth: t.partnerCommissions.reduce((s, c) => s + num(c.baseAmount), 0),
    }));
  }

  /** Planos que o parceiro pode vender: os do catálogo (personalizado é negociação do dono). */
  async plans(partnerId: string | undefined) {
    await this.partnerOf(partnerId);
    const rows = await this.prisma.plan.findMany({ where: { isActive: true, billingCycle: { in: ['monthly', 'yearly', 'free'] } }, orderBy: { priceMonth: 'asc' } });
    return rows.map((p) => ({ id: p.id, name: p.name, priceMonth: num(p.priceMonth), priceYear: p.priceYear === null ? null : num(p.priceYear), billingCycle: p.billingCycle, isFree: p.isFree, durationDays: p.durationDays }));
  }

  async templates(partnerId: string | undefined) {
    await this.partnerOf(partnerId);
    return this.prisma.tenantTemplate.findMany({ select: { id: true, name: true, description: true, isDefault: true }, orderBy: { name: 'asc' } });
  }

  /** Cliente novo: o mesmo cadastro do dono, já vinculado ao parceiro. */
  async createClient(partnerId: string | undefined, user: { id: string; name: string }, dto: NewTenantInput) {
    const p = await this.partnerOf(partnerId);
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || !plan.isActive || plan.billingCycle === 'custom') throw new BadRequestException('Escolha um dos planos disponíveis.');
    const tenant = await this.creation.create(dto, { partnerId: p.id, inviterName: p.name });
    await this.security.event('partner.client_created', { id: user.id, name: user.name }, { partnerId: p.id, data: { tenantId: tenant.id, name: tenant.name, plan: plan.name } });
    return { id: tenant.id, name: tenant.name };
  }

  private async ownTenant(partnerId: string, tenantId: string) {
    const t = await this.prisma.tenant.findFirst({ where: { id: tenantId, partnerId }, select: { id: true } });
    if (!t) throw new NotFoundException('Cliente não encontrado entre os seus.');
  }

  async getActivation(partnerId: string | undefined, tenantId: string) {
    const p = await this.partnerOf(partnerId);
    await this.ownTenant(p.id, tenantId);
    const [a, settings] = await Promise.all([this.activation.get(tenantId), this.commissions.settings()]);
    return { ...a, setupFee: num(settings.setupFee) };
  }

  /**
   * Cobrança de ativação com valores travados: 1ª mensalidade do plano (valor contratado) +
   * taxa de instalação do programa. O parceiro informa só o CPF/CNPJ do cliente e o vencimento.
   */
  async createActivation(partnerId: string | undefined, user: { id: string; name: string }, tenantId: string, dto: { document?: string; dueDate?: string }) {
    const p = await this.partnerOf(partnerId);
    await this.ownTenant(p.id, tenantId);
    const [a, settings] = await Promise.all([this.activation.get(tenantId), this.commissions.settings()]);
    const items = [
      ...(num(settings.setupFee) > 0 ? [{ description: 'Instalação e configuração', value: num(settings.setupFee), kind: 'setup' as const }] : []),
      ...(a.firstMonthValue > 0 ? [{ description: `1ª mensalidade — ${a.planName}`, value: a.firstMonthValue, kind: 'first_month' as const }] : []),
    ];
    if (!items.length) throw new BadRequestException('Nada a cobrar: plano gratuito e sem taxa de instalação.');
    const r = await this.activation.create(tenantId, user.id, { items, document: dto.document, dueDate: dto.dueDate });
    await this.security.event('partner.activation', { id: user.id, name: user.name }, { partnerId: p.id, data: { tenantId, total: items.reduce((s, i) => s + i.value, 0) } });
    return { ...r, setupFee: num(settings.setupFee) };
  }

  /** Extrato: comissões (por ciclo) e pagamentos recebidos. */
  async statement(partnerId: string | undefined, kind?: PartnerCommissionKind) {
    const p = await this.partnerOf(partnerId);
    await this.commissions.sync(p.id);
    const [lines, payouts] = await Promise.all([
      this.prisma.partnerCommission.findMany({
        where: { partnerId: p.id, ...(kind && { kind }), status: 'pending' },
        orderBy: [{ paidAt: 'desc' }],
        take: 500,
        select: { id: true, kind: true, sourceType: true, period: true, paidAt: true, baseAmount: true, rate: true, amount: true, payout: { select: { status: true } }, tenant: { select: { name: true } } },
      }),
      this.prisma.partnerPayout.findMany({ where: { partnerId: p.id }, orderBy: { createdAt: 'desc' }, take: 60 }),
    ]);
    return {
      lines: lines.map((l) => ({
        id: l.id, kind: l.kind, reversal: l.sourceType === 'reversal', period: l.period, periodLabel: periodLabel(l.kind as PartnerCommissionKind, l.period),
        paidAt: l.paidAt, client: l.tenant.name, base: num(l.baseAmount), rate: l.rate === null ? null : num(l.rate), amount: l.amount === null ? null : num(l.amount),
        payoutStatus: l.payout?.status ?? null,
      })),
      payouts: payouts.map((x) => ({
        id: x.id, kind: x.kind, period: x.period, periodLabel: periodLabel(x.kind as PartnerCommissionKind, x.period), activeClients: x.activeClients,
        rate: x.rate === null ? null : num(x.rate), baseTotal: num(x.baseTotal), amount: num(x.amount),
        // o parceiro vê só "em processamento" ou "pago" — os passos internos da autorização são do financeiro
        status: x.status === 'paid' ? 'paid' : 'processing', paidAt: x.paidAt,
      })),
    };
  }
}
