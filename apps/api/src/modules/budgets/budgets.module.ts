import {
  BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { randomBytes } from 'node:crypto';
import type { Budget, Prisma } from '@prisma/client';
import {
  BUDGET_DEFAULT_HOURS, BUDGET_MAX_HOURS, BUDGET_MAX_ITEMS, BUDGET_RECEIPT_MAX_MB, BUDGET_RECEIPT_MIMES, budgetTotal,
  type BudgetItem, type BudgetStatus, type PixKeyType, type PublicBudget,
} from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { ConversationScopeGuard } from '../conversations/conversation-scope.guard';

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
  @IsOptional() @IsInt() @Min(1) @Max(BUDGET_MAX_HOURS) validHours?: number;
}

class UpdateBudgetDto {
  /** atendente confirma o pagamento (ou desfaz, voltando a pendente) */
  @IsIn(['PENDING', 'PAID']) status: 'PENDING' | 'PAID';
}

/** 128 bits aleatórios em base64url (22 caracteres): o link é a única credencial da página. */
const newHash = () => randomBytes(16).toString('base64url');
const HASH_RE = /^[A-Za-z0-9_-]{22}$/;

/** PENDING vencido conta como EXPIRED mesmo antes de alguém gravar isso. */
const effectiveStatus = (b: Pick<Budget, 'status' | 'expiresAt'>): BudgetStatus =>
  b.status === 'PENDING' && b.expiresAt.getTime() < Date.now() ? 'EXPIRED' : b.status;

/**
 * Orçamentos com link público (docs/orcamentos.md). Nada aqui envia mensagem: o painel só
 * recebe o link e coloca o texto no campo — o envio segue o caminho normal do chat (quota,
 * janela da Meta e ledger).
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: ConversationsGateway,
  ) {}

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
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId: user.tenantId }, select: { contactId: true } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');

    let pix: { key: string; keyType: string; holderName: string } | null = null;
    if (dto.pixKeyId) {
      pix = await this.prisma.pixKey.findFirst({ where: { id: dto.pixKeyId, tenantId: user.tenantId }, select: { key: true, keyType: true, holderName: true } });
      if (!pix) throw new BadRequestException('Chave Pix não encontrada');
    }
    if (!pix && !dto.paymentUrl) throw new BadRequestException('Informe uma chave Pix ou um link de pagamento');

    const items: BudgetItem[] = dto.items.map((i) => ({
      name: i.name.trim(),
      ...(i.dosage?.trim() && { dosage: i.dosage.trim() }),
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    }));
    if (items.some((i) => !i.name)) throw new BadRequestException('Todo item precisa de nome');

    const b = await this.prisma.budget.create({
      data: {
        tenantId: user.tenantId,
        conversationId,
        contactId: conv.contactId,
        userId: user.id,
        hash: newHash(),
        items: items as unknown as Prisma.InputJsonValue,
        totalValue: budgetTotal(items),
        pixKey: pix?.key,
        pixKeyType: pix?.keyType,
        pixHolderName: pix?.holderName,
        paymentUrl: dto.paymentUrl?.trim() || null,
        note: dto.note?.trim() || null,
        expiresAt: new Date(Date.now() + (dto.validHours ?? BUDGET_DEFAULT_HOURS) * 3600_000),
      },
      include: { user: { select: { id: true, name: true } } },
    });
    return this.present(b);
  }

  async update(user: AuthUser, conversationId: string, id: string, dto: UpdateBudgetDto) {
    const b = await this.prisma.budget.findFirst({ where: { id, conversationId, tenantId: user.tenantId } });
    if (!b) throw new NotFoundException('Orçamento não encontrado');
    // pago vale mesmo depois de vencido (o cliente pagou no prazo e mandou o comprovante tarde);
    // desfazer o pago de um vencido volta a ser expirado
    const status = dto.status === 'PAID' ? 'PAID' : b.expiresAt.getTime() < Date.now() ? 'EXPIRED' : 'PENDING';
    const updated = await this.prisma.budget.update({
      where: { id: b.id },
      data: { status, paidAt: status === 'PAID' ? new Date() : null, paidById: status === 'PAID' ? user.id : null },
      include: { user: { select: { id: true, name: true } } },
    });
    this.gateway.emitBudgets(user.tenantId, conversationId);
    return this.present(updated);
  }

  // ---- público (sem login): o hash é a credencial ----

  async publicView(hash: string): Promise<PublicBudget> {
    const b = await this.findByHash(hash);
    const status = await this.expireIfDue(b);
    const [tenant, contact, agent] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: b.tenantId }, select: { name: true } }),
      this.prisma.contact.findUnique({ where: { id: b.contactId }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: b.userId }, select: { name: true } }),
    ]);
    const payable = status === 'PENDING';
    return {
      tenantName: tenant?.name ?? '',
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
    };
  }

  async uploadReceipt(hash: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo ausente (campo "file")');
    const mimeType = file.mimetype.split(';')[0].trim().toLowerCase();
    if (!(BUDGET_RECEIPT_MIMES as readonly string[]).includes(mimeType)) throw new BadRequestException('Envie uma foto (JPG, PNG, WEBP) ou um PDF');
    const b = await this.findByHash(hash);
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
      items: b.items as unknown as BudgetItem[],
      totalValue: Number(b.totalValue),
      status: effectiveStatus(b),
      expiresAt: b.expiresAt,
      createdAt: b.createdAt,
      paidAt: b.paidAt,
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

@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [BudgetsController, PublicBudgetsController],
  providers: [BudgetsService],
})
export class BudgetsModule {}
