import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { commissionOf, monthPeriodOf, tierRate, weekPeriodOf, type PartnerTierRule } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { activationSplit, countsForPartner, FINANCE_CATEGORY_KIND, type ActivationItemLike } from './commission-rules';

/** Estorno só é procurado nos pagamentos recentes: devolução depois disso é tratada à mão. */
const REVERSAL_WINDOW_DAYS = 120;

const num = (v: unknown) => Number(v ?? 0);

/**
 * Livro de comissões dos VogoPartners (docs/37-vogopartners.md#como-a-comissão-nasce).
 *
 * Não calcula nada "na hora": cada pagamento de cliente vira uma linha em `partner_commissions`,
 * a partir do que foi PAGO (fatura `paid`, recebido por fora, ativação paga). Idempotente — o
 * `@@unique([sourceType, sourceId, kind])` garante que rodar de novo nunca duplica.
 */
@Injectable()
export class PartnerCommissionsService {
  private readonly log = new Logger('PartnerCommissions');

  constructor(private readonly prisma: PrismaService) {}

  async settings() {
    return this.prisma.partnerSettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
  }

  async defaultTiers(): Promise<PartnerTierRule[]> {
    const def = await this.prisma.partnerTier.findMany({ where: { partnerId: null }, orderBy: { minClients: 'asc' } });
    return def.map((t) => ({ minClients: t.minClients, rate: num(t.rate) }));
  }

  /** Faixas do parceiro: as próprias, se tiver; senão as padrão do programa. */
  async tiersOf(partnerId: string): Promise<{ tiers: PartnerTierRule[]; custom: boolean }> {
    const own = await this.prisma.partnerTier.findMany({ where: { partnerId }, orderBy: { minClients: 'asc' } });
    if (own.length) return { tiers: own.map((t) => ({ minClients: t.minClients, rate: num(t.rate) })), custom: true };
    return { tiers: await this.defaultTiers(), custom: false };
  }

  /**
   * Clientes ativos do parceiro: no ar, assinatura ativa (ou só atrasada), plano pago e ativação
   * já paga. É o número que decide a faixa.
   */
  activeClients(partnerId: string) {
    return this.prisma.tenant.count({
      where: { partnerId, isActive: true, subscription: { status: { in: ['active', 'past_due'] }, awaitingActivation: false, plan: { isFree: false } } },
    });
  }

  async currentRate(partnerId: string) {
    const [{ tiers, custom }, active] = await Promise.all([this.tiersOf(partnerId), this.activeClients(partnerId)]);
    return { tiers, custom, activeClients: active, rate: tierRate(tiers, active) };
  }

  /** % da instalação do parceiro (próprio ou padrão). */
  async setupRateOf(partnerId: string) {
    const [p, s] = await Promise.all([this.prisma.partner.findUnique({ where: { id: partnerId }, select: { setupRate: true } }), this.settings()]);
    return num(p?.setupRate ?? s.setupRate);
  }

