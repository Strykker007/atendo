import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, OnModuleInit, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AI_MODEL_PRICE, aiCostUsd, cpfCnpjDigits, isValidCpfCnpj } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { senderName } from '../../common/mail/mail.service';
import { AppLogger } from '../../common/observability/app-logger';
import { env } from '../../config/env';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AI_CREDIT_REF, AsaasService } from '../billing/asaas.service';
import { diaSP } from '../billing/monthly-billing';
import { creditCharge } from './ai-quota';
import { aiPeriodOf } from './ai-usage.service';

export const AI_CREDIT_MIN = 10;
export const AI_CREDIT_MAX = 5000;
const MARKUP_TTL_MS = 60_000;
const AVG_TTL_MS = 10 * 60_000;
/** sem histórico ainda: estimativa de uma resposta típica (≈ 2.000 tokens de entrada e 300 de saída) */
const TYPICAL_IN = 2000;
const TYPICAL_OUT = 300;

const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const monthRange = (period = aiPeriodOf()) => {
  const [y, m] = period.split('-').map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
};

/**
 * Saldo de IA pré-pago (docs/15-ia.md#saldo-de-ia). O cliente compra em reais por Pix (Asaas da
 * plataforma); cada resposta da IA da plataforma que passa do incluído no plano — ou que entra
 * quando o grátis da chave própria acabou no dia — desconta custo real × (1 + margem). A margem
 * é do dono (`platform_settings.aiCreditMarkupPct`) e nunca aparece para o cliente: ele vê o
 * saldo e quantas respostas, em média, o saldo rende.
 */
@Injectable()
export class AiCreditsService implements OnModuleInit {
  private readonly log = new AppLogger(AiCreditsService.name);
  private markupCache: { pct: number; at: number } | null = null;
  private avgCache: { brl: number; at: number } | null = null;

  constructor(private readonly prisma: PrismaService, private readonly asaas: AsaasService) {}

  /** Pix pago/estornado chega pelo webhook (ou pela consulta do modal) do Asaas. */
  onModuleInit() {
    this.asaas.onReference(AI_CREDIT_REF, async (id, event, paidAt) => {
      if (event === 'paid') await this.applyPaid(id, 'asaas', paidAt);
      else await this.refund(id);
    });
  }

  async markupPct() {
    if (this.markupCache && Date.now() - this.markupCache.at < MARKUP_TTL_MS) return this.markupCache.pct;
    const row = await this.prisma.platformSettings.findUnique({ where: { id: 'default' }, select: { aiCreditMarkupPct: true } });
    const pct = row?.aiCreditMarkupPct ?? 100;
    this.markupCache = { pct, at: Date.now() };
    return pct;
  }

  async wallet(tenantId: string) {
    const w = await this.prisma.aiCreditWallet.findUnique({ where: { tenantId } });
    return { balanceBrl: num(w?.balanceBrl), autoUseOnFreeLimit: w?.autoUseOnFreeLimit ?? true };
  }

  /**
   * Custo real médio de uma resposta (todas as empresas, últimos 30 dias, IA da plataforma). É o
   * que transforma "R$ 50" em "≈ 1.200 respostas". Sem histórico: estimativa pelo modelo padrão.
   */
  async avgInteractionCost() {
    if (this.avgCache && Date.now() - this.avgCache.at < AVG_TTL_MS) return this.avgCache.brl;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const agg = await this.prisma.aiUsage.aggregate({
      where: { occurredAt: { gte: since }, error: null, ownKey: false, kind: { not: 'knowledge' }, costBrl: { gt: 0 } },
      _avg: { costBrl: true },
      _count: { _all: true },
    });
    const model = env.AI_MODEL && AI_MODEL_PRICE[env.AI_MODEL] ? env.AI_MODEL : 'claude-haiku-4-5-20251001';
    const brl = agg._count._all >= 20 ? num(agg._avg.costBrl) : aiCostUsd(model, TYPICAL_IN, TYPICAL_OUT) * env.USD_BRL_RATE;
    this.avgCache = { brl, at: Date.now() };
    return brl;
  }

