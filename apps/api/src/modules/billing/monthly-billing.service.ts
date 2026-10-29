import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { cpfCnpjDigits, isValidCpfCnpj } from '@atendo/shared';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService, senderName } from '../../common/mail/mail.service';
import { UsageService } from './usage.service';
import { AsaasService, chargeOf, contractedCharge } from './asaas.service';
import { REMINDER_DAYS, diaSP, diasEntre, enrollSkip, firstDueDate, qrSignature, reminderKind, reminderMail, type EnrollSkip } from './monthly-billing';

export interface EnrollResult { tenantId: string; tenant: string; plan: string; value: number; dueDate: string | null; result: 'enrolled' | 'would_enroll' | EnrollSkip | 'error'; error?: string }

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
      if (skip) { if (skip !== 'already' && skip !== 'free') out.push({ ...base, dueDate: null, result: skip }); continue; }
      const dueDate = firstDueDate(s.currentPeriodEnd);
      if (opts.dryRun) { out.push({ ...base, dueDate, result: 'would_enroll' }); continue; }
      try {
        await this.enrollOne(s.tenantId, { value, cycle, dueDate, planName: s.plan.name });
        out.push({ ...base, dueDate, result: 'enrolled' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`migração Asaas tenant ${s.tenantId} (${s.tenant.name}): ${msg}`);
        out.push({ ...base, dueDate, result: 'error', error: msg });
      }
    }
    return out;
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
    const remote = await this.asaas.createSubscription({ customer, billingType: 'PIX', value: c.value, cycle: c.cycle, description: `${senderName()} ${c.planName}`, externalReference: tenantId, nextDueDate: c.dueDate });
    // só vira Asaas se ainda estava sem gateway: duas rodadas juntas (job + botão) não podem deixar
    // duas assinaturas cobrando — a que perdeu é cancelada no Asaas
    const claimed = await this.prisma.subscription.updateMany({ where: { tenantId, gateway: null }, data: { gateway: 'asaas', externalId: remote.id } });
    if (!claimed.count) {
      await this.asaas.cancelSubscription(remote.id).catch((err) => this.log.error(`assinatura Asaas ${remote.id} duplicada não cancelada: ${err?.message ?? err}`));
      return;
    }
    this.log.log(`tenant ${tenantId} migrado para o Asaas: ${remote.id}, ${c.value} ${c.cycle}, 1º vencimento ${c.dueDate}`);
    // a 1ª cobrança já existe: o lembrete sai agora se o vencimento estiver perto (não espera o job)
    await this.remindTenant(tenantId).catch((err) => this.log.warn(`lembrete pós-migração tenant ${tenantId}: ${err?.message ?? err}`));
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

  /** Job diário: lembretes de todas as assinaturas no Asaas. */
  async sendReminders() {
    if (!this.enabled) return;
    const subs = await this.prisma.subscription.findMany({ where: { gateway: 'asaas', externalId: { not: null }, status: { in: ['active', 'trialing', 'past_due'] }, tenant: { isActive: true } }, select: { tenantId: true } });
    for (const s of subs) await this.remindTenant(s.tenantId).catch((err) => this.log.warn(`lembrete tenant ${s.tenantId}: ${err?.message ?? err}`));
  }

  /**
   * Lembrete de um cliente: a cobrança em aberto vem do Asaas (não depende do webhook ter
   * chegado), é espelhada em `invoices` e a marca do lembrete é reservada ANTES do envio
   * (`updateMany` onde ainda está nula) — duas instâncias do job não mandam o mesmo e-mail.
   */
  async remindTenant(tenantId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub?.externalId || sub.gateway !== 'asaas') return;
    const p = await this.asaas.openSubscriptionPayment(sub.externalId);
    if (!p || p.billingType === 'CREDIT_CARD') return; // cartão debita sozinho: não há o que lembrar
    await this.asaas.view(tenantId, p, false); // espelha a fatura (e dá baixa se já estiver paga)
    const inv = await this.prisma.invoice.findUnique({ where: { externalId: p.id } });
    if (!inv || inv.status !== 'open') return;
    const kind = reminderKind(diaSP(), p.dueDate, { soon: !!inv.remindedSoonAt, due: !!inv.remindedDueAt });
    if (!kind) return;
    const marca = kind === 'due' ? { remindedDueAt: new Date(), remindedSoonAt: inv.remindedSoonAt ?? new Date() } : { remindedSoonAt: new Date() };
    const reservado = await this.prisma.invoice.updateMany({ where: { id: inv.id, ...(kind === 'due' ? { remindedDueAt: null } : { remindedSoonAt: null }) }, data: marca });
    if (!reservado.count) return;

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { billingEmail: true } });
    const to = [...new Set([tenant.billingEmail, ...(await this.usage.adminEmails(tenantId))].filter((e): e is string => !!e))];
    if (!to.length) return;
    const pix = await this.asaas.getPixQrCode(p.id).catch(() => null);
    const mail = reminderMail({
      brand: senderName(),
      kind,
      value: p.value,
      dueDate: p.dueDate,
      pixPayload: pix?.payload ?? null,
      qrUrl: pix ? `${env.API_PUBLIC_URL}/billing/pix/${encodeURIComponent(p.id)}/qr.png?s=${qrSignature(env.ENCRYPTION_KEY, p.id)}` : null,
      payUrl: `${env.WEB_ORIGIN}/plano?pagar=1`,
      invoiceUrl: p.invoiceUrl ?? null,
    });
    try {
      await this.mail.send({ to, ...mail });
      this.log.log(`lembrete "${kind}" da cobrança ${p.id} (tenant ${tenantId}) enviado para ${to.length} e-mail(s)`);
    } catch (err) {
      // falhou no provedor: devolve a marca para o próximo job tentar de novo
      await this.prisma.invoice.update({ where: { id: inv.id }, data: kind === 'due' ? { remindedDueAt: null } : { remindedSoonAt: null } });
      throw err;
    }
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
    return { kind: 'payment_due' as const, value: Number(inv.totalAmount), dueDate, daysLeft: diasEntre(hoje, dueDate) };
  }
}
