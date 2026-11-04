import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  cents, competenceMonth, lastClosedPeriod, periodEnded, periodLabel, tierRate,
  type PartnerCommissionKind,
} from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { senderName } from '../../common/mail/mail.service';
import { AsaasService, type AsaasTransfer } from '../billing/asaas.service';
import { PartnerCommissionsService } from './partner-commissions.service';
import { PayoutSecurityService } from './payout-security.service';
import { PAYOUT_REF } from './commission-rules';

type Actor = { id: string; name: string };
type Approval = { userId: string; name: string; at: string };

const num = (v: unknown) => Number(v ?? 0);
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PERIOD_RE = { recurring: /^\d{4}-(0[1-9]|1[0-2])$/, setup: /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/ };

/**
 * Pagamentos aos VogoPartners (docs/37-vogopartners.md#pagamento):
 *
 *   apurar (ciclo terminado) → rascunho → autorizar (código do autenticador; 2º dono acima do
 *   limite) → Pix pelo Asaas → webhook confirma → pago + saída no fechamento financeiro.
 *
 * Toda transição é condicional no banco (`updateMany where status = …`): dois cliques, duas abas
 * ou webhook + tela juntos não mandam o mesmo Pix duas vezes.
 */
@Injectable()
export class PartnerPayoutsService implements OnModuleInit {
  private readonly log = new Logger('PartnerPayouts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly commissions: PartnerCommissionsService,
    private readonly security: PayoutSecurityService,
    private readonly asaas: AsaasService,
  ) {}

  onModuleInit() {
    this.asaas.onTransfer((t, event) => this.onTransfer(t, event));
  }

  // ---------- apuração ----------

  /** Fecha o ciclo: agrupa as comissões em aberto até `period` num pagamento (rascunho) por parceiro. */
  async apurar(kind: PartnerCommissionKind, period: string | undefined, actor: Actor) {
    const target = period ?? lastClosedPeriod(kind);
    if (!PERIOD_RE[kind].test(target)) throw new BadRequestException('Período inválido.');
    if (!periodEnded(kind, target)) throw new BadRequestException(`O ciclo ${periodLabel(kind, target)} ainda não terminou.`);
    await this.commissions.sync();
    const settings = await this.commissions.settings();
    const partnerIds = (await this.prisma.partnerCommission.findMany({
      where: { kind, status: 'pending', period: { lte: target }, OR: [{ payoutId: null }, { payout: { status: 'draft', period: target } }] },
      distinct: ['partnerId'], select: { partnerId: true },
    })).map((r) => r.partnerId);

    const out: { partnerId: string; payoutId: string | null; amount: number; skipped?: string }[] = [];
    for (const partnerId of partnerIds) {
      const existing = await this.prisma.partnerPayout.findUnique({ where: { partnerId_kind_period: { partnerId, kind, period: target } } });
      if (existing && existing.status !== 'draft') { out.push({ partnerId, payoutId: existing.id, amount: num(existing.amount), skipped: 'já autorizado' }); continue; }
      const r = await this.prisma.$transaction(async (tx) => {
        // rascunho anterior do mesmo ciclo: refaz do zero (entrou pagamento, mudou a faixa)
        if (existing) await tx.partnerCommission.updateMany({ where: { payoutId: existing.id }, data: { payoutId: null } });
        const lines = await tx.partnerCommission.findMany({ where: { partnerId, kind, status: 'pending', payoutId: null, period: { lte: target } }, select: { id: true, sourceType: true, baseAmount: true } });
        let activeClients: number | null = null;
        let rate: number | null = null;
        if (kind === 'recurring') {
          activeClients = await this.commissions.activeClients(partnerId);
          rate = tierRate((await this.commissions.tiersOf(partnerId)).tiers, activeClients);
          const toRate = lines.filter((l) => l.sourceType !== 'reversal').map((l) => l.id);
          // a faixa do mês vale para todos os clientes do parceiro — parametrizado, nunca concatenado
          if (toRate.length) await tx.$executeRaw(Prisma.sql`UPDATE "partner_commissions" SET "rate" = ${rate}::numeric, "amount" = ROUND("baseAmount" * ${rate}::numeric / 100, 2) WHERE "id" IN (${Prisma.join(toRate)})`);
        }
        const agg = lines.length
          ? await tx.partnerCommission.aggregate({ where: { id: { in: lines.map((l) => l.id) } }, _sum: { baseAmount: true, amount: true } })
          : null;
        const amount = cents(num(agg?._sum.amount));
        const baseTotal = cents(num(agg?._sum.baseAmount));
        if (!lines.length || amount <= 0 || amount < num(settings.minPayout)) {
          if (existing) await tx.partnerPayout.delete({ where: { id: existing.id } });
          return { payoutId: null, amount, skipped: !lines.length ? 'sem comissão' : amount <= 0 ? 'saldo zero ou negativo' : `abaixo do mínimo (${brl(num(settings.minPayout))})` };
        }
        const payout = existing
          ? await tx.partnerPayout.update({ where: { id: existing.id }, data: { activeClients, rate, baseTotal, amount, approvals: [], pixKey: null, pixKeyType: null, failureReason: null } })
          : await tx.partnerPayout.create({ data: { partnerId, kind, period: target, activeClients, rate, baseTotal, amount, createdById: actor.id } });
        await tx.partnerCommission.updateMany({ where: { id: { in: lines.map((l) => l.id) }, payoutId: null }, data: { payoutId: payout.id } });
        return { payoutId: payout.id, amount };
      });
      out.push({ partnerId, ...r });
    }
    await this.security.event('payout.apurado', actor, { data: { kind, period: target, payouts: out.filter((o) => o.payoutId).length } });
    return { kind, period: target, results: out };
  }