  /** Tela do cliente: saldo, quanto rende e o que comprou. A margem não sai daqui. */
  async status(tenantId: string) {
    const [w, avg, pct, month, purchases, tenant] = await Promise.all([
      this.wallet(tenantId),
      this.avgInteractionCost(),
      this.markupPct(),
      this.prisma.aiUsage.aggregate({ where: { tenantId, occurredAt: monthRange(), creditBrl: { gt: 0 } }, _sum: { creditBrl: true }, _count: { _all: true } }),
      this.prisma.aiCreditPurchase.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { document: true } }),
    ]);
    const price = creditCharge(avg, pct);
    return {
      balanceBrl: w.balanceBrl,
      autoUseOnFreeLimit: w.autoUseOnFreeLimit,
      /** preço médio de uma resposta já com a margem */
      avgPriceBrl: price,
      estimatedInteractions: price > 0 ? Math.max(0, Math.floor(w.balanceBrl / price)) : 0,
      month: { spentBrl: num(month._sum.creditBrl), interactions: month._count._all },
      purchases: purchases.map((p) => ({ id: p.id, amountBrl: num(p.amountBrl), status: p.status, paidVia: p.paidVia, externalId: p.externalId, note: p.note, paidAt: p.paidAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString() })),
      limits: { min: AI_CREDIT_MIN, max: AI_CREDIT_MAX },
      hasDocument: isValidCpfCnpj(cpfCnpjDigits(tenant.document)),
    };
  }

  async setAutoUse(tenantId: string, on: boolean) {
    await this.prisma.aiCreditWallet.upsert({ where: { tenantId }, create: { tenantId, autoUseOnFreeLimit: on }, update: { autoUseOnFreeLimit: on } });
    return this.status(tenantId);
  }

  /** Gera o Pix avulso no Asaas da plataforma. O saldo entra quando o pagamento cai. */
  async purchase(tenantId: string, userId: string, amount: number, document?: string) {
    const value = Math.round(amount * 100) / 100;
    if (value < AI_CREDIT_MIN || value > AI_CREDIT_MAX) throw new BadRequestException(`A compra precisa ser entre R$ ${AI_CREDIT_MIN} e R$ ${AI_CREDIT_MAX}.`);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { document: true } });
    const doc = cpfCnpjDigits(document ?? tenant.document);
    if (!isValidCpfCnpj(doc)) throw new BadRequestException('Informe o CPF ou CNPJ da empresa: o Asaas exige para gerar o Pix.');
    if (doc !== tenant.document) await this.prisma.tenant.update({ where: { id: tenantId }, data: { document: doc } });
    // um Pix em aberto por vez: clicar duas vezes não gera duas cobranças
    const open = await this.prisma.aiCreditPurchase.findFirst({ where: { tenantId, status: 'pending', externalId: { not: null } }, orderBy: { createdAt: 'desc' } });
    if (open) await this.cancel(tenantId, open.id).catch(() => undefined);

    const row = await this.prisma.aiCreditPurchase.create({ data: { tenantId, amountBrl: value, createdById: userId } });
    try {
      const customer = await this.asaas.customerFromProfile(tenantId);
      const p = await this.asaas.createPixCharge({ customer, value, dueDate: diaSP(), description: `${senderName()} — saldo de IA`, externalReference: `${AI_CREDIT_REF}${row.id}` });
      await this.prisma.aiCreditPurchase.update({ where: { id: row.id }, data: { externalId: p.id, invoiceUrl: p.invoiceUrl ?? null } });
      await this.asaas.mirrorPayment(tenantId, p);
      this.log.log(`tenant ${tenantId}: Pix de saldo de IA ${row.id} de R$ ${value}`);
      return { purchaseId: row.id, payment: await this.asaas.view(tenantId, p, true) };
    } catch (e) {
      await this.prisma.aiCreditPurchase.delete({ where: { id: row.id } });
      throw e;
    }
  }

  /** Pagou: entra no saldo uma vez só (webhook e consulta do modal chegam juntos). */
  async applyPaid(purchaseId: string, via: 'asaas' | 'manual', paidAt = new Date()) {
    const claimed = await this.prisma.aiCreditPurchase.updateMany({ where: { id: purchaseId, status: 'pending' }, data: { status: 'paid', paidAt, paidVia: via } });
    if (!claimed.count) return;
    const p = await this.prisma.aiCreditPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    await this.prisma.aiCreditWallet.upsert({ where: { tenantId: p.tenantId }, create: { tenantId: p.tenantId, balanceBrl: p.amountBrl }, update: { balanceBrl: { increment: p.amountBrl } } });
    this.log.log(`tenant ${p.tenantId}: +R$ ${num(p.amountBrl)} de saldo de IA (${via})`);
  }

  /** Estorno no Asaas: tira do saldo o que tinha entrado (pode ficar negativo se já foi gasto). */
  private async refund(purchaseId: string) {
    const claimed = await this.prisma.aiCreditPurchase.updateMany({ where: { id: purchaseId, status: 'paid' }, data: { status: 'canceled' } });
    if (!claimed.count) return;
    const p = await this.prisma.aiCreditPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    await this.prisma.aiCreditWallet.updateMany({ where: { tenantId: p.tenantId }, data: { balanceBrl: { decrement: p.amountBrl } } });
    this.log.warn(`tenant ${p.tenantId}: Pix de saldo de IA ${purchaseId} estornado (−R$ ${num(p.amountBrl)})`);
  }

  async cancel(tenantId: string, id: string) {
    const c = await this.prisma.aiCreditPurchase.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Compra não encontrada');
    if (c.status !== 'pending') throw new BadRequestException('Só dá para cancelar compra em aberto.');
    if (c.externalId) {
      const p = await this.asaas.getPayment(c.externalId).catch(() => null);
      if (p && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(p.status)) {
        await this.asaas.mirrorPayment(tenantId, p, 'paid');
        await this.applyPaid(c.id, 'asaas');
        throw new BadRequestException('Este Pix acabou de ser pago: o saldo já entrou.');
      }
      if (p && !p.deleted) await this.asaas.deletePayment(c.externalId).catch(() => undefined);
      await this.prisma.invoice.updateMany({ where: { externalId: c.externalId }, data: { status: 'void' } });
    }
    await this.prisma.aiCreditPurchase.updateMany({ where: { id, status: 'pending' }, data: { status: 'canceled' } });
    return this.status(tenantId);
  }

  // ---------- dono do sistema ----------

  /** Lançamento do dono: cortesia, pagamento por fora ou correção (valor negativo tira). */
  async grant(tenantId: string, userId: string, amount: number, note?: string) {
    const value = Math.round(amount * 100) / 100;
    if (!value) throw new BadRequestException('Informe um valor diferente de zero.');
    await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true } });
    const row = await this.prisma.aiCreditPurchase.create({ data: { tenantId, amountBrl: value, createdById: userId, note: note?.trim() || null } });
    await this.applyPaid(row.id, 'manual');
    return this.wallet(tenantId);
  }

  async setMarkup(pct: number) {
    await this.prisma.platformSettings.upsert({ where: { id: 'default' }, create: { id: 'default', aiCreditMarkupPct: pct }, update: { aiCreditMarkupPct: pct } });
    this.markupCache = null;
    return this.overview();
  }

  /** Painel do dono: margem, vendido, consumido, custo real, lucro e saldos em aberto. */
  async overview(period = aiPeriodOf()) {
    const range = monthRange(period);
    const [pct, avg, sold, used, wallets, recent] = await Promise.all([
      this.markupPct(),
      this.avgInteractionCost(),
      this.prisma.aiCreditPurchase.aggregate({ where: { status: 'paid', paidVia: 'asaas', paidAt: range }, _sum: { amountBrl: true }, _count: { _all: true } }),
      this.prisma.aiUsage.aggregate({ where: { occurredAt: range, creditBrl: { gt: 0 } }, _sum: { creditBrl: true, costBrl: true }, _count: { _all: true } }),
      this.prisma.aiCreditWallet.aggregate({ _sum: { balanceBrl: true } }),
      this.prisma.aiCreditPurchase.findMany({ where: { status: { in: ['paid', 'pending'] } }, orderBy: { createdAt: 'desc' }, take: 20, include: { tenant: { select: { name: true } } } }),
    ]);
    const consumed = num(used._sum.creditBrl);
    const cost = num(used._sum.costBrl);
    return {
      period,
      markupPct: pct,
      avgCostBrl: avg,
      avgPriceBrl: creditCharge(avg, pct),
      soldBrl: num(sold._sum.amountBrl),
      soldCount: sold._count._all,
      consumedBrl: consumed,
      consumedInteractions: used._count._all,
      costBrl: cost,
      profitBrl: consumed - cost,
      /** saldo que os clientes ainda têm para gastar (já recebido, ainda não consumido) */
      outstandingBrl: num(wallets._sum.balanceBrl),
      recent: recent.map((p) => ({ id: p.id, tenantId: p.tenantId, tenantName: p.tenant.name, amountBrl: num(p.amountBrl), status: p.status, paidVia: p.paidVia, note: p.note, createdAt: p.createdAt.toISOString() })),
    };
  }
}

