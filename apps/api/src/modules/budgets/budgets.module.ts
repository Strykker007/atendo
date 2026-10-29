import {
  BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, OnModuleInit, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsDate, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Budget, Prisma } from '@prisma/client';
import {
  BUDGET_DEFAULT_VALIDITY, BUDGET_GRACE_MINUTES, BUDGET_MAX_HOURS, BUDGET_MAX_ITEMS, BUDGET_MIN_VALIDITY_MIN, BUDGET_RECEIPT_MAX_MB, BUDGET_RECEIPT_MIMES, BUDGET_VALIDITY,
  budgetTotal, isCpfCnpjLength, type BudgetItem, type BudgetStatus, type BudgetValidity, type PixKeyType, type PublicBudget,
} from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { localToUtc, toLocal, TZ_DEFAULT } from '../../common/time';
import { StorageService } from '../../common/storage/storage.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationScopeGuard } from '../conversations/conversation-scope.guard';
import { numberFilter } from '../auth/number-scope';
import { departmentWhere } from '../auth/department-scope';
import { ASAAS_PAID_EVENTS, ASAAS_PAID_STATUSES, ASAAS_REFUND_EVENTS, PaymentGatewayService, PaymentsModule, type AsaasAccount, type AsaasPayment } from '../payments/payments.module';

export const QUEUE_BUDGETS = 'budgets';
const MIN = 60_000;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

class BudgetItemDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(120) dosage?: string;
  @IsInt() @Min(1) @Max(9999) quantity: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) unitPrice: number;
}

class CreateBudgetDto {
  @ValidateNested({ each: true }) @Type(() => BudgetItemDto) @ArrayMinSize(1) @ArrayMaxSize(BUDGET_MAX_ITEMS) items: BudgetItemDto[];
  /** chave Pix cadastrada da empresa — copiada para o orçamento */
  @IsOptional() @IsString() pixKeyId?: string;
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(500) paymentUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** validade da tela (`BUDGET_VALIDITY`); ganha de `validHours`. Nenhum dos dois = até o fim do dia */
  @IsOptional() @IsIn(BUDGET_VALIDITY) validity?: BudgetValidity;
  @IsOptional() @IsInt() @Min(1) @Max(BUDGET_MAX_HOURS) validHours?: number;
  /** Pix automático: cobrança no Asaas da empresa, baixa pelo webhook (recurso `pix_payments`) */
  @IsOptional() @IsBoolean() autoPix?: boolean;
  /** CPF/CNPJ de quem paga (o Asaas exige). Ausente = o da ficha do contato; informado = grava na ficha */
  @IsOptional() @IsString() @MaxLength(20) cpfCnpj?: string;
  /** orçamento por texto: fica esperando a aprovação do cliente, sem link (e sem cobrança) até `approve` */
  @IsOptional() @IsBoolean() quote?: boolean;
}

class UpdateBudgetDto {
  /** atendente confirma o pagamento (ou desfaz, voltando a pendente); EXPIRED descarta orçamento ainda sem aprovação */
  @IsIn(['PENDING', 'PAID', 'EXPIRED']) status: 'PENDING' | 'PAID' | 'EXPIRED';
}