  /**
   * Gera as linhas que faltam e estorna as que perderam a origem. `partnerId` restringe a um
   * parceiro (portal); sem ele, todos (tela do dono, apuração).
   */
  async sync(partnerId?: string) {
    const tenants = await this.prisma.tenant.findMany({
      where: { partnerId: partnerId ?? { not: null }, partner: { status: { not: 'ended' } } },
      select: { id: true, partnerId: true, partnerAttributedAt: true, partner: { select: { setupRate: true } } },
    });
    if (!tenants.length) return { created: 0, reversed: 0 };
    const settings = await this.settings();
    const byId = new Map(tenants.map((t) => [t.id, t]));
    const ids = tenants.map((t) => t.id);
    const rows: Prisma.PartnerCommissionCreateManyInput[] = [];
    const push = (t: (typeof tenants)[number], kind: 'recurring' | 'setup', sourceType: string, sourceId: string, paidAt: Date, base: number) => {
      if (base <= 0 || !t.partnerId) return;
      const setupRate = num(t.partner?.setupRate ?? settings.setupRate);
      rows.push({
        partnerId: t.partnerId, tenantId: t.id, kind, sourceType, sourceId, paidAt, baseAmount: base,
        period: kind === 'recurring' ? monthPeriodOf(paidAt) : weekPeriodOf(paidAt),
        // instalação tem % fixo: já nasce com o valor. Mensalidade depende da faixa do mês: só na apuração
        ...(kind === 'setup' && { rate: setupRate, amount: commissionOf(base, setupRate) }),
      });
    };

    const [activations, invoices, entries] = await Promise.all([
      this.prisma.activationCharge.findMany({ where: { tenantId: { in: ids } }, select: { id: true, tenantId: true, status: true, items: true, discount: true, paidAt: true, externalId: true } }),
      this.prisma.invoice.findMany({ where: { tenantId: { in: ids }, status: 'paid', paidAt: { not: null }, baseAmount: { gt: 0 } }, select: { id: true, tenantId: true, baseAmount: true, paidAt: true, externalId: true } }),
      this.prisma.financeEntry.findMany({ where: { tenantId: { in: ids }, kind: 'income', category: { in: Object.keys(FINANCE_CATEGORY_KIND) }, skipped: false }, select: { id: true, tenantId: true, category: true, amount: true, date: true, paidAt: true } }),
    ]);

    // a fatura espelhada da ativação não conta de novo: a ativação já gera instalação + 1ª mensalidade
    const activationInvoices = new Set(activations.map((a) => a.externalId).filter(Boolean) as string[]);
    const valid = { activation: new Set<string>(), invoice: new Set<string>(), finance_entry: new Set<string>() };

    for (const a of activations) {
      const t = byId.get(a.tenantId)!;
      if (a.status !== 'paid' || !a.paidAt || !countsForPartner(a.paidAt, t.partnerAttributedAt)) continue;
      valid.activation.add(a.id);
      const { setupBase, firstMonthBase } = activationSplit((a.items as unknown as ActivationItemLike[]) ?? [], num(a.discount));
      push(t, 'setup', 'activation', a.id, a.paidAt, setupBase);
      push(t, 'recurring', 'activation', a.id, a.paidAt, firstMonthBase);
    }
    for (const i of invoices) {
      const t = byId.get(i.tenantId)!;
      if (!i.paidAt || (i.externalId && activationInvoices.has(i.externalId)) || !countsForPartner(i.paidAt, t.partnerAttributedAt)) continue;
      valid.invoice.add(i.id);
      push(t, 'recurring', 'invoice', i.id, i.paidAt, num(i.baseAmount));
    }
    for (const e of entries) {
      const t = byId.get(e.tenantId!)!;
      const paidAt = e.paidAt ?? e.date;
      if (!countsForPartner(paidAt, t.partnerAttributedAt)) continue;
      valid.finance_entry.add(e.id);
      push(t, FINANCE_CATEGORY_KIND[e.category], 'finance_entry', e.id, paidAt, num(e.amount));
    }

    const created = rows.length ? (await this.prisma.partnerCommission.createMany({ data: rows, skipDuplicates: true })).count : 0;
    const reversed = await this.reverseOrphans(ids, valid);
    if (created || reversed) this.log.log(`comissões: ${created} novas, ${reversed} estornadas`);
    return { created, reversed };
  }

  /**
   * Pagamento estornado/apagado depois de virar comissão:
   * - comissão ainda não autorizada → sai da conta (`reversed`, e sai do rascunho do pagamento);
   * - já autorizada/paga → linha negativa no ciclo atual, descontada no próximo pagamento.
   */
  private async reverseOrphans(tenantIds: string[], valid: Record<'activation' | 'invoice' | 'finance_entry', Set<string>>) {
    const since = new Date(Date.now() - REVERSAL_WINDOW_DAYS * 86_400_000);
    const lines = await this.prisma.partnerCommission.findMany({
      where: { tenantId: { in: tenantIds }, status: 'pending', sourceType: { in: ['activation', 'invoice', 'finance_entry'] }, paidAt: { gte: since } },
      select: { id: true, partnerId: true, tenantId: true, kind: true, sourceType: true, sourceId: true, baseAmount: true, rate: true, amount: true, payoutId: true, payout: { select: { status: true } } },
    });
    const orphans = lines.filter((l) => !valid[l.sourceType as keyof typeof valid].has(l.sourceId));
    let n = 0;
    for (const l of orphans) {
      if (!l.payoutId || l.payout?.status === 'draft') {
        await this.prisma.$transaction(async (tx) => {
          const r = await tx.partnerCommission.updateMany({ where: { id: l.id, status: 'pending' }, data: { status: 'reversed', payoutId: null } });
          if (r.count && l.payoutId) {
            await tx.partnerPayout.update({ where: { id: l.payoutId }, data: { baseTotal: { decrement: num(l.baseAmount) }, amount: { decrement: num(l.amount) } } });
          }
          n += r.count;
        });
        continue;
      }
      // já autorizada ou paga: desconta no próximo ciclo
      const now = new Date();
      const r = await this.prisma.partnerCommission.createMany({
        data: [{
          partnerId: l.partnerId, tenantId: l.tenantId, kind: l.kind, sourceType: 'reversal', sourceId: l.id, paidAt: now,
          period: l.kind === 'recurring' ? monthPeriodOf(now) : weekPeriodOf(now),
          baseAmount: -num(l.baseAmount), rate: l.rate, amount: l.amount === null ? null : -num(l.amount),
        }],
        skipDuplicates: true,
      });
      n += r.count;
    }
    return n;
  }
}
