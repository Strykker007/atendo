import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { phoneVariants } from '../conversations/phone-variants';
import { normalizeExemptPhone } from './ignored-contacts';

class CreateIgnoredDto {
  /** telefone digitado (com DDI) — ou `contactId` de um contato existente */
  @ValidateIf((o: CreateIgnoredDto) => !o.contactId) @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string;
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
    const row = await this.prisma.ignoredContact.create({ data: { tenantId: u.tenantId, phone, label, createdById: u.id } });
    await this.marcarConversas(u.tenantId, phone, true);
    return row;
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.prisma.ignoredContact.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!row) throw new NotFoundException('Registro não encontrado');
    await this.prisma.ignoredContact.delete({ where: { id: row.id } });
    await this.marcarConversas(u.tenantId, row.phone, false);
    return { ok: true };
  }

  /**
   * Aplica a regra às conversas que já existem com este telefone.
   * - Entrou na lista: vira chat livre na hora — sai da fila e de quem estava atendendo (conversa
   *   livre não tem dono; qualquer um da equipe responde).
   * - Saiu da lista: a conversa livre é guardada como encerrada, sem evento de encerramento (não
   *   foi atendimento). A próxima mensagem do contato abre ticket normalmente.
   */
  private async marcarConversas(tenantId: string, phone: string, exempt: boolean) {
    const convs = await this.prisma.conversation.findMany({
      where: { tenantId, ticketExempt: !exempt, contact: { phone: { in: phoneVariants(phone) } } },
      select: { id: true, status: true },
    });
    for (const c of convs) {
      const updated = await this.prisma.conversation.update({
        where: { id: c.id },
        data: exempt
          ? { ticketExempt: true, status: 'in_progress', assigneeId: null, awaitingSince: null }
          : { ticketExempt: false, ...(c.status !== 'closed' && { status: 'closed', closedAt: new Date(), assigneeId: null, awaitingSince: null }) },
      });
      this.gateway.emitConversation(tenantId, updated);
    }
  }
}

@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [IgnoredContactsController],
})
export class IgnoredContactsModule {}