class ListBudgetsDto {
  @IsOptional() @IsIn(['PENDING', 'PAID', 'EXPIRED', 'REFUNDED']) status?: BudgetStatus;
  /** `auto` = Pix automático (Asaas); `fora` = chave/link + comprovante/marcado à mão */
  @IsOptional() @IsIn(['auto', 'fora']) via?: 'auto' | 'fora';
  @IsOptional() @IsString() userId?: string;
  /** período pela criação do orçamento (ISO; `to` exclusivo) */
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

/** 128 bits aleatórios em base64url (22 caracteres): o link é a única credencial da página. */
const newHash = () => randomBytes(16).toString('base64url');
const HASH_RE = /^[A-Za-z0-9_-]{22}$/;

/** Enviado por texto e ainda sem aprovação: não tem link válido nem cobrança. */
const awaitingApproval = (b: Pick<Budget, 'quotedAt' | 'approvedAt'>) => !!b.quotedAt && !b.approvedAt;

/** PENDING vencido conta como EXPIRED mesmo antes de alguém gravar isso. */
const effectiveStatus = (b: Pick<Budget, 'status' | 'expiresAt'>): BudgetStatus =>
  b.status === 'PENDING' && b.expiresAt.getTime() < Date.now() ? 'EXPIRED' : b.status;

/**
 * Orçamentos com link público (docs/orcamentos.md). Nada aqui envia mensagem: o painel monta o
 * texto (orçamento ou link) e envia pelo caminho normal do chat (quota, janela da Meta e ledger).
 */
@Injectable()
export class BudgetsService {
  private readonly log = new Logger(BudgetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: ConversationsGateway,
    private readonly payments: PaymentGatewayService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Pagamento confirmado (webhook do Asaas ou "Marcar como pago"): vira **venda na hora** para o
   * atendente que gerou o orçamento — conta na meta e no faturamento mesmo sem encerramento. O
   * encerramento "Comprou" depois absorve (não soma de novo). Nota interna na conversa para a
   * equipe ver onde está atendendo. Idempotente: webhook repetido não cria segunda venda.
   */
  private async registrarPagamento(b: Budget, via: 'asaas' | 'manual', porUserId?: string, pagoEm?: Date) {
    // hora do pagamento (o aviso pode chegar depois): conta no dia e no mês certos da meta
    const agora = pagoEm ?? new Date();
    const ok = await this.prisma.budget.updateMany({ where: { id: b.id, status: { in: ['PENDING', 'EXPIRED'] } }, data: { status: 'PAID', paidAt: agora, paidVia: via, paidById: porUserId ?? null } });
    if (!ok.count) return false;
    const itens = b.items as unknown as BudgetItem[];
    await this.prisma.sale
      .create({
        data: {
          tenantId: b.tenantId,
          conversationId: b.conversationId,
          contactId: b.contactId,
          userId: b.userId,
          amount: b.totalValue,
          products: itens.map((i) => i.name).join('; ').slice(0, 500) || null,
          items: itens.map((i) => ({ description: `${i.quantity}× ${i.name}${i.dosage ? ` (${i.dosage})` : ''}`.slice(0, 200), value: Math.round(i.quantity * i.unitPrice * 100) / 100 })),
          notes: via === 'asaas' ? 'Orçamento pago via Pix automático (Asaas)' : 'Orçamento marcado como pago',
          closedAt: agora,
          budgetId: b.id,
        },
      })
      .catch((e) => { if ((e as { code?: string }).code !== 'P2002') throw e; });
    const [agente, contato] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: b.userId }, select: { name: true } }),
      this.prisma.contact.findUnique({ where: { id: b.contactId }, select: { name: true, phone: true } }),
    ]);
    const total = Number(b.totalValue);
    // dinheiro recebido sempre vale, mesmo depois do vencimento — mas a equipe precisa saber
    const atrasado = agora.getTime() > b.expiresAt.getTime();
    await this.conversations.systemNote(b.conversationId, `💰 Pagamento confirmado: ${brl(total)} ${via === 'asaas' ? 'via Pix automático (Asaas)' : '(marcado como pago)'} — orçamento de ${agente?.name ?? 'atendente'}.${atrasado ? ' ⚠️ Pago após o vencimento — confira se o pedido ainda vale.' : ''} Já conta como venda; ao encerrar como venda, este valor entra sozinho.`).catch(() => undefined);
    this.gateway.emitBudgets(b.tenantId, b.conversationId, { total, contactName: contato?.name || contato?.phone || '' });
    return true;
  }

  /** Estorno: o orçamento vira REFUNDED e a venda sai da meta e do faturamento (a linha fica, marcada). */
  private async registrarEstorno(b: Budget, origem: string) {
    const agora = new Date();
    const ok = await this.prisma.budget.updateMany({ where: { id: b.id, status: 'PAID' }, data: { status: 'REFUNDED', refundedAt: agora } });
    if (!ok.count) return false;
    await this.prisma.sale.updateMany({ where: { budgetId: b.id, refundedAt: null }, data: { refundedAt: agora } });
    await this.conversations.systemNote(b.conversationId, `↩️ Estorno de ${brl(Number(b.totalValue))} ${origem}. A venda saiu da meta e do faturamento.`).catch(() => undefined);
    this.gateway.emitBudgets(b.tenantId, b.conversationId);
    return true;
  }

  async list(tenantId: string, conversationId: string) {
    const rows = await this.prisma.budget.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { user: { select: { id: true, name: true } } },
    });
    return rows.map((b) => this.present(b));
  }

  async create(user: AuthUser, conversationId: string, dto: CreateBudgetDto) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId: user.tenantId }, select: { contactId: true, contact: { select: { name: true, document: true } } } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');

    let pix: { key: string; keyType: string; holderName: string } | null = null;
    if (dto.pixKeyId) {
      pix = await this.prisma.pixKey.findFirst({ where: { id: dto.pixKeyId, tenantId: user.tenantId }, select: { key: true, keyType: true, holderName: true } });
      if (!pix) throw new BadRequestException('Chave Pix não encontrada');
    }
    const account = dto.autoPix ? await this.payments.accountFor(user.tenantId) : null;
    if (dto.autoPix && !account) throw new BadRequestException('Pix automático indisponível: conecte a conta do Asaas em Configurações → Empresa (recurso do plano).');
    // mini cadastro: o CPF digitado no orçamento fica na ficha; sem ele, vale o da ficha
    const doc = (dto.cpfCnpj ?? conv.contact.document ?? '').replace(/\D/g, '');
    if (dto.autoPix && !isCpfCnpjLength(doc)) throw new BadRequestException('Informe o CPF (11 dígitos) ou CNPJ (14 dígitos) do contato — o Asaas exige para gerar o Pix.');
    if (!dto.autoPix && !pix && !dto.paymentUrl) throw new BadRequestException('Informe uma chave Pix ou um link de pagamento');

    const items: BudgetItem[] = dto.items.map((i) => ({
      name: i.name.trim(),
      ...(i.dosage?.trim() && { dosage: i.dosage.trim() }),
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    }));
    if (items.some((i) => !i.name)) throw new BadRequestException('Todo item precisa de nome');

    const validity = dto.validity ?? (dto.validHours ? null : BUDGET_DEFAULT_VALIDITY);
    const data = {
      tenantId: user.tenantId,
      conversationId,
      contactId: conv.contactId,
      userId: user.id,
      items: items as unknown as Prisma.InputJsonValue,
      totalValue: budgetTotal(items),
      pixKey: pix?.key,
      pixKeyType: pix?.keyType,
      pixHolderName: pix?.holderName,
      paymentUrl: dto.paymentUrl?.trim() || null,
      note: dto.note?.trim() || null,
      expiresAt: await this.vencimento(user.tenantId, dto),
      autoPix: !!dto.autoPix,
      validity,
      quotedAt: dto.quote ? new Date() : null,
    };
    const b = await this.criarNumerado(data);
    if (!account) return this.present(b);

    // orçamento por texto: CPF já vai para a ficha (o erro de digitação aparece agora), mas a
    // cobrança só nasce na aprovação — com o valor e a validade daquele momento
    if (dto.quote) {
      if (doc !== conv.contact.document) await this.prisma.contact.update({ where: { id: conv.contactId }, data: { document: doc } });
      return this.present(b);
    }
    try {
      const comPix = await this.gerarCobranca(b, account, doc, conv.contact.name);
      if (doc !== conv.contact.document) await this.prisma.contact.update({ where: { id: conv.contactId }, data: { document: doc } });
      return this.present(comPix);
    } catch (e) {
      await this.prisma.budget.delete({ where: { id: b.id } });
      throw e;
    }
  }

  /**
   * Número sequencial por empresa ("Orçamento Nº 42"): dois atendentes ao mesmo tempo disputam o
   * mesmo número — o índice único recusa um deles, que tenta o seguinte.
   */
  private async criarNumerado(data: Omit<Prisma.BudgetUncheckedCreateInput, 'hash' | 'number'>) {
    for (let tentativa = 0; ; tentativa++) {
      const ultimo = await this.prisma.budget.aggregate({ where: { tenantId: data.tenantId }, _max: { number: true } });
      try {
        return await this.prisma.budget.create({ data: { ...data, hash: newHash(), number: (ultimo._max.number ?? 0) + 1 }, include: { user: { select: { id: true, name: true } } } });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002' || tentativa >= 4) throw e;
      }
    }
  }

  /**
   * Cobrança Pix no Asaas da empresa. Erro (CPF inválido, conta bloqueada…) sobe para o atendente
   * corrigir, nunca para o cliente na página — quem chama desfaz o que gravou.
   */
  private async gerarCobranca(b: Budget, account: AsaasAccount, doc: string, nomeContato: string | null) {
    const charge = await account.pixCharge({
      customer: await account.customerId(doc, nomeContato?.trim() || 'Cliente'),
      value: Number(b.totalValue),
      // vencimento = dia em que o link expira, no fuso de Brasília
      dueDate: toLocal(b.expiresAt, await this.fuso(b.tenantId)).ymd,
      description: `Orçamento${b.number ? ` Nº ${b.number}` : ''} ${(await this.prisma.tenant.findUnique({ where: { id: b.tenantId }, select: { name: true } }))?.name ?? ''}`.trim().slice(0, 500),
      externalReference: b.id,
    });
    return this.prisma.budget.update({ where: { id: b.id }, data: { gatewayPaymentId: charge.id, pixPayload: charge.payload, pixQrImage: charge.qrImage }, include: { user: { select: { id: true, name: true } } } });
  }

  /**
   * Cliente aprovou o orçamento enviado por texto (docs/orcamentos.md#orçamento-com-aprovação):
   * o link passa a valer, a validade recomeça agora e o Pix automático é gerado com o valor do
   * orçamento aprovado — é sempre o deste id, nunca "o último". Repetir devolve o mesmo, sem nova cobrança.
   */
  async approve(user: AuthUser, conversationId: string, id: string) {
    const b = await this.prisma.budget.findFirst({ where: { id, conversationId, tenantId: user.tenantId } });
    if (!b) throw new NotFoundException('Orçamento não encontrado');
    if (!b.quotedAt) throw new BadRequestException('Este orçamento já foi enviado como link.');
    const inclui = { user: { select: { id: true, name: true } } } as const;
    if (b.approvedAt) {
      // clique duplo / outra aba: o mesmo orçamento, a cobrança que já existe
      if (b.autoPix && !b.gatewayPaymentId) throw new ConflictException('O Pix deste orçamento ainda está sendo gerado. Aguarde alguns segundos.');
      return this.present(await this.prisma.budget.findUniqueOrThrow({ where: { id: b.id }, include: inclui }));
    }
    const status = effectiveStatus(b);
    if (status === 'EXPIRED') throw new BadRequestException(`O Orçamento Nº ${b.number} venceu antes da aprovação. Gere um novo com os valores de hoje.`);
    if (status !== 'PENDING') throw new BadRequestException(`O Orçamento Nº ${b.number} já está ${status === 'PAID' ? 'pago' : 'estornado'}.`);

    const account = b.autoPix ? await this.payments.accountFor(user.tenantId) : null;
    if (b.autoPix && !account) throw new BadRequestException('Pix automático indisponível: conecte a conta do Asaas em Configurações → Empresa (recurso do plano).');
    const contato = await this.prisma.contact.findUnique({ where: { id: b.contactId }, select: { name: true, document: true } });
    const doc = (contato?.document ?? '').replace(/\D/g, '');
    if (b.autoPix && !isCpfCnpjLength(doc)) throw new BadRequestException('Informe o CPF/CNPJ do contato na ficha — o Asaas exige para gerar o Pix.');

    const validity = (BUDGET_VALIDITY as readonly string[]).includes(b.validity ?? '') ? (b.validity as BudgetValidity) : BUDGET_DEFAULT_VALIDITY;
    const expiresAt = await this.vencimento(user.tenantId, { validity });
    // só um clique ganha: o segundo cai no "já aprovado" acima
    const ok = await this.prisma.budget.updateMany({ where: { id: b.id, approvedAt: null, status: 'PENDING' }, data: { approvedAt: new Date(), approvedById: user.id, expiresAt } });
    if (!ok.count) {
      // outro clique aprovou (ou pagou) entre a leitura e aqui: devolve o que ficou, sem nova cobrança
      const atual = await this.prisma.budget.findUniqueOrThrow({ where: { id: b.id }, include: inclui });
      if (!atual.approvedAt) throw new BadRequestException(`O Orçamento Nº ${b.number} mudou de situação. Confira em Desta conversa.`);
      if (atual.autoPix && !atual.gatewayPaymentId) throw new ConflictException('O Pix deste orçamento ainda está sendo gerado. Aguarde alguns segundos.');
      return this.present(atual);
    }
    const aprovado = await this.prisma.budget.findUniqueOrThrow({ where: { id: b.id }, include: inclui });
    if (account) {
      try {
        const comPix = await this.gerarCobranca(aprovado, account, doc, contato?.name ?? null);
        this.gateway.emitBudgets(user.tenantId, conversationId);
        return this.present(comPix);
      } catch (e) {
        // volta a esperar aprovação: o atendente corrige (CPF, conta) e clica de novo
        await this.prisma.budget.update({ where: { id: b.id }, data: { approvedAt: null, approvedById: null, expiresAt: b.expiresAt } });
        throw e;
      }
    }
    this.gateway.emitBudgets(user.tenantId, conversationId);
    return this.present(aprovado);
  }

  async update(user: AuthUser, conversationId: string, id: string, dto: UpdateBudgetDto) {
    const b = await this.prisma.budget.findFirst({ where: { id, conversationId, tenantId: user.tenantId } });
    if (!b) throw new NotFoundException('Orçamento não encontrado');
    if (dto.status === 'EXPIRED') {
      // descartar: o cliente pediu outro orçamento — o antigo sai do atalho e não vira link por engano
      if (!awaitingApproval(b)) throw new BadRequestException('Só dá para descartar orçamento que ainda espera aprovação.');
      await this.prisma.budget.updateMany({ where: { id: b.id, status: 'PENDING', approvedAt: null }, data: { status: 'EXPIRED', expiresAt: new Date() } });
      this.gateway.emitBudgets(user.tenantId, conversationId);
    } else if (dto.status === 'PAID') {
      // pago vale mesmo depois de vencido (o cliente pagou no prazo e mandou o comprovante tarde)
      if (b.status === 'REFUNDED') throw new BadRequestException('Orçamento estornado não volta a ser pago. Gere um novo.');
      await this.registrarPagamento(b, 'manual', user.id);
    } else if (b.status === 'PAID') {
      // desfazer é corrigir um clique errado — não vale para o que o Asaas confirmou nem para o
      // que já entrou num encerramento (aí é estorno)
      if (b.paidVia === 'asaas') throw new BadRequestException('Pagamento confirmado pelo Asaas não se desfaz: use Estornar.');
      if (b.closeEventId) throw new BadRequestException('Este pagamento já entrou num encerramento como venda: use Estornar.');
      await this.prisma.$transaction([
        this.prisma.sale.deleteMany({ where: { budgetId: b.id } }),
        this.prisma.budget.update({ where: { id: b.id }, data: { status: b.expiresAt.getTime() < Date.now() ? 'EXPIRED' : 'PENDING', paidAt: null, paidById: null, paidVia: null } }),
      ]);
      this.gateway.emitBudgets(user.tenantId, conversationId);
    }
    const atual = await this.prisma.budget.findUniqueOrThrow({ where: { id: b.id }, include: { user: { select: { id: true, name: true } } } });
    return this.present(atual);
  }

  /**
   * Estornar (gestão — `settings.manage`). Pix automático: pede o estorno ao Asaas (o dinheiro
   * volta ao cliente) e já registra; o webhook que vier depois não repete. Pago por fora: só registra.
   */
  async refund(user: AuthUser, conversationId: string, id: string) {
    const b = await this.prisma.budget.findFirst({ where: { id, conversationId, tenantId: user.tenantId } });
    if (!b) throw new NotFoundException('Orçamento não encontrado');
    if (b.status !== 'PAID') throw new BadRequestException('Só dá para estornar orçamento pago.');
    if (b.paidVia === 'asaas' && b.gatewayPaymentId) {
      const account = await this.payments.accountOf(user.tenantId);
      if (!account) throw new BadRequestException('Conta do Asaas desconectada: estorne pelo painel do Asaas — a baixa chega pelo webhook.');
      await account.request('POST', `/payments/${b.gatewayPaymentId}/refund`, {});
    }
    await this.registrarEstorno(b, b.paidVia === 'asaas' ? `pedido por ${user.name} (devolvido pelo Asaas)` : `registrado por ${user.name}`);
    const atual = await this.prisma.budget.findUniqueOrThrow({ where: { id: b.id }, include: { user: { select: { id: true, name: true } } } });
    return this.present(atual);
  }

  /**
   * Relatórios → Pagamentos (docs/orcamentos.md#relatório-de-pagamentos): todos os orçamentos do período com filtros
   * e totais por situação. Quem tem `conversations.view_all` vê a equipe (e filtra por atendente);
   * os demais, só os seus. Números e departamentos fora do escopo do usuário ficam de fora, como nas conversas.
   */
  async listAll(user: AuthUser, q: ListBudgetsDto) {
    const verEquipe = user.role === 'super_admin' || !!user.permissions?.includes('conversations.view_all');
    const numeros = numberFilter(user);
    const dept = departmentWhere(user);
    const busca = q.search?.trim();
    const digitos = busca?.replace(/\D/g, '') ?? '';
    const where: Prisma.BudgetWhereInput = {
      tenantId: user.tenantId,
      ...(verEquipe ? (q.userId ? { userId: q.userId } : {}) : { userId: user.id }),
      ...(q.via && { autoPix: q.via === 'auto' }),
      ...((q.from || q.to) && { createdAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
      ...((numeros || dept) && { conversation: { ...(numeros && { numberId: numeros }), ...(dept && { AND: [dept] }) } }),
      ...(busca && { contact: { OR: [{ name: { contains: busca, mode: 'insensitive' as const } }, ...(digitos.length >= 3 ? [{ phone: { contains: digitos } }] : [])] } }),
    };
    const PAGE = 30;
    const page = q.page ?? 1;
    const [rows, total, porStatus, porVia] = await Promise.all([
      this.prisma.budget.findMany({
        where: { ...where, ...(q.status && { status: q.status }) },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { user: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, phone: true } } },
      }),
      this.prisma.budget.count({ where: { ...where, ...(q.status && { status: q.status }) } }),
      // totais ignoram o filtro de situação: os cartões do topo mostram todas, o clique filtra
      this.prisma.budget.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { totalValue: true } }),
      this.prisma.budget.groupBy({ by: ['paidVia'], where: { ...where, status: 'PAID' }, _count: { _all: true }, _sum: { totalValue: true } }),
    ]);
    const soma = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);
    return {
      page,
      pageSize: PAGE,
      total,
      totals: {
        byStatus: Object.fromEntries(porStatus.map((g) => [g.status, { count: g._count._all, value: soma(g._sum.totalValue) }])) as Partial<Record<BudgetStatus, { count: number; value: number }>>,
        paidByVia: Object.fromEntries(porVia.map((g) => [g.paidVia ?? 'manual', { count: g._count._all, value: soma(g._sum.totalValue) }])) as Partial<Record<'asaas' | 'manual', { count: number; value: number }>>,
      },
      rows: rows.map((b) => ({
        ...this.present(b),
        conversationId: b.conversationId,
        contact: b.contact,
        paidAfterExpiry: !!b.paidAt && b.paidAt.getTime() > b.expiresAt.getTime(),
      })),
    };
  }

  // ---- vencimento (docs/orcamentos.md#vencimento) ----

  private async fuso(tenantId: string) {
    return (await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } }))?.timezone || TZ_DEFAULT;
  }

  /** Validade escolhida → instante. "Até o fim do dia" = 23:59:59 no fuso da empresa; nunca menos de 30 min. */
  private async vencimento(tenantId: string, dto: { validity?: BudgetValidity; validHours?: number }) {
    const agora = Date.now();
    const v = dto.validity ?? (dto.validHours ? undefined : BUDGET_DEFAULT_VALIDITY);
    let fim: number;
    if (v === 'end_of_day') {
      const tz = await this.fuso(tenantId);
      fim = localToUtc(toLocal(new Date(agora), tz).ymd, '23:59', tz).getTime() + 59_999;
    } else {
      const horas = v ? Number(v.replace('h', '')) : dto.validHours!;
      fim = agora + horas * 3600_000;
    }
    return new Date(Math.max(fim, agora + BUDGET_MIN_VALIDITY_MIN * MIN));
  }

  /**
   * Quando o cliente pagou, pelo Asaas. A data vem sem hora: sendo hoje (no fuso da empresa), vale
   * agora; sendo de outro dia (aviso atrasado), 23:59:59 daquele dia — a venda cai no dia certo.
   */
  private async pagoEm(tenantId: string, p?: Partial<AsaasPayment>) {
    const dia = p?.clientPaymentDate || p?.paymentDate || p?.confirmedDate;
    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return new Date();
    const tz = await this.fuso(tenantId);
    if (dia >= toLocal(new Date(), tz).ymd) return new Date();
    return new Date(localToUtc(dia, '23:59', tz).getTime() + 59_999);
  }

  /**
   * Rodada de 1 min (job `budgets`):
   * 1. PENDING vencido → EXPIRED (a página já mostrava expirado; isto deixa o banco igual).
   * 2. Pix automático vencido há mais que a tolerância e ainda com cobrança viva: consulta o Asaas —
   *    paga (o cliente colou o código no limite) vira venda; senão, cancela a cobrança e o QR antigo morre.
   * 3. A cada 5 min, confere no Asaas os Pix automáticos das últimas 48 h ainda sem pagamento: webhook
   *    perdido (API fora do ar, rede) não pode deixar dinheiro recebido sem venda.
   */
  async processarVencimentos(agora = new Date()) {
    await this.prisma.budget.updateMany({ where: { status: 'PENDING', expiresAt: { lt: agora } }, data: { status: 'EXPIRED' } });

    const contas = new Map<string, AsaasAccount | null>();
    const contaDe = async (tenantId: string) => {
      if (!contas.has(tenantId)) contas.set(tenantId, await this.payments.accountOf(tenantId));
      return contas.get(tenantId) ?? null;
    };

    const vencidos = await this.prisma.budget.findMany({
      where: { autoPix: true, gatewayPaymentId: { not: null }, gatewayCancelledAt: null, status: { in: ['PENDING', 'EXPIRED'] }, expiresAt: { lt: new Date(agora.getTime() - BUDGET_GRACE_MINUTES * MIN) } },
      orderBy: { expiresAt: 'asc' },
      take: 50,
    });
    for (const b of vencidos) {
      const conta = await contaDe(b.tenantId);
      if (!conta) continue; // desconectou: sem como cancelar — a conferência do webhook continua valendo
      try {
        if (await this.conferirPagamento(b, conta)) continue;
        await conta.request('DELETE', `/payments/${b.gatewayPaymentId}`).catch(async (e) => {
          // recusou cancelar: pode ter sido paga entre a consulta e o cancelamento
          if (await this.conferirPagamento(b, conta)) return;
          throw e;
        });
        await this.prisma.budget.updateMany({ where: { id: b.id, status: { in: ['PENDING', 'EXPIRED'] } }, data: { gatewayCancelledAt: new Date() } });
      } catch (e) {
        this.log.warn(`orçamento ${b.id}: não cancelou a cobrança no Asaas (${e instanceof Error ? e.message : e}) — tenta de novo na próxima rodada`);
      }
    }

    if (agora.getUTCMinutes() % 5 !== 0) return;
    const abertos = await this.prisma.budget.findMany({
      // orçamento aprovado dias depois de criado: a cobrança nasceu na aprovação
      where: { autoPix: true, gatewayPaymentId: { not: null }, status: { in: ['PENDING', 'EXPIRED'] }, OR: [{ createdAt: { gt: new Date(agora.getTime() - 48 * 60 * MIN) } }, { approvedAt: { gt: new Date(agora.getTime() - 48 * 60 * MIN) } }] },
      take: 200,
    });
    for (const b of abertos) {
      const conta = await contaDe(b.tenantId);
      if (conta) await this.conferirPagamento(b, conta).catch((e) => this.log.warn(`orçamento ${b.id}: conferência no Asaas falhou (${e instanceof Error ? e.message : e})`));
    }
  }

  /** Consulta a cobrança; paga → registra a venda (mesmo caminho do webhook). */
  private async conferirPagamento(b: Budget, conta: AsaasAccount) {
    const p = await conta.payment(b.gatewayPaymentId!);
    if (!ASAAS_PAID_STATUSES.includes(p.status)) return false;
    if (await this.registrarPagamento(b, 'asaas', undefined, await this.pagoEm(b.tenantId, p))) this.log.log(`orçamento ${b.id} pago (conferência no Asaas, sem webhook)`);
    return true;
  }

  // ---- público (sem login): o hash é a credencial ----

  async publicView(hash: string): Promise<PublicBudget> {
    const b = await this.findByHash(hash);
    const status = await this.expireIfDue(b);
    const [tenant, contact, agent, settings] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: b.tenantId }, select: { name: true } }),
      this.prisma.contact.findUnique({ where: { id: b.contactId }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: b.userId }, select: { name: true } }),
      // logo da empresa no topo da página (Configurações → Páginas públicas); sem ela, a marca do painel
      this.prisma.tenantSettings.findUnique({ where: { tenantId: b.tenantId }, select: { publicLogoKey: true } }),
    ]);
    // esperando aprovação (itens sensíveis vão só no link): mostra o orçamento, nada de pagamento
    const aguardando = awaitingApproval(b);
    const payable = status === 'PENDING' && !aguardando;
    return {
      number: b.number,
      awaitingApproval: aguardando && status === 'PENDING',
      tenantName: tenant?.name ?? '',
      logoUrl: settings?.publicLogoKey ? this.storage.signedUrl(settings.publicLogoKey, 600) : null,
      contactFirstName: contact?.name?.trim().split(/\s+/)[0] || null,
      agentName: agent?.name?.trim().split(/\s+/)[0] ?? '',
      items: b.items as unknown as BudgetItem[],
      totalValue: Number(b.totalValue),
      status,
      expiresAt: b.expiresAt.toISOString(),
      createdAt: b.createdAt.toISOString(),
      note: b.note,
      pix: payable && b.pixKey ? { key: b.pixKey, keyType: b.pixKeyType as PixKeyType, holderName: b.pixHolderName ?? '' } : null,
      paymentUrl: payable ? b.paymentUrl : null,
      receiptSent: !!b.receiptKey,
      autoPix: b.autoPix,
      pixCharge: payable && b.pixPayload ? { payload: b.pixPayload, qrImage: b.pixQrImage ?? '' } : null,
    };
  }

  /**
   * Webhook do Asaas da empresa. O token do header é o segredo gerado ao conectar; evento de
   * pagamento recebido dá baixa no orçamento pelo id da cobrança — pago vale mesmo vencido.
   */
  async asaasWebhook(gatewayId: string, token: string | undefined, body: { event?: string; payment?: Partial<AsaasPayment> & { externalReference?: string } }) {
    const g = await this.prisma.paymentGateway.findUnique({ where: { id: gatewayId }, select: { tenantId: true, webhookToken: true } });
    if (!g || !token || token.length !== g.webhookToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(g.webhookToken))) {
      this.log.warn(`webhook Pix recusado (gateway ${gatewayId})`);
      return { ok: false };
    }
    const paymentId = body.payment?.id;
    const evento = body.event ?? '';
    if (!paymentId) return { ok: true };
    const b = await this.prisma.budget.findFirst({ where: { tenantId: g.tenantId, gatewayPaymentId: paymentId } });
    if (!b) return { ok: true };

    if ((ASAAS_PAID_EVENTS as readonly string[]).includes(evento)) {
      if (await this.registrarPagamento(b, 'asaas', undefined, await this.pagoEm(b.tenantId, body.payment))) this.log.log(`orçamento ${b.id} pago via Asaas (${paymentId})`);
    } else if (evento === 'PAYMENT_REFUNDED') {
      if (await this.registrarEstorno(b, 'feito no Asaas')) this.log.log(`orçamento ${b.id} estornado no Asaas (${paymentId})`);
    } else if ((ASAAS_REFUND_EVENTS as readonly string[]).includes(evento)) {
      // estorno parcial / em andamento: avisa a equipe; a venda só muda no estorno total
      await this.conversations.systemNote(b.conversationId, `⚠️ Asaas: ${evento === 'PAYMENT_PARTIALLY_REFUNDED' ? 'estorno parcial' : 'estorno em andamento'} do orçamento de ${brl(Number(b.totalValue))}. Confira no Asaas — a venda não foi alterada.`).catch(() => undefined);
    }
    return { ok: true };
  }

  async uploadReceipt(hash: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo ausente (campo "file")');
    const mimeType = file.mimetype.split(';')[0].trim().toLowerCase();
    if (!(BUDGET_RECEIPT_MIMES as readonly string[]).includes(mimeType)) throw new BadRequestException('Envie uma foto (JPG, PNG, WEBP) ou um PDF');
    const b = await this.findByHash(hash);
    if (awaitingApproval(b)) throw new BadRequestException('Este orçamento ainda não foi aprovado. Responda a aprovação no WhatsApp para receber o pagamento.');
    // pago ainda aceita: o cliente pode mandar o comprovante depois de o atendente confirmar
    if ((await this.expireIfDue(b)) === 'EXPIRED') throw new BadRequestException('Este orçamento expirou. Peça um novo ao atendimento.');

    const key = this.storage.makeKey(b.tenantId, mimeType, file.originalname);
    await this.storage.put(key, file.buffer, mimeType);
    await this.prisma.budget.update({
      where: { id: b.id },
      data: { receiptKey: key, receiptMime: mimeType, receiptName: file.originalname.slice(0, 200), receiptAt: new Date() },
    });
    this.gateway.emitBudgets(b.tenantId, b.conversationId);
    return { ok: true };
  }

  private async findByHash(hash: string) {
    // formato errado nem vai ao banco
    const b = HASH_RE.test(hash) ? await this.prisma.budget.findUnique({ where: { hash } }) : null;
    if (!b) throw new NotFoundException('Orçamento não encontrado');
    return b;
  }

  private async expireIfDue(b: Budget): Promise<BudgetStatus> {
    const status = effectiveStatus(b);
    if (status === 'EXPIRED' && b.status === 'PENDING') {
      await this.prisma.budget.updateMany({ where: { id: b.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    }
    return status;
  }

  private present(b: Budget & { user: { id: string; name: string } }) {
    return {
      id: b.id,
      hash: b.hash,
      number: b.number,
      /** enviado por texto, esperando o cliente aprovar (o link ainda não vale) */
      awaitingApproval: awaitingApproval(b),
      quotedAt: b.quotedAt,
      approvedAt: b.approvedAt,
      items: b.items as unknown as BudgetItem[],
      totalValue: Number(b.totalValue),
      status: effectiveStatus(b),
      expiresAt: b.expiresAt,
      createdAt: b.createdAt,
      paidAt: b.paidAt,
      paidVia: b.paidVia,
      refundedAt: b.refundedAt,
      /** já entrou num encerramento como venda */
      absorbed: !!b.closeEventId,
      autoPix: b.autoPix,
      note: b.note,
      pixKey: b.pixKey,
      paymentUrl: b.paymentUrl,
      user: b.user,
      receipt: b.receiptKey
        ? { url: this.storage.signedUrl(b.receiptKey), mimeType: b.receiptMime ?? '', fileName: b.receiptName ?? 'comprovante', at: b.receiptAt }
        : null,
    };
  }
}

/** `:id` = conversa — o ConversationScopeGuard barra número/departamento de fora. */
@Controller('conversations/:id/budgets')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard, ConversationScopeGuard)
class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.budgets.list(u.tenantId, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(u, id, dto);
  }

  @Patch(':budgetId')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('budgetId') budgetId: string, @Body() dto: UpdateBudgetDto) {
    return this.budgets.update(u, id, budgetId, dto);
  }

  /** Cliente aprovou o orçamento por texto: libera o link deste orçamento (e gera o Pix automático). */
  @Post(':budgetId/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('budgetId') budgetId: string) {
    return this.budgets.approve(u, id, budgetId);
  }

  /** Estorno é dinheiro voltando: gestão (`settings.manage`). */
  @Post(':budgetId/refund')
  @RequirePermission('settings.manage')
  refund(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('budgetId') budgetId: string) {
    return this.budgets.refund(u, id, budgetId);
  }
}

