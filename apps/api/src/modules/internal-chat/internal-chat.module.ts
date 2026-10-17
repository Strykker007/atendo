import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
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
  /** responder a uma mensagem da mesma conversa */
  @IsOptional() @IsUUID() replyToId?: string;
}
class MembersDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsUUID('all', { each: true }) userIds: string[];
}
class RenameDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name: string;
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
/** a mensagem citada vem junto: a tela mostra o trecho sem buscar de novo */
const MESSAGE_INCLUDE = { replyTo: { select: { id: true, authorId: true, authorName: true, text: true, system: true } } } as const;

type ChatRow = Prisma.InternalChatGetPayload<{ include: { members: { select: typeof MEMBER_SELECT } } }>;

/** chave do canal de suporte: um por cliente (único em `(tenantId, directKey)`) */
const SUPPORT_KEY = 'support';

/** Canal de suporte do cliente — criado na primeira vez que alguém (equipe ou dono) abre. */
function ensureSupportChat(prisma: PrismaService, tenantId: string) {
  return prisma.internalChat.upsert({
    where: { tenantId_directKey: { tenantId, directKey: SUPPORT_KEY } },
    create: { tenantId, directKey: SUPPORT_KEY, isSupport: true, name: 'Suporte' },
    update: {},
  });
}

/**
 * Envio no canal de suporte (dos dois lados). Leitura de quem escreve fica em
 * `internal_chat_members` — linha criada sob demanda: a equipe toda participa sem ser cadastrada.
 */
async function sendSupport(prisma: PrismaService, gateway: ConversationsGateway, chat: { id: string; tenantId: string }, author: { id: string; name: string }, dto: { text: string; replyToId?: string }, fromSupport: boolean) {
  const text = dto.text.trim();
  if (!text) throw new BadRequestException('Mensagem vazia.');
  if (dto.replyToId && !(await prisma.internalMessage.findFirst({ where: { id: dto.replyToId, chatId: chat.id }, select: { id: true } }))) {
    throw new BadRequestException('A mensagem respondida não é desta conversa.');
  }
  const agora = new Date();
  const [message] = await prisma.$transaction([
    prisma.internalMessage.create({ data: { tenantId: chat.tenantId, chatId: chat.id, authorId: author.id, authorName: author.name, text, fromSupport, replyToId: dto.replyToId ?? null, createdAt: agora }, include: MESSAGE_INCLUDE }),
    prisma.internalChat.update({ where: { id: chat.id }, data: { lastMessageAt: agora, lastMessagePreview: `${fromSupport ? 'Suporte' : author.name}: ${text}`.slice(0, 140) } }),
    prisma.internalChatMember.upsert({ where: { chatId_userId: { chatId: chat.id, userId: author.id } }, create: { chatId: chat.id, userId: author.id, lastReadAt: agora }, update: { lastReadAt: agora } }),
  ]);
  gateway.emitSupportMessage(chat.tenantId, message);
  return message;
}

