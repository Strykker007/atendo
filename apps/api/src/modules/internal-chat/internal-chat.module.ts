import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';

class CreateChatDto {
  /** outros membros (quem cria entra sozinho). Um id e sem nome = conversa direta */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsUUID('all', { each: true }) userIds: string[];
  /** nome do grupo; obrigatório com mais de um membro */
  @IsOptional() @IsString() @MaxLength(60) name?: string;
}
class SendDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) text: string;
}
class PageQuery {
  /** mensagens anteriores a este instante (rolar para cima) */
  @IsOptional() @IsISO8601() before?: string;
}
class AuditQuery {
  /** só as conversas de que esta pessoa participa */
  @IsOptional() @IsUUID() userId?: string;
}

const PAGE = 50;
const MEMBER_SELECT = { userId: true, lastReadAt: true, user: { select: { id: true, name: true, isActive: true } } } as const;

type ChatRow = Prisma.InternalChatGetPayload<{ include: { members: { select: typeof MEMBER_SELECT } } }>;

/**
 * Chat interno da equipe (docs/chat-interno.md): conversa direta ou em grupo entre membros do
 * mesmo cliente. Fica no banco para sempre — não há apagar nem editar — e quem tem
 * `internal_chat.audit` lê qualquer conversa pela tela de auditoria. Nada daqui vai ao
 * WhatsApp: não passa pela fila de saída nem pelo ledger de uso.
 */