class PurchaseDto {
  @IsNumber() @Min(AI_CREDIT_MIN) @Max(AI_CREDIT_MAX) amountBrl: number;
  @IsOptional() @IsString() @MaxLength(20) document?: string;
}
class AutoUseDto {
  @IsBoolean() autoUseOnFreeLimit: boolean;
}
class MarkupDto {
  @IsNumber() @Min(0) @Max(1000) markupPct: number;
}
class GrantDto {
  @IsNumber() @Min(-AI_CREDIT_MAX) @Max(AI_CREDIT_MAX) amountBrl: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/** Quem compra é quem cuida da conta e do pagamento: `billing.manage`. */
@Controller('ai/credits')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermission('billing.manage')
export class AiCreditsController {
  constructor(private readonly credits: AiCreditsService) {}

  @Get()
  status(@CurrentUser() u: AuthUser) {
    return this.credits.status(u.tenantId);
  }

  @Put('settings')
  settings(@CurrentUser() u: AuthUser, @Body() dto: AutoUseDto) {
    return this.credits.setAutoUse(u.tenantId, dto.autoUseOnFreeLimit);
  }

  @Post('purchase')
  purchase(@CurrentUser() u: AuthUser, @Body() dto: PurchaseDto) {
    return this.credits.purchase(u.tenantId, u.id, dto.amountBrl, dto.document);
  }

  @Delete('purchase/:id')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.credits.cancel(u.tenantId, id);
  }
}

/** Painel do dono: margem e lançamentos. */
@Controller('admin/ai-credits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class AiCreditsAdminController {
  constructor(private readonly credits: AiCreditsService) {}

  @Get()
  overview() {
    return this.credits.overview();
  }

  @Put('markup')
  markup(@Body() dto: MarkupDto) {
    return this.credits.setMarkup(Math.round(dto.markupPct));
  }

  @Post('tenants/:tenantId/grant')
  grant(@CurrentUser() u: AuthUser, @Param('tenantId') tenantId: string, @Body() dto: GrantDto) {
    return this.credits.grant(tenantId, u.id, dto.amountBrl, dto.note);
  }
}