/** Marca o canal de suporte como lido por esta pessoa (linha criada sob demanda). */
function readSupport(prisma: PrismaService, chatId: string, userId: string) {
  const agora = new Date();
  return prisma.internalChatMember.upsert({ where: { chatId_userId: { chatId, userId } }, create: { chatId, userId, lastReadAt: agora }, update: { lastReadAt: agora } });
}

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
    // dono "entrando como": não é da equipe, só fala pelo canal de suporte
    if (u.impersonatorId) return [];
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
    // o canal de suporte existe sempre e fica fixado no topo (docs/chat-interno.md#suporte)
    await ensureSupportChat(this.prisma, u.tenantId);
    const rows = await this.prisma.internalChat.findMany({
      where: { tenantId: u.tenantId, deletedAt: null, ...(u.impersonatorId ? { isSupport: true } : { OR: [{ members: { some: { userId: u.id } } }, { isSupport: true }] }) },
      include: { members: { select: MEMBER_SELECT } },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 100,
    });
    const naoLidas = rows.length
      ? await this.prisma.$queryRaw<{ chatId: string; n: number }[]>(Prisma.sql`
          select m."chatId", count(*)::int as n
          from internal_messages m
          left join internal_chat_members cm on cm."chatId" = m."chatId" and cm."userId" = ${u.id}
          where m."tenantId" = ${u.tenantId} and m."chatId" in (${Prisma.join(rows.map((r) => r.id))})
            and (cm."lastReadAt" is null or m."createdAt" > cm."lastReadAt")
            and m."authorId" is distinct from ${u.id}
          group by 1`)
      : [];
    const unread = new Map(naoLidas.map((r) => [r.chatId, Number(r.n)]));
    return rows
      .map((c) => ({ ...this.present(c, u.id), unread: unread.get(c.id) ?? 0 }))
      .sort((a, b) => Number(b.isSupport) - Number(a.isSupport));
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
    // dono "entrando como" o cliente: responde no canal de suporte como Suporte, com o nome dele
    if (chat.isSupport && u.impersonatorId) {
      const dono = await this.prisma.user.findUniqueOrThrow({ where: { id: u.impersonatorId }, select: { id: true, name: true } });
      return sendSupport(this.prisma, this.gateway, chat, dono, dto, true);
    }
    const author = await this.assertMember(u);
    if (chat.isSupport) return sendSupport(this.prisma, this.gateway, chat, { id: u.id, name: author.name }, dto, false);
    const text = dto.text.trim();
    if (!text) throw new BadRequestException('Mensagem vazia.');
    // citação só de mensagem desta conversa (id de outra conversa vazaria o conteúdo dela)
    if (dto.replyToId && !(await this.prisma.internalMessage.findFirst({ where: { id: dto.replyToId, chatId: chat.id }, select: { id: true } }))) {
      throw new BadRequestException('A mensagem respondida não é desta conversa.');
    }
    const agora = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.internalMessage.create({ data: { tenantId: u.tenantId, chatId: chat.id, authorId: u.id, authorName: author.name, text, replyToId: dto.replyToId ?? null, createdAt: agora }, include: MESSAGE_INCLUDE }),
      this.prisma.internalChat.update({ where: { id: chat.id }, data: { lastMessageAt: agora, lastMessagePreview: `${author.name}: ${text}`.slice(0, 140) } }),
      // quem escreve leu tudo até aqui
      this.prisma.internalChatMember.update({ where: { chatId_userId: { chatId: chat.id, userId: u.id } }, data: { lastReadAt: agora } }),
    ]);
    this.gateway.emitInternalMessage(u.tenantId, chat.members.map((m) => m.userId), message);
    return message;
  }

  @Post('chats/:id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const chat = await this.chatOf(u, id);
    if (chat.isSupport) await readSupport(this.prisma, id, u.id);
    else await this.prisma.internalChatMember.update({ where: { chatId_userId: { chatId: id, userId: u.id } }, data: { lastReadAt: new Date() } });
    this.gateway.emitInternalChat(u.tenantId, [u.id], id);
    return { ok: true };
  }

  // ---------- grupo ----------
  // Quem gerencia: quem criou o grupo, ou quem tem `team.manage`. Cada mudança vira um aviso
  // no histórico (mensagem `system`) — a auditoria mostra quem adicionou, tirou ou apagou.

  @Post('chats/:id/members')
  async addMembers(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MembersDto) {
    const chat = await this.grupoGerenciavel(u, id);
    const atuais = new Set(chat.members.map((m) => m.userId));
    const novos = [...new Set(dto.userIds)].filter((x) => !atuais.has(x));
    if (!novos.length) throw new BadRequestException('Essas pessoas já estão no grupo.');
    const users = await this.prisma.user.findMany({ where: { id: { in: novos }, tenantId: u.tenantId, isActive: true }, select: { id: true, name: true } });
    if (users.length !== novos.length) throw new BadRequestException('Alguém da lista não faz parte da equipe.');
    await this.prisma.internalChatMember.createMany({ data: users.map((x) => ({ chatId: chat.id, userId: x.id })), skipDuplicates: true });
    await this.aviso(u, chat.id, `adicionou ${users.map((x) => x.name).join(', ')}`);
    return this.detalhe(u, chat.id);
  }

  /** Tirar alguém do grupo — ou sair, quando é a própria pessoa (qualquer membro pode sair). */
  @Delete('chats/:id/members/:userId')
  async removeMember(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    const saindo = userId === u.id;
    const chat = saindo ? await this.chatOf(u, id) : await this.grupoGerenciavel(u, id);
    if (!chat.isGroup) throw new BadRequestException('Só dá para sair de grupos.');
    if (!chat.members.some((m) => m.userId === userId)) throw new NotFoundException('Esta pessoa não está no grupo.');
    if (chat.members.length <= 1) throw new BadRequestException('O grupo precisa de pelo menos uma pessoa. Para encerrá-lo, apague o grupo.');
    const alvo = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    // o aviso sai antes de tirar: quem saiu também recebe o registro e a lista dele atualiza
    await this.aviso(u, chat.id, saindo ? 'saiu do grupo' : `removeu ${alvo?.name ?? 'um membro'}`);
    await this.prisma.internalChatMember.delete({ where: { chatId_userId: { chatId: chat.id, userId } } });
    this.gateway.emitInternalChat(u.tenantId, [userId], chat.id);
    return { ok: true };
  }

  @Patch('chats/:id')
  async rename(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameDto) {
    const chat = await this.grupoGerenciavel(u, id);
    const name = dto.name.trim();
    await this.prisma.internalChat.update({ where: { id: chat.id }, data: { name } });
    await this.aviso(u, chat.id, `renomeou o grupo para "${name}"`);
    return this.detalhe(u, chat.id);
  }

  /**
   * Apagar o grupo: some para todos os membros, mas NÃO sai do banco — o chat interno é
   * auditável, e quem tem `internal_chat.audit` continua lendo (marcado como apagado).
   */
  @Delete('chats/:id')
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const chat = await this.grupoGerenciavel(u, id);
    await this.aviso(u, chat.id, 'apagou o grupo');
    await this.prisma.internalChat.update({ where: { id: chat.id }, data: { deletedAt: new Date(), deletedById: u.id } });
    this.gateway.emitInternalChat(u.tenantId, chat.members.map((m) => m.userId), chat.id);
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
      include: MESSAGE_INCLUDE,
    });
    return rows.reverse();
  }

  /**
   * Conversa de que a pessoa participa — quem não é membro recebe 404 (nem sabe que existe).
   * O canal de suporte é da equipe inteira do cliente — e é o único que o dono "entrando como" vê.
   */
  private async chatOf(u: AuthUser, id: string) {
    const chat = await this.prisma.internalChat.findFirst({ where: { id, tenantId: u.tenantId, deletedAt: null, ...(u.impersonatorId ? { isSupport: true } : { OR: [{ members: { some: { userId: u.id } } }, { isSupport: true }] }) }, include: { members: { select: { userId: true } } } });
    if (!chat) throw new NotFoundException('Conversa não encontrada');
    return chat;
  }

  /** Grupo de que a pessoa participa e que ela pode gerenciar (criou, ou tem `team.manage`). */
  private async grupoGerenciavel(u: AuthUser, id: string) {
    const chat = await this.chatOf(u, id);
    if (!chat.isGroup) throw new BadRequestException('Conversa direta não tem membros para gerenciar.');
    if (chat.createdById !== u.id && !u.permissions?.includes('team.manage')) throw new ForbiddenException('Só quem criou o grupo (ou quem gerencia a equipe) pode mudar o grupo.');
    return chat;
  }

  /** Aviso do sistema no histórico do grupo, assinado por quem fez — e entregue ao vivo aos membros. */
  private async aviso(u: AuthUser, chatId: string, acao: string) {
    const ator = await this.assertMember(u);
    const agora = new Date();
    const message = await this.prisma.internalMessage.create({ data: { tenantId: u.tenantId, chatId, authorId: u.id, authorName: ator.name, text: `${ator.name} ${acao}`, system: true, createdAt: agora }, include: MESSAGE_INCLUDE });
    await this.prisma.internalChat.update({ where: { id: chatId }, data: { lastMessageAt: agora, lastMessagePreview: message.text.slice(0, 140) } });
    const membros = await this.prisma.internalChatMember.findMany({ where: { chatId }, select: { userId: true } });
    const ids = membros.map((m) => m.userId);
    this.gateway.emitInternalMessage(u.tenantId, ids, message);
    this.gateway.emitInternalChat(u.tenantId, ids, chatId);
  }

  /** Conversa já atualizada, no formato da lista. */
  private async detalhe(u: AuthUser, id: string) {
    const c = await this.prisma.internalChat.findFirstOrThrow({ where: { id, tenantId: u.tenantId }, include: { members: { select: MEMBER_SELECT } } });
    return { ...this.present(c, u.id), unread: 0 };
  }

  /** O dono do sistema "entrando como" o cliente não é da equipe: audita e fala só pelo canal de suporte. */
  private async assertMember(u: AuthUser) {
    const me = await this.prisma.user.findFirst({ where: { id: u.id, tenantId: u.tenantId, isActive: true }, select: { name: true } });
    if (!me || u.impersonatorId) throw new ForbiddenException('Só membros da equipe usam o chat interno.');
    return me;
  }

  /** Direta: nome = o outro membro (para quem audita, os dois). Suporte: sem lista de membros. */
  private present(c: ChatRow, viewerId: string | null) {
    const members = c.isSupport ? [] : c.members.map((m) => ({ id: m.user.id, name: m.user.name, active: m.user.isActive }));
    const outros = members.filter((m) => m.id !== viewerId);
    const name = c.isSupport ? 'Suporte' : c.isGroup ? c.name ?? 'Grupo' : viewerId ? outros[0]?.name ?? 'Conversa' : members.map((m) => m.name).join(' · ');
    return { id: c.id, isGroup: c.isGroup, isSupport: c.isSupport, name, members, createdById: c.createdById, deletedAt: c.deletedAt, lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview };
  }
}