@Controller('internal-chat')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
class InternalChatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Equipe para iniciar conversa: ativos do cliente, com quem está com o painel aberto agora. */
  @Get('users')
  async users(@CurrentUser() u: AuthUser) {
    const [rows, presenca] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId: u.tenantId, isActive: true, id: { not: u.id } }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
      this.gateway.presence(),
    ]);
    const online = presenca.get(u.tenantId) ?? new Set<string>();
    return rows.map((r) => ({ ...r, online: online.has(r.id) })).sort((a, b) => Number(b.online) - Number(a.online));
  }

  /** Minhas conversas, mais recentes primeiro, com as não lidas. */
  @Get('chats')
  async chats(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.internalChat.findMany({
      where: { tenantId: u.tenantId, members: { some: { userId: u.id } } },
      include: { members: { select: MEMBER_SELECT } },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 100,
    });
    const naoLidas = rows.length
      ? await this.prisma.$queryRaw<{ chatId: string; n: number }[]>(Prisma.sql`
          select m."chatId", count(*)::int as n
          from internal_messages m
          join internal_chat_members cm on cm."chatId" = m."chatId" and cm."userId" = ${u.id}
          where m."tenantId" = ${u.tenantId} and m."chatId" in (${Prisma.join(rows.map((r) => r.id))})
            and (cm."lastReadAt" is null or m."createdAt" > cm."lastReadAt")
            and m."authorId" is distinct from ${u.id}
          group by 1`)
      : [];
    const unread = new Map(naoLidas.map((r) => [r.chatId, Number(r.n)]));
    return rows.map((c) => ({ ...this.present(c, u.id), unread: unread.get(c.id) ?? 0 }));
  }

  /**
   * Abre conversa. Direta (um membro, sem nome): devolve a que já existe com a pessoa — uma só
   * por par. Grupo: sempre uma nova, com nome.
   */
  @Post('chats')
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateChatDto) {
    await this.assertMember(u);
    const outros = [...new Set(dto.userIds.filter((id) => id !== u.id))];
    if (!outros.length) throw new BadRequestException('Escolha ao menos uma pessoa.');
    const validos = await this.prisma.user.count({ where: { id: { in: outros }, tenantId: u.tenantId, isActive: true } });
    if (validos !== outros.length) throw new BadRequestException('Alguém da lista não faz parte da equipe.');
    const name = dto.name?.trim();
    const include = { members: { select: MEMBER_SELECT } };

    if (outros.length === 1 && !name) {
      const directKey = [u.id, outros[0]].sort().join(':');
      const chat = await this.prisma.internalChat.upsert({
        where: { tenantId_directKey: { tenantId: u.tenantId, directKey } },
        create: { tenantId: u.tenantId, directKey, createdById: u.id, members: { create: [{ userId: u.id }, { userId: outros[0] }] } },
        update: {},
        include,
      });
      return { ...this.present(chat, u.id), unread: 0 };
    }
    if (!name) throw new BadRequestException('Dê um nome ao grupo.');
    const chat = await this.prisma.internalChat.create({
      data: { tenantId: u.tenantId, isGroup: true, name, createdById: u.id, members: { create: [u.id, ...outros].map((userId) => ({ userId })) } },
      include,
    });
    this.gateway.emitInternalChat(u.tenantId, outros, chat.id);
    return { ...this.present(chat, u.id), unread: 0 };
  }

  @Get('chats/:id/messages')
  async messages(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    await this.chatOf(u, id);
    return this.page(id, q.before);
  }

  @Post('chats/:id/messages')
  async send(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendDto) {
    const chat = await this.chatOf(u, id);
    const author = await this.assertMember(u);
    const text = dto.text.trim();
    if (!text) throw new BadRequestException('Mensagem vazia.');
    const agora = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.internalMessage.create({ data: { tenantId: u.tenantId, chatId: chat.id, authorId: u.id, authorName: author.name, text, createdAt: agora } }),
      this.prisma.internalChat.update({ where: { id: chat.id }, data: { lastMessageAt: agora, lastMessagePreview: `${author.name}: ${text}`.slice(0, 140) } }),
      // quem escreve leu tudo até aqui
      this.prisma.internalChatMember.update({ where: { chatId_userId: { chatId: chat.id, userId: u.id } }, data: { lastReadAt: agora } }),
    ]);
    this.gateway.emitInternalMessage(u.tenantId, chat.members.map((m) => m.userId), message);
    return message;
  }

  @Post('chats/:id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.chatOf(u, id);
    await this.prisma.internalChatMember.update({ where: { chatId_userId: { chatId: id, userId: u.id } }, data: { lastReadAt: new Date() } });
    this.gateway.emitInternalChat(u.tenantId, [u.id], id);
    return { ok: true };
  }

  // ---------- auditoria ----------

  /** Todas as conversas internas do cliente (ou só as de uma pessoa), para quem audita. */
  @Get('audit/chats')
  @RequirePermission('internal_chat.audit')
  async auditChats(@CurrentUser() u: AuthUser, @Query() q: AuditQuery) {
    const rows = await this.prisma.internalChat.findMany({
      where: { tenantId: u.tenantId, ...(q.userId && { members: { some: { userId: q.userId } } }) },
      include: { members: { select: MEMBER_SELECT }, _count: { select: { messages: true } } },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((c) => ({ ...this.present(c, null), messages: c._count.messages, createdAt: c.createdAt }));
  }

  /** Histórico completo de qualquer conversa do cliente — leitura não marca como lida. */
  @Get('audit/chats/:id/messages')
  @RequirePermission('internal_chat.audit')
  async auditMessages(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    const chat = await this.prisma.internalChat.findFirst({ where: { id, tenantId: u.tenantId }, select: { id: true } });
    if (!chat) throw new NotFoundException('Conversa não encontrada');
    return this.page(id, q.before);
  }

  // ---------- apoio ----------

  /** Página de mensagens em ordem cronológica (as 50 anteriores a `before`). */
  private async page(chatId: string, before?: string) {
    const rows = await this.prisma.internalMessage.findMany({
      where: { chatId, ...(before && { createdAt: { lt: new Date(before) } }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE,
    });
    return rows.reverse();
  }

  /** Conversa de que a pessoa participa — quem não é membro recebe 404 (nem sabe que existe). */
  private async chatOf(u: AuthUser, id: string) {
    const chat = await this.prisma.internalChat.findFirst({ where: { id, tenantId: u.tenantId, members: { some: { userId: u.id } } }, include: { members: { select: { userId: true } } } });
    if (!chat) throw new NotFoundException('Conversa não encontrada');
    return chat;
  }

  /** O dono do sistema "entrando como" o cliente não é da equipe: audita, mas não conversa. */
  private async assertMember(u: AuthUser) {
    const me = await this.prisma.user.findFirst({ where: { id: u.id, tenantId: u.tenantId, isActive: true }, select: { name: true } });
    if (!me || u.impersonatorId) throw new ForbiddenException('Só membros da equipe usam o chat interno.');
    return me;
  }

  /** Direta: nome = o outro membro (para quem audita, os dois). */
  private present(c: ChatRow, viewerId: string | null) {
    const members = c.members.map((m) => ({ id: m.user.id, name: m.user.name, active: m.user.isActive }));
    const outros = members.filter((m) => m.id !== viewerId);
    const name = c.isGroup ? c.name ?? 'Grupo' : viewerId ? outros[0]?.name ?? 'Conversa' : members.map((m) => m.name).join(' · ');
    return { id: c.id, isGroup: c.isGroup, name, members, lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview };
  }
}

@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [InternalChatController],
})
export class InternalChatModule {}
