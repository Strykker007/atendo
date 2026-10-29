import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { cpfCnpjDigits, isValidCpfCnpj } from '@atendo/shared';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService, senderName } from '../../common/mail/mail.service';
import { UsageService } from './usage.service';
import { ACTIVATION_REF, AsaasService, contractedCharge } from './asaas.service';
import { diaSP } from './monthly-billing';

export type ActivationItemKind = 'setup' | 'first_month' | 'other';
export interface ActivationItem { description: string; value: number; kind: ActivationItemKind }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * Cobrança de ativação do cliente novo (docs/05-planos-e-cobranca.md#cobrança-de-ativação): o dono
 * lança instalação, 1ª mensalidade e o que mais houver; vira um Pix avulso no Asaas da plataforma.
 * Enquanto não paga, a conta configura tudo mas não envia (`subscriptions.awaitingActivation`).
 * A baixa (webhook, consulta do modal ou "marcar como paga") é `AsaasService.completeActivation`.
 */
@Injectable()
export class ActivationService {
  private readonly log = new Logger(ActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    private readonly mail: MailService,
    private readonly usage: UsageService,
  ) {}

  /** Tela do dono: sugestão de itens (1ª mensalidade do valor contratado) + histórico. */
  async get(tenantId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true, tenant: { select: { name: true, document: true } } } });
    if (!sub) throw new NotFoundException('Cliente sem assinatura');
    const charges = await this.prisma.activationCharge.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return {
      asaasConfigured: this.asaas.enabled,
      tenantName: sub.tenant.name,
      document: sub.tenant.document,
      planName: sub.plan.name,
      firstMonthValue: sub.plan.isFree ? 0 : contractedCharge(sub).value,
      awaitingActivation: sub.awaitingActivation,
      charges: charges.map((c) => this.present(c)),
    };
  }

  async create(tenantId: string, userId: string, dto: { items: ActivationItem[]; discount?: number; dueDate?: string; document?: string }) {
    if (!this.asaas.enabled) throw new BadRequestException('Asaas não configurado (ASAAS_API_KEY).');
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { tenant: { select: { document: true } } } });
    if (!sub) throw new NotFoundException('Cliente sem assinatura');
    if (await this.prisma.activationCharge.findFirst({ where: { tenantId, status: 'pending' } })) throw new BadRequestException('Este cliente já tem uma cobrança de ativação em aberto. Cancele antes de gerar outra.');

    const items = dto.items.map((i) => ({ description: i.description.trim(), value: cents(i.value), kind: i.kind })).filter((i) => i.description && i.value > 0);
    if (!items.length) throw new BadRequestException('Lance ao menos um item com valor.');
    const discount = cents(dto.discount ?? 0);
    const total = cents(items.reduce((s, i) => s + i.value, 0) - discount);
    if (total < 5) throw new BadRequestException('O total precisa ser de pelo menos R$ 5,00 (mínimo do Asaas).');
    const hoje = diaSP();
    const dueDate = dto.dueDate ?? hoje;
    if (dueDate < hoje) throw new BadRequestException('O vencimento não pode ser no passado.');

    const doc = cpfCnpjDigits(dto.document ?? sub.tenant.document);
    if (!isValidCpfCnpj(doc)) throw new BadRequestException('Informe um CPF ou CNPJ válido do cliente — o Asaas exige para gerar o Pix.');
    if (doc !== sub.tenant.document) await this.prisma.tenant.update({ where: { id: tenantId }, data: { document: doc } });

    const row = await this.prisma.activationCharge.create({
      data: {
        tenantId,
        items: items as unknown as Prisma.InputJsonValue,
        discount,
        totalValue: total,
        firstMonthValue: cents(items.filter((i) => i.kind === 'first_month').reduce((s, i) => s + i.value, 0)),
        dueDate: new Date(`${dueDate}T23:59:59-03:00`),
        createdById: userId,
      },
    });
    try {
      const customer = await this.asaas.customerFromProfile(tenantId);
      const p = await this.asaas.createPixCharge({
        customer,
        value: total,
        dueDate,
        description: `${senderName()} — ativação: ${items.map((i) => i.description).join(', ')}${discount ? ` (desconto ${brl(discount)})` : ''}`.slice(0, 500),
        externalReference: `${ACTIVATION_REF}${row.id}`,
      });
      await this.prisma.activationCharge.update({ where: { id: row.id }, data: { externalId: p.id, invoiceUrl: p.invoiceUrl ?? null } });
      await this.asaas.mirrorPayment(tenantId, p);
    } catch (e) {
      await this.prisma.activationCharge.delete({ where: { id: row.id } });
      throw e;
    }
    await this.prisma.subscription.update({ where: { tenantId }, data: { awaitingActivation: true } });
    this.log.log(`tenant ${tenantId}: cobrança de ativação ${row.id} de ${brl(total)}, vence ${dueDate}`);

    const to = await this.usage.adminEmails(tenantId);
    if (to.length) {
      this.mail.send({
        to,
        subject: `Ative sua conta ${senderName()}: Pix de ${brl(total)}`,
        text: `Sua conta já está pronta para configurar. Para liberar o envio de mensagens, pague a ativação:

${items.map((i) => `• ${i.description}: ${brl(i.value)}`).join('\n')}${discount ? `\n• Desconto: −${brl(discount)}` : ''}
Total: ${brl(total)} — vence em ${new Date(`${dueDate}T12:00:00-03:00`).toLocaleDateString('pt-BR')}

Pague com Pix pelo painel: ${env.WEB_ORIGIN}/plano?pagar=1

Assim que o pagamento cair, a conta é ativada sozinha.`,
      }).catch(() => undefined);
    }
    return this.get(tenantId);
  }

  /** Cancela o Pix (se ainda não foi pago) e libera a conta do bloqueio da ativação. */
  async cancel(tenantId: string, id: string) {
    const c = await this.prisma.activationCharge.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Cobrança não encontrada');
    if (c.status !== 'pending') throw new BadRequestException('Só dá para cancelar cobrança em aberto.');
    if (c.externalId) {
      // pagou no último segundo: vale o pagamento, não o cancelamento
      const p = await this.asaas.getPayment(c.externalId).catch(() => null);
      if (p && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(p.status)) {
        await this.asaas.mirrorPayment(tenantId, p, 'paid');
        await this.asaas.completeActivation(c.id, 'asaas');
        throw new BadRequestException('Esta cobrança acabou de ser paga — a conta foi ativada.');
      }
      if (p && !p.deleted) await this.asaas.deletePayment(c.externalId);
      await this.prisma.invoice.updateMany({ where: { externalId: c.externalId }, data: { status: 'void' } });
    }
    const ok = await this.prisma.activationCharge.updateMany({ where: { id, status: 'pending' }, data: { status: 'canceled', canceledAt: new Date() } });
    if (ok.count) await this.prisma.subscription.update({ where: { tenantId }, data: { awaitingActivation: false } });
    return this.get(tenantId);
  }

  /** Pagou por fora (transferência, dinheiro): ativa e cancela o Pix no Asaas. */
  async markPaid(tenantId: string, id: string) {
    const c = await this.prisma.activationCharge.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Cobrança não encontrada');
    if (c.status !== 'pending') throw new BadRequestException('Esta cobrança não está em aberto.');
    await this.asaas.completeActivation(c.id, 'manual');
    return this.get(tenantId);
  }

  private present(c: { id: string; items: unknown; discount: unknown; totalValue: unknown; dueDate: Date; status: string; invoiceUrl: string | null; paidAt: Date | null; paidVia: string | null; canceledAt: Date | null; createdAt: Date }) {
    return {
      id: c.id,
      items: c.items as ActivationItem[],
      discount: Number(c.discount),
      totalValue: Number(c.totalValue),
      dueDate: diaSP(c.dueDate),
      status: c.status as 'pending' | 'paid' | 'canceled',
      invoiceUrl: c.invoiceUrl,
      paidAt: c.paidAt,
      paidVia: c.paidVia,
      canceledAt: c.canceledAt,
      createdAt: c.createdAt,
    };
  }
}
