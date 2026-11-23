import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { Prisma } from '@prisma/client';
import { cpfCnpjDigits, isValidCpfCnpj } from '@atendo/shared';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService, senderName } from '../../common/mail/mail.service';
import { UsageService } from './usage.service';
import { AsaasService, chargeOf, contractedCharge, type AsaasSubscription } from './asaas.service';
import { REMINDER_DAYS, boletoFirstDueDate, cancelDeadline, diaSP, diasEntre, enrollSkip, qrSignature, reminderKind, reminderMail, type EnrollSkip, type ReminderKind } from './monthly-billing';

/**
 * `would_link`/`linked`: já havia UMA assinatura ativa no Asaas para o CPF/CNPJ (Vogo antigo) — é
 * reaproveitada em vez de criar outra. `remote_duplicate`: mais de uma ativa para o mesmo documento
 * (cobrança em dobro) — nada é feito; cancelar as extras no Asaas.
 */
export interface EnrollResult {
  tenantId: string; tenant: string; plan: string; value: number; dueDate: string | null;
  result: 'enrolled' | 'would_enroll' | 'would_link' | 'linked' | 'remote_duplicate' | EnrollSkip | 'error';
  error?: string;
  /** assinatura(s) que já estão no Asaas para o documento */
  remote?: { id: string; value: number; billingType: string; nextDueDate: string; ours: boolean }[];
}

type PayView = { id: string; dueDate: string; value: number; status: string };
/**
 * Correção de assinatura em dobro no Asaas (docs/05#assinatura-em-dobro). `keep` fica; cada extra
 * perde as cobranças em aberto a partir do 1º vencimento da `keep`. Extra sem cobrança anterior em
 * aberto é excluída (`delete`); com cobrança anterior em aberto (dívida de verdade), só encerra a
 * recorrência (`end`), porque excluir a assinatura apagaria essa cobrança junto.
 */
export interface DuplicateFix {
  tenantId: string; tenant: string;
  keep: { id: string; value: number; billingType: string; ours: boolean; from: string };
  extras: { id: string; value: number; billingType: string; action: 'delete' | 'end'; endDate: string | null; deletePayments: PayView[]; keepPayments: PayView[] }[];
  result: 'would_fix' | 'fixed' | 'error';
  error?: string;
}

