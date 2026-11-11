import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { phoneVariants } from '../conversations/phone-variants';
import { exemptMode, normalizeExemptPhone } from './ignored-contacts';

class CreateIgnoredDto {
  /** telefone digitado (com DDI) — ou `contactId` de um contato existente */
  @ValidateIf((o: CreateIgnoredDto) => !o.contactId) @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  /** conversa livre: sempre aberta, sem dono, ninguém encerra (docs/contatos-isentos.md#conversa-livre) */
  @IsOptional() @IsBoolean() freeChat?: boolean;
}

class UpdateIgnoredDto {
  @IsBoolean() freeChat!: boolean;
}

/**
 * Contatos isentos de ticket (docs/contatos-isentos.md). O admin lista telefones — diretoria,
 * fornecedor, o próprio celular da loja — cuja mensagem nunca abre atendimento: entra como chat
 * livre (aba "Livres"), sem fila, sem automação e fora dos relatórios de desempenho.
 */
@Controller('ignored-contacts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
class IgnoredContactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ConversationsGateway,
  ) {}

  @Get()
  @RequirePermission('settings.manage')
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.ignoredContact.findMany({ where: { tenantId: u.tenantId }, orderBy: { createdAt: 'desc' } });
    // nome do contato, quando ele já existe (mesmo telefone, com ou sem o nono dígito)
    const contatos = await this.prisma.contact.findMany({
      where: { tenantId: u.tenantId, phone: { in: rows.flatMap((r) => phoneVariants(r.phone)) } },
      select: { id: true, name: true, phone: true },
    });
    return rows.map((r) => {
      const formas = new Set(phoneVariants(r.phone));
      const c = contatos.find((x) => formas.has(x.phone));
      return { ...r, contact: c ?? null };
    });
  }

  @Post()
  @RequirePermission('settings.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateIgnoredDto) {
    let phone = normalizeExemptPhone(dto.phone ?? '');
    let label = dto.label?.trim() || null;
    if (dto.contactId) {
      const c = await this.prisma.contact.findFirst({ where: { id: dto.contactId, tenantId: u.tenantId }, select: { phone: true, name: true } });
      if (!c) throw new NotFoundException('Contato não encontrado');
      phone = normalizeExemptPhone(c.phone);
      label ??= c.name;
    }
    if (phone.length < 8 || phone.length > 15) throw new BadRequestException('Telefone inválido. Use o número com DDI e DDD (ex.: 5511999998888).');
    const ja = await this.prisma.ignoredContact.findFirst({ where: { tenantId: u.tenantId, phone: { in: phoneVariants(phone) } }, select: { id: true } });
    if (ja) throw new ConflictException('Este telefone já está na lista.');
    const row = await this.prisma.ignoredContact.create({ data: { tenantId: u.tenantId, phone, label, createdById: u.id, freeChat: !!dto.freeChat } });
    await this.marcarConversas(u.tenantId, phone);
    return row;
  }

  /** Liga/desliga "Conversa livre" de quem já está na lista. */
  @Patch(':id')
  @RequirePermission('settings.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIgnoredDto) {
    const row = await this.prisma.ignoredContact.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!row) throw new NotFoundException('Registro não encontrado');
    const saved = await this.prisma.ignoredContact.update({ where: { id: row.id }, data: { freeChat: dto.freeChat } });
    await this.marcarConversas(u.tenantId, row.phone);
    return saved;
  }

  /**
   * Tirar da lista pelo contato — o atalho da conversa aberta e do card, que não conhecem o id do
   * registro. Número da própria conta é isento sem estar na lista: aí não há o que tirar (409).
   */
  @Delete('contact/:contactId')
  @RequirePermission('settings.manage')
  async removeByContact(@CurrentUser() u: AuthUser, @Param('contactId', ParseUUIDPipe) contactId: string) {
    const c = await this.prisma.contact.findFirst({ where: { id: contactId, tenantId: u.tenantId }, select: { phone: true } });
    if (!c) throw new NotFoundException('Contato não encontrado');
    const variants = phoneVariants(normalizeExemptPhone(c.phone));
    const rows = await this.prisma.ignoredContact.findMany({ where: { tenantId: u.tenantId, phone: { in: variants } } });
    if (!rows.length) {
      const own = await this.prisma.whatsAppNumber.findFirst({ where: { tenantId: u.tenantId, deletedAt: null, phone: { in: variants } }, select: { id: true } });
      if (own) throw new ConflictException('Este é um número da própria conta: conversa entre números da loja nunca abre atendimento.');
      throw new NotFoundException('Este contato não está na lista de isentos.');
    }
    await this.prisma.ignoredContact.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    for (const r of rows) await this.marcarConversas(u.tenantId, r.phone);
    return { ok: true };
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.prisma.ignoredContact.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!row) throw new NotFoundException('Registro não encontrado');
    await this.prisma.ignoredContact.delete({ where: { id: row.id } });
    await this.marcarConversas(u.tenantId, row.phone);
    return { ok: true };
  }

  /**
   * Aplica a regra (depois de mexer na lista) às conversas que já existem com este telefone:
   * - isento comum: só troca a marca. Status, dono e espera ficam — aguardando continua aguardando
   *   até alguém assumir, e segue Atendendo → Encerrado; a marca só tira dos relatórios;
   * - conversa livre: todas ficam abertas e sem dono, inclusive as encerradas (ninguém mais encerra);
   * - saiu da lista ou deixou de ser livre: a conversa livre (aberta sem dono) volta para a fila.
   */
  private async marcarConversas(tenantId: string, phone: string) {
    const modo = await exemptMode(this.prisma, tenantId, phone);
    const convs = await this.prisma.conversation.findMany({
      where: { tenantId, contact: { phone: { in: phoneVariants(phone) }, isGroup: false } },
      select: { id: true, status: true, assigneeId: true, ticketExempt: true },
    });
    for (const c of convs) {
      const livreHoje = c.ticketExempt && c.status === 'in_progress' && !c.assigneeId;
      let data: { ticketExempt: boolean; status?: 'in_progress' | 'waiting'; assigneeId?: null; awaitingSince?: null } | null = null;
      if (modo === 'free') {
        if (!livreHoje) data = { ticketExempt: true, status: 'in_progress', assigneeId: null, awaitingSince: null };
      } else if (c.ticketExempt !== (modo === 'exempt') || livreHoje) {
        data = { ticketExempt: modo === 'exempt', ...(livreHoje && { status: 'waiting' as const }) };
      }
      if (!data) continue;
      const updated = await this.prisma.conversation.update({ where: { id: c.id }, data });
      this.gateway.emitConversation(tenantId, updated);
    }
  }
}

@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [IgnoredContactsController],
})
export class IgnoredContactsModule {}