/** Relatórios → Pagamentos: lista do período com totais (cada um vê os seus; `view_all` vê a equipe). */
@Controller('budgets')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
class BudgetsListController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  @RequirePermission('reports.view')
  list(@CurrentUser() u: AuthUser, @Query() q: ListBudgetsDto) {
    return this.budgets.listAll(u, q);
  }
}

/** Página pública /o/:hash. Sem login; limite por IP mais apertado que o padrão. */
@Controller('budgets/public/:hash')
class PublicBudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  view(@Param('hash') hash: string) {
    return this.budgets.publicView(hash);
  }

  @Post('receipt')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BUDGET_RECEIPT_MAX_MB * 1024 * 1024, files: 1 } }))
  receipt(@Param('hash') hash: string, @UploadedFile() file?: Express.Multer.File) {
    return this.budgets.uploadReceipt(hash, file);
  }
}

/** Webhook do Asaas de cada empresa — cadastrado sozinho ao conectar (payments.module.ts). Sempre 200: o Asaas pausa a fila depois de falhas seguidas. */
@Controller('webhooks/pix/asaas')
class PixWebhookController {
  constructor(private readonly budgets: BudgetsService) {}

  @Post(':gatewayId')
  @HttpCode(200)
  @SkipThrottle()
  handle(@Param('gatewayId') gatewayId: string, @Headers('asaas-access-token') token: string | undefined, @Body() body: Record<string, unknown>) {
    return this.budgets.asaasWebhook(gatewayId, token, body);
  }
}

/** Vencimento e conferência a cada minuto (`processarVencimentos`). `upsertJobScheduler` é idempotente entre instâncias. */
@Injectable()
class BudgetsScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_BUDGETS) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('budgets-expiry', { every: 60_000 }, { name: 'budgets-expiry' });
  }
}

@Processor(QUEUE_BUDGETS)
class BudgetsProcessor extends TrackedWorkerHost {
  constructor(private readonly budgets: BudgetsService) {
    super(QUEUE_BUDGETS);
  }
  protected async handle(_job: Job) {
    await this.budgets.processarVencimentos();
  }
}

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_BUDGETS, defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50 } }),
    AuthModule,
    ConversationsModule,
    PaymentsModule,
  ],
  controllers: [BudgetsController, BudgetsListController, PublicBudgetsController, PixWebhookController],
  providers: [BudgetsService, BudgetsScheduler, BudgetsProcessor],
})
export class BudgetsModule {}