const OPEN = new Set(['PENDING', 'OVERDUE']);
const payView = (p: { id: string; dueDate: string; value: number; status: string }): PayView => ({ id: p.id, dueDate: p.dueDate, value: p.value, status: p.status });
const dayBefore = (ymd: string) => new Date(Date.parse(`${ymd}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Mensalidade por Pix no Asaas (docs/05-planos-e-cobranca.md#migração-para-o-asaas):
 * - migra quem paga hoje sem gateway (cobrança manual) para uma assinatura recorrente no Asaas,
 *   mantendo valor contratado e vencimento — sem ação do cliente quando já há CPF/CNPJ;
 * - manda o lembrete por e-mail (Brevo) com valor, vencimento, QR e Pix copia e cola;
 * - informa ao painel o aviso do topo (`notice`).
 */
@Injectable()
export class MonthlyBillingService {
  private readonly log = new Logger(MonthlyBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    private readonly mail: MailService,
    private readonly usage: UsageService,
    private readonly redis: RedisService,
  ) {}

  get enabled() {
    return !!env.ASAAS_API_KEY;
  }

  private liberada: { at: number; on: boolean } | null = null;

  /**
   * Cobrança por Pix liberada para os clientes (`platform_settings.asaasClientBilling`, botão do
   * dono em Financeiro → Cobrança por Pix): aviso de CPF/CNPJ, "Assinar" pelo Asaas e migração
   * automática. Com a chave do Asaas mas desligada, o cliente não vê nada disso. Cache de 30 s
   * (esta leitura está no `GET /billing/usage`, que roda a cada minuto em cada aba aberta).
   */
  async clientBilling(): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.liberada && Date.now() - this.liberada.at < 30_000) return this.liberada.on;
    const row = await this.prisma.platformSettings.findUnique({ where: { id: 'default' } });
    this.liberada = { at: Date.now(), on: !!row?.asaasClientBilling };
    return this.liberada.on;
  }

  async settings() {
    return { asaasConfigured: this.enabled, clientBilling: await this.clientBilling(), autoEnroll: env.ASAAS_AUTO_ENROLL };
  }

  async setClientBilling(on: boolean) {
    await this.prisma.platformSettings.upsert({ where: { id: 'default' }, create: { id: 'default', asaasClientBilling: on }, update: { asaasClientBilling: on } });
    this.liberada = null;
    this.log.log(`cobrança por Pix para os clientes ${on ? 'liberada' : 'escondida'}`);
    return this.settings();
  }

  /** Checkout pelo Asaas: liberado para todos, ou para quem já assina pelo Asaas (trocar de plano). */
  async checkoutAllowed(tenantId: string) {
    if (await this.clientBilling()) return true;
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, select: { gateway: true } });
    return sub?.gateway === 'asaas';
  }

  private async candidates(tenantId?: string) {
    return this.prisma.subscription.findMany({
      // aguardando a ativação: a recorrente nasce quando ela for paga (asaas.completeActivation)
      where: { ...(tenantId && { tenantId }), awaitingActivation: false, tenant: { isActive: true } },
      include: { plan: true, tenant: true },
      orderBy: { currentPeriodEnd: 'asc' },
    });
  }

  /** valor contratado (negociado, senão o do plano) × unidades, no ciclo do plano */
  private charge(s: { priceMonth: unknown; units: number; plan: Parameters<typeof chargeOf>[0] }) {
    return contractedCharge(s);
  }

  /**
   * Põe no Asaas quem pode migrar. `dryRun`: só diz o que faria (valor, vencimento, motivo de
   * quem fica de fora) — o dono confere antes de gerar cobrança de verdade.
   */
  async enrollAll(opts: { dryRun: boolean; tenantId?: string }): Promise<EnrollResult[]> {
    if (!this.enabled) throw new BadRequestException('Asaas não configurado (ASAAS_API_KEY).');
    const out: EnrollResult[] = [];
    for (const s of await this.candidates(opts.tenantId)) {
      const { value, cycle } = this.charge(s);
      const base = { tenantId: s.tenantId, tenant: s.tenant.name, plan: s.plan.name, value };
      const skip = enrollSkip({ gateway: s.gateway, status: s.status, billingCycle: s.plan.billingCycle, isFree: s.plan.isFree, value, document: s.tenant.document });
      if (skip === 'already' && s.gateway === 'asaas' && !opts.dryRun && s.tenant.asaasCustomerId) {
        // já assina pelo Asaas: só liga os avisos do Asaas (nasciam desligados até 16/11/2026)
        await this.asaas.enableNotifications(s.tenant.asaasCustomerId).catch((err) => this.log.warn(`avisos do Asaas tenant ${s.tenantId}: ${err?.message ?? err}`));
      }
      // já no Asaas: na prévia, confere se sobrou outra assinatura ativa no mesmo documento (Vogo antigo)
      if (skip === 'already' && s.gateway === 'asaas' && opts.dryRun && s.status !== 'canceled' && isValidCpfCnpj(s.tenant.document)) {
        const remotas = await this.asaas.activeSubscriptionsByDocument(s.tenant.document!).catch(() => []);
        if (remotas.some((r) => r.id !== s.externalId)) {
          out.push({ ...base, dueDate: null, result: 'remote_duplicate', remote: remotas.map((r) => remoteView(r, s.externalId)), error: `${remotas.length} assinaturas ativas no Asaas para este CPF/CNPJ — cancele a que não é a do Atendo` });
        }
      }
      if (skip) { if (skip !== 'already' && skip !== 'free') out.push({ ...base, dueDate: null, result: skip }); continue; }
      try {
        // assinatura que já existia no Asaas (Vogo antigo): reaproveita em vez de criar outra
        const remotas = await this.asaas.activeSubscriptionsByDocument(s.tenant.document!);
        if (remotas.length > 1) {
          out.push({ ...base, dueDate: null, result: 'remote_duplicate', remote: remotas.map((r) => remoteView(r, null)), error: `${remotas.length} assinaturas ativas no Asaas para este CPF/CNPJ — cancele as extras e rode de novo` });
          continue;
        }
        if (remotas.length === 1) {
          const r = remotas[0];
          const open = await this.asaas.openSubscriptionPayment(r.id).catch(() => null);
          const dueDate = open?.dueDate ?? r.nextDueDate;
          if (opts.dryRun) { out.push({ ...base, dueDate, result: 'would_link', remote: [remoteView(r, null)] }); continue; }
          await this.linkOne(s.tenantId, r, dueDate);
          out.push({ ...base, dueDate, result: 'linked', remote: [remoteView(r, r.id)] });
          continue;
        }
        const openCharge = (await this.prisma.invoice.count({ where: { tenantId: s.tenantId, status: 'open', externalId: { not: null } } })) > 0;
        const dueDate = boletoFirstDueDate(s.currentPeriodEnd, undefined, { openCharge, cycle: s.plan.billingCycle === 'yearly' ? 'yearly' : 'monthly' });
        if (opts.dryRun) { out.push({ ...base, dueDate, result: 'would_enroll' }); continue; }
        await this.enrollOne(s.tenantId, { value, cycle, dueDate, planName: s.plan.name });
        out.push({ ...base, dueDate, result: 'enrolled' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`migração Asaas tenant ${s.tenantId} (${s.tenant.name}): ${msg}`);
        out.push({ ...base, dueDate: null, result: 'error', error: msg });
      }
    }
    return out;
  }

  /**
   * Assinatura em dobro no Asaas (docs/05#assinatura-em-dobro): mais de uma ativa no mesmo CPF/CNPJ.
   * Fica a do Atendo; sem ela (cliente ainda não migrado), a que recebeu pagamento por último.
   * `dryRun` só mostra o que faria.
   */
  async resolveDuplicates(opts: { dryRun: boolean; tenantId?: string }): Promise<DuplicateFix[]> {
    if (!this.enabled) throw new BadRequestException('Asaas não configurado (ASAAS_API_KEY).');
    const subs = await this.prisma.subscription.findMany({
      where: { ...(opts.tenantId && { tenantId: opts.tenantId }), status: { not: 'canceled' }, tenant: { isActive: true }, OR: [{ gateway: null }, { gateway: 'asaas' }] },
      include: { tenant: { select: { name: true, document: true } } },
    });
    const out: DuplicateFix[] = [];
    for (const s of subs) {
      if (!isValidCpfCnpj(s.tenant.document)) continue;
      const base = { tenantId: s.tenantId, tenant: s.tenant.name };
      try {
        const remotas = await this.asaas.activeSubscriptionsByDocument(s.tenant.document!);
        if (remotas.length < 2) continue;
        const pays = new Map<string, Awaited<ReturnType<AsaasService['subscriptionPayments']>>>();
        for (const r of remotas) pays.set(r.id, await this.asaas.subscriptionPayments(r.id));
        const ultimoPago = (id: string) => pays.get(id)!.filter((p) => p.status === 'RECEIVED' || p.status === 'CONFIRMED' || p.status === 'RECEIVED_IN_CASH').map((p) => p.paymentDate ?? p.dueDate).sort().pop() ?? '';
        let keep = s.gateway === 'asaas' ? remotas.find((r) => r.id === s.externalId) : undefined;
        if (s.gateway === 'asaas' && !keep) {
          out.push({ ...base, keep: { id: s.externalId ?? '—', value: 0, billingType: '', ours: true, from: '' }, extras: [], result: 'error', error: 'A assinatura do Atendo não está ativa no Asaas, mas há outras ativas. Resolva à mão.' });
          continue;
        }
        keep ??= [...remotas].sort((a, b) => ultimoPago(b.id).localeCompare(ultimoPago(a.id)) || a.nextDueDate.localeCompare(b.nextDueDate))[0];
        // a partir daqui quem cobra é a `keep`: o 1º vencimento dela em aberto, senão o próximo que vai gerar
        const from = pays.get(keep.id)!.filter((p) => OPEN.has(p.status)).map((p) => p.dueDate).sort()[0] ?? keep.nextDueDate;
        const extras = remotas.filter((r) => r.id !== keep!.id).map((r) => {
          const abertas = pays.get(r.id)!.filter((p) => OPEN.has(p.status));
          const deletePayments = abertas.filter((p) => p.dueDate >= from).map(payView);
          const keepPayments = abertas.filter((p) => p.dueDate < from).map(payView);
          const action: 'delete' | 'end' = keepPayments.length ? 'end' : 'delete';
          return { id: r.id, value: r.value, billingType: r.billingType, action, endDate: action === 'end' ? dayBefore(from) : null, deletePayments, keepPayments };
        });
        const fix: DuplicateFix = { ...base, keep: { id: keep.id, value: keep.value, billingType: keep.billingType, ours: keep.id === s.externalId, from }, extras, result: 'would_fix' };
        if (!opts.dryRun) {
          for (const e of extras) {
            if (e.action === 'delete') {
              await this.asaas.cancelSubscription(e.id);
            } else {
              for (const p of e.deletePayments) await this.asaas.deletePayment(p.id);
              await this.asaas.endSubscription(e.id, e.endDate!);
            }
            this.log.log(`assinatura em dobro tenant ${s.tenantId}: ${e.id} ${e.action === 'delete' ? 'excluída' : `encerrada em ${e.endDate}`}, ${e.deletePayments.length} cobrança(s) excluída(s); fica ${keep.id}`);
          }
          fix.result = 'fixed';
        }
        out.push(fix);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`assinatura em dobro tenant ${s.tenantId} (${s.tenant.name}): ${msg}`);
        out.push({ ...base, keep: { id: '—', value: 0, billingType: '', ours: false, from: '' }, extras: [], result: 'error', error: msg });
      }
    }
    return out;
  }

  /**
   * Reaproveita a assinatura que o cliente já tinha no Asaas (docs/05#assinatura-antiga-no-asaas):
   * o valor, a forma de pagamento e as cobranças já geradas ficam como estão; só passa a ser a
   * assinatura do tenant aqui (webhook, lembretes, carência e suspensão).
   */
  private async linkOne(tenantId: string, r: AsaasSubscription, dueDate: string) {
    // o webhook acha o tenant pelo customer: um customer não pode servir a duas empresas
    const dono = await this.prisma.tenant.findFirst({ where: { asaasCustomerId: r.customer, id: { not: tenantId } }, select: { name: true } });
    if (dono) throw new BadRequestException(`O cadastro deste CPF/CNPJ no Asaas já está ligado a "${dono.name}". Vincule à mão.`);
    await this.asaas.adoptSubscription(tenantId, r);
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { asaasCustomerId: r.customer } });
    // só vira Asaas se ainda estava sem gateway (job + botão juntos): quem perdeu não mexe em nada —
    // a assinatura remota é do cliente, nunca é cancelada aqui
    const claimed = await this.prisma.subscription.updateMany({
      where: { tenantId, gateway: null },
      data: { gateway: 'asaas', externalId: r.id, currentPeriodEnd: new Date(`${dueDate}T23:59:59-03:00`) },
    });
    if (!claimed.count) return;
    this.log.log(`tenant ${tenantId} vinculado à assinatura Asaas existente ${r.id} (${r.value} ${r.billingType}), vencimento ${dueDate}`);
    await this.remindTenant(tenantId).catch((err) => this.log.warn(`fatura pós-vínculo tenant ${tenantId}: ${err?.message ?? err}`));
  }

  private async enrollOne(tenantId: string, c: { value: number; cycle: 'MONTHLY' | 'YEARLY'; dueDate: string; planName: string }) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const customer = await this.asaas.createOrUpdateCustomer(tenantId, {
      name: tenant.legalName || tenant.name,
      cpfCnpj: cpfCnpjDigits(tenant.document),
      email: tenant.billingEmail || undefined,
      mobilePhone: tenant.phone || undefined,
      postalCode: tenant.zipCode || undefined,
      addressNumber: tenant.addressNumber || undefined,
    });
    // boleto (o Asaas põe o Pix no mesmo documento): ele gera as parcelas e manda os lembretes
    const remote = await this.asaas.createSubscription({ customer, billingType: 'BOLETO', value: c.value, cycle: c.cycle, description: `${senderName()} ${c.planName}`, externalReference: tenantId, nextDueDate: c.dueDate });
    // só vira Asaas se ainda estava sem gateway: duas rodadas juntas (job + botão) não podem deixar
    // duas assinaturas cobrando — a que perdeu é cancelada no Asaas
    const claimed = await this.prisma.subscription.updateMany({ where: { tenantId, gateway: null }, data: { gateway: 'asaas', externalId: remote.id } });
    if (!claimed.count) {
      await this.asaas.cancelSubscription(remote.id).catch((err) => this.log.error(`assinatura Asaas ${remote.id} duplicada não cancelada: ${err?.message ?? err}`));
      return;
    }
    // o vencimento passa a ser o da 1ª parcela (o painel e a data limite para cancelar leem daqui)
    await this.prisma.subscription.update({ where: { tenantId }, data: { currentPeriodEnd: new Date(`${c.dueDate}T23:59:59-03:00`) } });
    this.log.log(`tenant ${tenantId} migrado para o Asaas: ${remote.id}, ${c.value} ${c.cycle}, 1º vencimento ${c.dueDate}`);
    // a 1ª parcela já existe e o Asaas avisa o cliente dela na hora; aqui só espelha a fatura
    await this.remindTenant(tenantId).catch((err) => this.log.warn(`fatura pós-migração tenant ${tenantId}: ${err?.message ?? err}`));
  }

  /**
   * Cliente novo ou que acabou de ganhar CPF/CNPJ/plano pago: entra na assinatura do Asaas na hora,
   * sem esperar o job (docs/05#clientes-novos). Melhor esforço: falha fica no log e o job tenta de novo.
   */
  async enrollIfReady(tenantId: string) {
    if (!this.enabled) return;
    const [r] = await this.enrollAll({ dryRun: false, tenantId }).catch((err) => {
      this.log.warn(`assinatura Asaas do tenant ${tenantId}: ${err?.message ?? err}`);
      return [];
    });
    return r;
  }

  /**
   * Data limite para cancelar (docs/05#data-limite-para-cancelar): até quando dá para cancelar a
   * assinatura do Asaas sem que a próxima parcela seja gerada. Só para quem assina pelo Asaas.
   */
  cancelInfo(sub: { gateway: string | null; status: string; currentPeriodEnd: Date; plan: { billingCycle: string } } | null) {
    if (!sub || sub.gateway !== 'asaas' || !['active', 'trialing', 'past_due'].includes(sub.status)) return null;
    return cancelDeadline(diaSP(sub.currentPeriodEnd), sub.plan.billingCycle === 'yearly' ? 'yearly' : 'monthly', env.ASAAS_SUBSCRIPTION_LEAD_DAYS);
  }

  /** O cliente informou o CPF/CNPJ no aviso do painel: grava e migra na hora. */
  async setDocumentAndEnroll(tenantId: string, raw: string) {
    if (!(await this.clientBilling())) throw new BadRequestException('O pagamento automático ainda não está disponível.');
    if (!isValidCpfCnpj(raw)) throw new BadRequestException('CPF ou CNPJ inválido. Confira os números.');
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { document: cpfCnpjDigits(raw) } });
    if (!this.enabled) return { enrolled: false };
    const [r] = await this.enrollAll({ dryRun: false, tenantId });
    if (r?.result === 'error') throw new BadRequestException('Não foi possível ativar a cobrança automática agora. Tente de novo em instantes ou fale com o suporte.');
    return { enrolled: r?.result === 'enrolled' };
  }

  /** Job diário: lembretes de todas as assinaturas pagas — no Asaas e as sem gateway (cobrança manual). */
  async sendReminders() {
    if (!this.enabled) return;
    const subs = await this.prisma.subscription.findMany({ where: { gateway: 'asaas', externalId: { not: null }, status: { in: ['active', 'trialing', 'past_due'] }, tenant: { isActive: true } }, select: { tenantId: true } });
    for (const s of subs) await this.remindTenant(s.tenantId).catch((err) => this.log.warn(`lembrete tenant ${s.tenantId}: ${err?.message ?? err}`));
    const manuais = await this.prisma.subscription.findMany({ where: { gateway: null, awaitingActivation: false, status: { in: ['active', 'past_due'] }, plan: { isFree: false }, tenant: { isActive: true } }, select: { tenantId: true } });
    for (const s of manuais) await this.remindManual(s.tenantId).catch((err) => this.log.warn(`lembrete (manual) tenant ${s.tenantId}: ${err?.message ?? err}`));
  }

  /** Mensalidade em aberto de quem não tem assinatura no Asaas: o Pix avulso de Vencimentos, ou nada gerado ainda. */
  private async manualDue(sub: { tenantId: string; currentPeriodEnd: Date; priceMonth: unknown; units: number; plan: Parameters<typeof chargeOf>[0] }) {
    const inv = await this.prisma.invoice.findFirst({ where: { tenantId: sub.tenantId, status: 'open', externalId: { not: null }, dueAt: { not: null }, items: { not: Prisma.AnyNull } }, orderBy: { dueAt: 'asc' } });
    const doGrupo = inv && ((inv.items ?? []) as unknown as { kind: string }[]).some((it) => it.kind === 'group');
    if (inv?.dueAt && doGrupo) return { invoice: inv, value: Number(inv.totalAmount), dueDate: diaSP(inv.dueAt) };
    const value = this.charge(sub).value;
    return value > 0 ? { invoice: null, value, dueDate: diaSP(sub.currentPeriodEnd) } : null;
  }

  /**
   * Lembrete de quem paga sem assinatura no Asaas (docs/05#lembretes-da-mensalidade). Com o Pix
   * avulso de Vencimentos em aberto: o mesmo e-mail do Asaas, com o QR, e a marca fica na fatura.
   * Sem cobrança gerada: o vencimento é o `currentPeriodEnd` e o e-mail leva a Vencimentos, onde o
   * cliente gera o Pix; a marca fica no Redis (não há fatura). Vencida sem cobrança: um aviso só, no
   * dia seguinte ao vencimento — quem já estava vencido antes de 16/11/2026 não recebe uma rajada.
   */
  async remindManual(tenantId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub || sub.gateway) return;
    const due = await this.manualDue(sub);
    if (!due) return;
    const hoje = diaSP();
    let kind: ReminderKind | 'overdue' | null;
    let reservar: () => Promise<boolean>;
    let devolver: () => Promise<unknown>;
    if (due.invoice) {
      const inv = due.invoice;
      kind = reminderKind(hoje, due.dueDate, { soon: !!inv.remindedSoonAt, due: !!inv.remindedDueAt });
      const marca = kind === 'due' ? { remindedDueAt: new Date(), remindedSoonAt: inv.remindedSoonAt ?? new Date() } : { remindedSoonAt: new Date() };
      reservar = async () => (await this.prisma.invoice.updateMany({ where: { id: inv.id, ...(kind === 'due' ? { remindedDueAt: null } : { remindedSoonAt: null }) }, data: marca })).count > 0;
      devolver = () => this.prisma.invoice.update({ where: { id: inv.id }, data: kind === 'due' ? { remindedDueAt: null } : { remindedSoonAt: null } });
    } else {
      kind = diasEntre(hoje, due.dueDate) === -1 ? 'overdue' : reminderKind(hoje, due.dueDate, { soon: false, due: false });
      const chave = `billing:lembrete:${tenantId}:${due.dueDate}:${kind}`;
      reservar = async () => (await this.redis.set(chave, '1', 'EX', 60 * 86_400, 'NX')) === 'OK';
      devolver = () => this.redis.del(chave);
    }
    if (!kind || !(await reservar())) return;

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { billingEmail: true } });
    const to = [...new Set([tenant.billingEmail, ...(await this.usage.adminEmails(tenantId))].filter((e): e is string => !!e))];
    if (!to.length) return;
    const paymentId = due.invoice?.externalId ?? null;
    const pix = paymentId ? await this.asaas.getPixQrCode(paymentId).catch(() => null) : null;
    const mail = reminderMail({
      brand: senderName(),
      kind,
      value: due.value,
      dueDate: due.dueDate,
      pixPayload: pix?.payload ?? null,
      qrUrl: pix && paymentId ? `${env.API_PUBLIC_URL}/billing/pix/${encodeURIComponent(paymentId)}/qr.png?s=${qrSignature(env.ENCRYPTION_KEY, paymentId)}` : null,
      // sem cobrança gerada, o Pix sai em Vencimentos
      payUrl: paymentId ? `${env.WEB_ORIGIN}/plano?pagar=1` : `${env.WEB_ORIGIN}/plano/vencimentos`,
      invoiceUrl: due.invoice?.hostedUrl ?? null,
    });
    try {
      await this.mail.send({ to, ...mail });
      this.log.log(`lembrete "${kind}" (sem gateway${paymentId ? `, cobrança ${paymentId}` : ', sem cobrança'}) do tenant ${tenantId} enviado para ${to.length} e-mail(s)`);
    } catch (err) {
      await devolver();
      throw err;
    }
  }

  /**
   * Assinatura no Asaas: quem manda o lembrete (boleto + Pix, antes, no dia e depois do vencimento)
   * é o próprio Asaas desde 16/11/2026 — mandar o nosso também duplicaria. Aqui só espelha a parcela
   * em aberto em `invoices` (aviso do painel e Financeiro), sem depender do webhook ter chegado.
   */
  async remindTenant(tenantId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub?.externalId || sub.gateway !== 'asaas') return;
    const p = await this.asaas.openSubscriptionPayment(sub.externalId);
    if (!p) return;
    await this.asaas.view(tenantId, p, false); // espelha a fatura (e dá baixa se já estiver paga)
  }

  /** PNG do QR Pix de uma cobrança (a URL do e-mail é assinada; ver `qrSignature`). */
  async qrPng(paymentId: string) {
    const pix = await this.asaas.getPixQrCode(paymentId);
    return Buffer.from(pix.encodedImage, 'base64');
  }

  /**
   * Aviso do topo do painel, só da cobrança (o de uso/atraso é o `quota`/`status`): falta o
   * CPF/CNPJ para entrar no automático, ou a mensalidade vence nos próximos dias. Lido das
   * faturas espelhadas — o `GET /billing/usage` roda a cada minuto e não pode ir ao Asaas.
   */
  async notice(tenantId: string) {
    if (!this.enabled) return null;
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true, tenant: { select: { document: true } } } });
    if (!sub) return null;
    if (sub.awaitingActivation) {
      // conta nova: o admin paga a ativação (instalação + 1ª mensalidade) para liberar o envio
      const a = await this.prisma.activationCharge.findFirst({ where: { tenantId, status: 'pending' }, orderBy: { createdAt: 'desc' } });
      if (a) return { kind: 'activation_due' as const, value: Number(a.totalValue), dueDate: diaSP(a.dueDate), daysLeft: diasEntre(diaSP(), diaSP(a.dueDate)), items: a.items as unknown as { description: string; value: number }[] };
    }
    if (!sub.gateway) {
      // mensalidade vencendo (Pix avulso em aberto ou só a data): mesmo aviso de quem está no Asaas
      if (!sub.plan.isFree && ['active', 'trialing'].includes(sub.status)) {
        const due = await this.manualDue(sub);
        const hoje = diaSP();
        const dias = due ? diasEntre(hoje, due.dueDate) : null;
        if (due && dias !== null && dias >= 0 && dias <= REMINDER_DAYS) return { kind: 'payment_due' as const, value: due.value, dueDate: due.dueDate, daysLeft: dias, hasCharge: !!due.invoice };
      }
      // pedir o CPF/CNPJ só quando a cobrança por Pix estiver liberada para os clientes
      if (!(await this.clientBilling())) return null;
      const skip = enrollSkip({ gateway: null, status: sub.status, billingCycle: sub.plan.billingCycle, isFree: sub.plan.isFree, value: this.charge(sub).value, document: sub.tenant.document });
      return skip === 'no_document' ? { kind: 'needs_document' as const } : null;
    }
    if (sub.gateway !== 'asaas') return null;
    const hoje = diaSP();
    const limite = new Date(Date.parse(`${hoje}T23:59:59-03:00`) + REMINDER_DAYS * 86_400_000);
    const inv = await this.prisma.invoice.findFirst({ where: { tenantId, status: 'open', externalId: { not: null }, baseAmount: { gt: 0 }, dueAt: { lte: limite } }, orderBy: { dueAt: 'asc' } });
    if (!inv?.dueAt) return null;
    const dueDate = diaSP(inv.dueAt);
    return { kind: 'payment_due' as const, value: Number(inv.totalAmount), dueDate, daysLeft: diasEntre(hoje, dueDate), hasCharge: true };
  }
}

const remoteView = (r: AsaasSubscription, oursId: string | null) => ({ id: r.id, value: r.value, billingType: r.billingType, nextDueDate: r.nextDueDate, ours: r.id === oursId });