  // ---------- consulta ----------

  async list(filter: { status?: string; kind?: string; partnerId?: string }) {
    const rows = await this.prisma.partnerPayout.findMany({
      where: { ...(filter.status && { status: filter.status }), ...(filter.kind && { kind: filter.kind }), ...(filter.partnerId && { partnerId: filter.partnerId }) },
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
      include: { partner: { select: { id: true, name: true, pixKey: true, pixKeyType: true, pixKeyChangedAt: true, status: true } }, _count: { select: { commissions: true } } },
    });
    const settings = await this.commissions.settings();
    return rows.map((p) => this.present(p, settings.pixKeyCooldownHours));
  }

  async detail(id: string) {
    const p = await this.prisma.partnerPayout.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, name: true, pixKey: true, pixKeyType: true, pixKeyChangedAt: true, status: true } },
        _count: { select: { commissions: true } },
        commissions: { orderBy: [{ paidAt: 'asc' }], include: { tenant: { select: { id: true, name: true } } } },
      },
    });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    const settings = await this.commissions.settings();
    return {
      ...this.present(p, settings.pixKeyCooldownHours),
      lines: p.commissions.map((c) => ({ id: c.id, tenant: c.tenant, kind: c.kind, sourceType: c.sourceType, period: c.period, paidAt: c.paidAt, baseAmount: num(c.baseAmount), rate: c.rate === null ? null : num(c.rate), amount: c.amount === null ? null : num(c.amount) })),
    };
  }

  private present(p: Prisma.PartnerPayoutGetPayload<{ include: { partner: { select: { id: true; name: true; pixKey: true; pixKeyType: true; pixKeyChangedAt: true; status: true } }; _count: { select: { commissions: true } } } }>, cooldownHours: number) {
    const coolUntil = p.partner.pixKeyChangedAt ? new Date(p.partner.pixKeyChangedAt.getTime() + cooldownHours * 3_600_000) : null;
    return {
      id: p.id, kind: p.kind, period: p.period, periodLabel: periodLabel(p.kind as PartnerCommissionKind, p.period),
      partner: { id: p.partner.id, name: p.partner.name, status: p.partner.status, pixKey: p.partner.pixKey, pixKeyType: p.partner.pixKeyType },
      activeClients: p.activeClients, rate: p.rate === null ? null : num(p.rate), baseTotal: num(p.baseTotal), amount: num(p.amount),
      status: p.status, approvals: (p.approvals as unknown as Approval[]) ?? [], pixKey: p.pixKey, pixKeyType: p.pixKeyType,
      transferId: p.transferId, transferStatus: p.transferStatus, failureReason: p.failureReason, sentAt: p.sentAt, paidAt: p.paidAt, paidVia: p.paidVia,
      lines: p._count.commissions, createdAt: p.createdAt,
      /** por que ainda não dá para autorizar (null = pode) */
      blocked: p.partner.status !== 'active' ? 'Parceiro suspenso ou encerrado.'
        : !p.partner.pixKey || !p.partner.pixKeyType ? 'Parceiro sem chave Pix.'
        : coolUntil && coolUntil > new Date() ? `Chave Pix trocada há pouco: libera em ${coolUntil.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`
        : null,
    };
  }

  // ---------- autorização e envio ----------

  /**
   * Autoriza um lote com UM código do autenticador. Cada pagamento é conferido de novo aqui
   * (situação, chave Pix, carência, 2º dono, teto do dia) — a tela é só conveniência.
   */
  async approve(ids: string[], code: string, actor: Actor, ip?: string) {
    await this.security.assertCode(actor.id, code);
    const settings = await this.commissions.settings();
    const second = settings.secondApprovalAbove === null ? null : num(settings.secondApprovalAbove);
    const results: { id: string; status: string; error?: string }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const p = await this.prisma.partnerPayout.findUnique({ where: { id }, include: { partner: true } });
        if (!p) throw new BadRequestException('Pagamento não encontrado.');
        if (p.status !== 'draft' && p.status !== 'awaiting_second') throw new BadRequestException('Este pagamento não está esperando autorização.');
        if (p.partner.status !== 'active') throw new BadRequestException('Parceiro suspenso ou encerrado.');
        if (!p.partner.pixKey || !p.partner.pixKeyType) throw new BadRequestException('Parceiro sem chave Pix.');
        const coolUntil = p.partner.pixKeyChangedAt ? p.partner.pixKeyChangedAt.getTime() + settings.pixKeyCooldownHours * 3_600_000 : 0;
        if (coolUntil > Date.now()) throw new BadRequestException('A chave Pix do parceiro foi trocada há pouco e ainda está na carência.');
        const approvals = ((p.approvals as unknown as Approval[]) ?? []);
        if (approvals.some((a) => a.userId === actor.id)) throw new BadRequestException('Você já autorizou este pagamento: falta outro dono.');
        // 2ª autorização: a chave precisa ser a mesma que o 1º dono viu
        if (p.status === 'awaiting_second' && (p.pixKey !== p.partner.pixKey || p.pixKeyType !== p.partner.pixKeyType)) throw new BadRequestException('A chave Pix mudou depois da 1ª autorização. Apure de novo.');
        const next: Approval[] = [...approvals, { userId: actor.id, name: actor.name, at: new Date().toISOString() }];
        const needsSecond = second !== null && num(p.amount) > second && next.length < 2;
        const status = needsSecond ? 'awaiting_second' : 'approved';
        const ok = await this.prisma.partnerPayout.updateMany({
          where: { id, status: p.status, updatedAt: p.updatedAt },
          data: { status, approvals: next as unknown as Prisma.InputJsonValue, pixKey: p.partner.pixKey, pixKeyType: p.partner.pixKeyType },
        });
        if (!ok.count) throw new BadRequestException('O pagamento mudou enquanto você autorizava. Atualize a tela.');
        await this.security.event(needsSecond ? 'payout.first_approval' : 'payout.approved', actor, { partnerId: p.partnerId, payoutId: id, ip, data: { amount: num(p.amount), pixKey: p.partner.pixKey } });
        results.push({ id, status: needsSecond ? 'awaiting_second' : await this.send(id, actor, ip) });
      } catch (e) {
        results.push({ id, status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    return results;
  }

  /** Manda o Pix de um pagamento autorizado. Sem Asaas configurado, fica autorizado para pagar à mão. */
  private async send(id: string, actor: Actor, ip?: string): Promise<string> {
    if (!this.asaas.enabled) return 'approved';
    const p = await this.prisma.partnerPayout.findUniqueOrThrow({ where: { id } });
    const settings = await this.commissions.settings();
    if (settings.dailyLimit !== null) {
      const start = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00');
      const today = await this.prisma.partnerPayout.aggregate({ where: { sentAt: { gte: start }, status: { in: ['processing', 'paid'] } }, _sum: { amount: true } });
      if (num(today._sum.amount) + num(p.amount) > num(settings.dailyLimit)) {
        throw new BadRequestException(`Passaria do teto diário de ${brl(num(settings.dailyLimit))}. Ficou autorizado: envie amanhã ou aumente o teto.`);
      }
    }
    const lock = await this.prisma.partnerPayout.updateMany({ where: { id, status: 'approved' }, data: { status: 'processing', sentAt: new Date(), failureReason: null } });
    if (!lock.count) return p.status;
    try {
      const t = await this.asaas.createTransfer({
        value: num(p.amount),
        pixAddressKey: p.pixKey!,
        pixAddressKeyType: p.pixKeyType!,
        description: `Comissão ${senderName()} — ${periodLabel(p.kind as PartnerCommissionKind, p.period)}`.slice(0, 140),
        externalReference: `${PAYOUT_REF}${id}`,
      });
      await this.prisma.partnerPayout.update({ where: { id }, data: { transferId: t.id, transferStatus: t.status } });
      await this.security.event('payout.sent', actor, { partnerId: p.partnerId, payoutId: id, ip, data: { transferId: t.id, amount: num(p.amount) } });
      if (t.status === 'DONE') await this.markPaid(id, 'asaas', t.effectiveDate ? new Date(`${t.effectiveDate}T12:00:00-03:00`) : new Date(), actor);
      return t.status === 'DONE' ? 'paid' : 'processing';
    } catch (e) {
      // 4xx do Asaas = recusou (nada saiu); outro erro = não sabemos se saiu — conferir antes de repetir
      const refused = e instanceof BadRequestException;
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.partnerPayout.update({ where: { id }, data: { status: 'failed', transferStatus: refused ? 'REFUSED' : 'UNKNOWN', failureReason: refused ? msg : `Sem resposta do Asaas (${msg}). Confira no painel do Asaas se o Pix saiu antes de tentar de novo.` } });
      await this.security.event('payout.failed', actor, { partnerId: p.partnerId, payoutId: id, ip, data: { error: msg } });
      return 'failed';
    }
  }

  /** Tentar de novo um pagamento que falhou. Sem resposta do Asaas, exige confirmar que nada saiu. */
  async retry(id: string, code: string, confirmNotSent: boolean, actor: Actor, ip?: string) {
    await this.security.assertCode(actor.id, code);
    const p = await this.prisma.partnerPayout.findUnique({ where: { id }, include: { partner: true } });
    if (!p || p.status !== 'failed') throw new BadRequestException('Só dá para repetir pagamento que falhou.');
    if (p.transferStatus === 'UNKNOWN' && !confirmNotSent) throw new BadRequestException('Confirme no painel do Asaas que este Pix não saiu antes de repetir.');
    if (p.pixKey !== p.partner.pixKey) throw new BadRequestException('A chave Pix mudou: apure de novo.');
    await this.prisma.partnerPayout.update({ where: { id }, data: { status: 'approved', transferId: null, transferStatus: null } });
    await this.security.event('payout.retry', actor, { partnerId: p.partnerId, payoutId: id, ip });
    return { id, status: await this.send(id, actor, ip) };
  }

  /** Pix feito fora do sistema (sem Asaas, ou pelo app do banco): baixa manual, com código. */
  async markPaidManual(id: string, code: string, date: string | undefined, actor: Actor, ip?: string) {
    await this.security.assertCode(actor.id, code);
    const p = await this.prisma.partnerPayout.findUnique({ where: { id } });
    if (!p || !['approved', 'failed'].includes(p.status)) throw new BadRequestException('Só pagamento autorizado (ou que falhou) recebe baixa manual.');
    if (p.status === 'failed' && p.transferStatus === 'UNKNOWN') throw new BadRequestException('Confira no Asaas: se o Pix saiu, ele dá baixa sozinho pelo webhook.');
    const paidAt = date ? new Date(`${date}T12:00:00-03:00`) : new Date();
    if (paidAt.getTime() > Date.now() + 60_000) throw new BadRequestException('A data não pode ser futura.');
    await this.markPaid(id, 'manual', paidAt, actor, ['approved', 'failed']);
    await this.security.event('payout.paid_manual', actor, { partnerId: p.partnerId, payoutId: id, ip, data: { date: date ?? null } });
    return this.detail(id);
  }

  /** Desfaz a apuração de um pagamento que ainda não saiu: as comissões voltam para o próximo ciclo. */
  async cancel(id: string, actor: Actor, ip?: string) {
    const p = await this.prisma.partnerPayout.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    if (!['draft', 'awaiting_second', 'approved'].includes(p.status) && !(p.status === 'failed' && p.transferStatus === 'REFUSED')) {
      throw new BadRequestException('Pagamento enviado (ou sem confirmação do Asaas) não pode ser desfeito.');
    }
    await this.prisma.$transaction([
      this.prisma.partnerCommission.updateMany({ where: { payoutId: id }, data: { payoutId: null } }),
      this.prisma.partnerPayout.delete({ where: { id } }),
    ]);
    await this.security.event('payout.canceled', actor, { partnerId: p.partnerId, payoutId: id, ip, data: { amount: num(p.amount), period: p.period, kind: p.kind } });
    return { ok: true };
  }

  /**
   * Pago: grava a baixa e lança a saída no fechamento financeiro (categoria "Comissões de
   * parceiros", competência = mês do ciclo). Idempotente: webhook repetido não lança duas vezes.
   */
  private async markPaid(id: string, via: 'asaas' | 'manual', paidAt: Date, actor: Actor | null, from: string[] = ['processing']) {
    const p = await this.prisma.partnerPayout.findUniqueOrThrow({ where: { id }, include: { partner: { select: { name: true } } } });
    const ok = await this.prisma.partnerPayout.updateMany({ where: { id, status: { in: from } }, data: { status: 'paid', paidAt, paidVia: via, ...(via === 'asaas' && { transferStatus: 'DONE' }) } });
    if (!ok.count) return;
    const label = periodLabel(p.kind as PartnerCommissionKind, p.period);
    await this.prisma.financeEntry.create({
      data: {
        kind: 'expense', category: 'comissao_parceiros',
        description: `Comissão ${p.kind === 'setup' ? 'de instalação' : 'de mensalidades'} — ${p.partner.name} — ${label}`.slice(0, 200),
        amount: num(p.amount), date: paidAt, period: competenceMonth(p.kind as PartnerCommissionKind, p.period), paidAt, paymentMethod: 'pix',
        documentNumber: p.transferId, partnerPayoutId: p.id, createdById: actor?.id ?? null,
      },
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // já lançado
      this.log.error(`pagamento ${id}: saída no financeiro não lançada: ${e}`);
    });
    await this.security.notifyOwners(`Comissão paga: ${p.partner.name} — ${brl(num(p.amount))}`, `Pagamento a ${p.partner.name} (${label}): ${brl(num(p.amount))} por Pix${via === 'manual' ? ' (baixa manual)' : ''}. Chave: ${p.pixKey ?? '-'}.`);
  }

  // ---------- Asaas ----------

  /** Webhook `TRANSFER_*`. */
  async onTransfer(t: AsaasTransfer, event: string) {
    const ref = t.externalReference?.startsWith(PAYOUT_REF) ? t.externalReference.slice(PAYOUT_REF.length) : null;
    const p = await this.prisma.partnerPayout.findFirst({ where: { OR: [{ transferId: t.id }, ...(ref ? [{ id: ref }] : [])] } });
    if (!p) return this.log.debug(`transferência ${t.id} (${event}) não é de parceiro`);
    if (t.status === 'DONE' || event === 'TRANSFER_DONE') {
      return this.markPaid(p.id, 'asaas', t.effectiveDate ? new Date(`${t.effectiveDate}T12:00:00-03:00`) : new Date(), null, ['processing', 'failed']);
    }
    if (['FAILED', 'CANCELLED'].includes(t.status) || event === 'TRANSFER_FAILED' || event === 'TRANSFER_CANCELLED') {
      await this.prisma.partnerPayout.updateMany({ where: { id: p.id, status: 'processing' }, data: { status: 'failed', transferStatus: 'REFUSED', failureReason: t.failReason || (event === 'TRANSFER_CANCELLED' ? 'Transferência cancelada no Asaas.' : 'Transferência recusada pelo banco.') } });
      await this.security.event('payout.failed', null, { partnerId: p.partnerId, payoutId: p.id, data: { transferId: t.id, event, reason: t.failReason ?? null } });
      return;
    }
    await this.prisma.partnerPayout.update({ where: { id: p.id }, data: { transferStatus: t.status } });
  }

  /**
   * "Mecanismo de validação de saque" do Asaas: antes de qualquer transferência sair, o Asaas
   * pergunta aqui. Só aprova o que este sistema autorizou (mesmo id, valor e chave). Com isso, nem
   * quem roubar a chave da API do Asaas consegue tirar dinheiro por fora.
   */
  async validateTransfer(body: { type?: string; transfer?: AsaasTransfer & { pixAddressKey?: string | null } }) {
    const t = body.transfer;
    if (body.type !== 'TRANSFER' || !t) return { status: 'REFUSED', refuseReason: 'Operação não autorizada pelo sistema.' };
    const ref = t.externalReference?.startsWith(PAYOUT_REF) ? t.externalReference.slice(PAYOUT_REF.length) : null;
    const p = ref ? await this.prisma.partnerPayout.findUnique({ where: { id: ref } }) : null;
    const key = t.pixAddressKey ?? t.bankAccount?.pixAddressKey ?? null;
    const ok = !!p && p.status === 'processing' && Math.abs(num(p.amount) - num(t.value)) < 0.005 && (!key || key === p.pixKey);
    await this.security.event(ok ? 'transfer.validated' : 'transfer.refused', null, { partnerId: p?.partnerId, payoutId: p?.id, data: { transferId: t.id ?? null, value: num(t.value), ref: t.externalReference ?? null } });
    if (!ok) {
      this.log.warn(`validação de saque RECUSADA: transferência ${t.id ?? '?'} de ${t.value} (ref ${t.externalReference ?? '-'})`);
      if (!p) await this.security.notifyOwners('Transferência bloqueada no Asaas', `O Asaas pediu para validar uma transferência de ${brl(num(t.value))} que não foi autorizada pelo sistema (ref: ${t.externalReference ?? 'nenhuma'}). Ela foi RECUSADA. Se não foi você, troque a chave da API do Asaas.`);
      return { status: 'REFUSED', refuseReason: 'Transferência não autorizada pelo sistema.' };
    }
    return { status: 'APPROVED' };
  }
}