/**
 * Lado do dono do sistema no canal de suporte (docs/chat-interno.md#suporte): um canal por
 * cliente, todos numa lista só. Mensagem daqui sai marcada `fromSupport` e chega à equipe
 * inteira do cliente; a do cliente chega ao vivo na sala `owners` (`support_message`).
 */
@Controller('super-admin/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@NoTenantOk()
@Roles('super_admin')
class SupportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Clientes para iniciar contato (ativos primeiro). */
  @Get('tenants')
  tenants() {
    return this.prisma.tenant.findMany({ select: { id: true, name: true, isActive: true }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  /** Canais com mensagem, mais recentes primeiro, com as não lidas por mim. */
  @Get('chats')
  async chats(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.internalChat.findMany({
      where: { isSupport: true, lastMessageAt: { not: null } },
      select: { id: true, tenantId: true, lastMessageAt: true, lastMessagePreview: true, tenant: { select: { name: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    const naoLidas = rows.length
      ? await this.prisma.$queryRaw<{ chatId: string; n: number }[]>(Prisma.sql`
          select m."chatId", count(*)::int as n
          from internal_messages m
          left join internal_chat_members cm on cm."chatId" = m."chatId" and cm."userId" = ${u.id}
          where m."chatId" in (${Prisma.join(rows.map((r) => r.id))}) and not m."fromSupport"
            and (cm."lastReadAt" is null or m."createdAt" > cm."lastReadAt")
          group by 1`)
      : [];
    const unread = new Map(naoLidas.map((r) => [r.chatId, Number(r.n)]));
    return rows.map((c) => this.present(c, unread.get(c.id) ?? 0));
  }

  /** Abre (ou cria) o canal de um cliente — para o suporte puxar a conversa. */
  @Post('tenants/:tenantId/chat')
  async open(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!t) throw new NotFoundException('Cliente não encontrado');
    const c = await ensureSupportChat(this.prisma, tenantId);
    const row = await this.prisma.internalChat.findUniqueOrThrow({ where: { id: c.id }, select: { id: true, tenantId: true, lastMessageAt: true, lastMessagePreview: true, tenant: { select: { name: true } } } });
    return this.present(row, 0);
  }

  @Get('chats/:id/messages')
  async messages(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    await this.chat(id);
    const rows = await this.prisma.internalMessage.findMany({
      where: { chatId: id, ...(q.before && { createdAt: { lt: new Date(q.before) } }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE,
      include: MESSAGE_INCLUDE,
    });
    return rows.reverse();
  }

  @Post('chats/:id/messages')
  async send(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendDto) {
    const chat = await this.chat(id);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: u.impersonatorId ?? u.id }, select: { id: true, name: true } });
    return sendSupport(this.prisma, this.gateway, chat, me, dto, true);
  }

  @Post('chats/:id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.chat(id);
    await readSupport(this.prisma, id, u.impersonatorId ?? u.id);
    return { ok: true };
  }

  private async chat(id: string) {
    const chat = await this.prisma.internalChat.findFirst({ where: { id, isSupport: true }, select: { id: true, tenantId: true } });
    if (!chat) throw new NotFoundException('Canal não encontrado');
    return chat;
  }

  /** Mesmo formato da lista do chat da equipe: o widget reaproveita a tela. */
  private present(c: { id: string; tenantId: string; lastMessageAt: Date | null; lastMessagePreview: string | null; tenant: { name: string } }, unread: number) {
    return { id: c.id, tenantId: c.tenantId, isGroup: false, isSupport: true, name: c.tenant.name, members: [], createdById: null, lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview, unread };
  }
}

@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [InternalChatController, SupportController],
})
export class InternalChatModule {}
