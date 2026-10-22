import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsGateway } from '../conversations/conversations.gateway';

class OpenDto {
  @IsUUID() userId: string;
}
class SendDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) text: string;
  @IsOptional() @IsUUID() replyToId?: string;
}
class PageQuery {
  @IsOptional() @IsISO8601() before?: string;
}

const PAGE = 50;
/** canal da equipe inteira do suporte — um só */
const TEAM_KEY = 'team';
const MEMBER_SELECT = { userId: true, user: { select: { id: true, name: true, isActive: true } } } as const;
const MESSAGE_INCLUDE = { replyTo: { select: { id: true, authorId: true, authorName: true, text: true } } } as const;
/** quem é da equipe do suporte: todo dono ativo — super_admin (sem cliente) ou marcado `isSystemOwner` (docs/donos-do-sistema.md) */
const STAFF = { isActive: true, OR: [{ role: 'super_admin' as const }, { isSystemOwner: true }] };

type ChatRow = Prisma.StaffChatGetPayload<{ include: { members: { select: typeof MEMBER_SELECT } } }>;

/**
 * Chat da equipe do suporte (docs/chat-interno.md#equipe-do-suporte): os donos do sistema
 * conversando entre si, sem passar pelo canal de atendimento de um cliente. Canal fixo
 * **Equipe do suporte** com todo super_admin ativo (quem vira super_admin já entra) e conversa
 * direta por par. Mesmo formato de lista/mensagem do chat interno: o widget reaproveita a tela.
 */
@Controller('super-admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@NoTenantOk()
@Roles('super_admin')
export class StaffChatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Colegas do suporte, online primeiro. */
  @Get('users')
  async users(@CurrentUser() u: AuthUser) {
    const me = meId(u);
    const [rows, online] = await Promise.all([
      this.prisma.user.findMany({ where: { ...STAFF, id: { not: me } }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
      this.gateway.ownersOnline(),
    ]);
    return rows.map((r) => ({ ...r, online: online.has(r.id) })).sort((a, b) => Number(b.online) - Number(a.online));
  }

  /** Canal da equipe (fixado no topo) + minhas conversas diretas, com as não lidas. */
  @Get('chats')
  async chats(@CurrentUser() u: AuthUser) {
    const me = meId(u);
    await this.prisma.staffChat.upsert({ where: { key: TEAM_KEY }, create: { key: TEAM_KEY }, update: {} });
    const rows = await this.prisma.staffChat.findMany({
      where: { OR: [{ key: TEAM_KEY }, { members: { some: { userId: me } } }] },
      include: { members: { select: MEMBER_SELECT } },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 100,
    });
    const naoLidas = await this.prisma.$queryRaw<{ chatId: string; n: number }[]>(Prisma.sql`
      select m."chatId", count(*)::int as n
      from staff_messages m
      left join staff_chat_members cm on cm."chatId" = m."chatId" and cm."userId" = ${me}
      where m."chatId" in (${Prisma.join(rows.map((r) => r.id))})
        and (cm."lastReadAt" is null or m."createdAt" > cm."lastReadAt")
        and m."authorId" is distinct from ${me}
      group by 1`);
    const unread = new Map(naoLidas.map((r) => [r.chatId, Number(r.n)]));
    return rows
      .map((c) => ({ ...this.present(c, me), unread: unread.get(c.id) ?? 0 }))
      .sort((a, b) => Number(b.isGroup) - Number(a.isGroup));
  }

  /** Abre a conversa direta com um colega do suporte (uma só por par). */
  @Post('chats')
  async open(@CurrentUser() u: AuthUser, @Body() dto: OpenDto) {
    const me = meId(u);
    if (dto.userId === me) throw new BadRequestException('Escolha outra pessoa.');
    const outro = await this.prisma.user.findFirst({ where: { ...STAFF, id: dto.userId }, select: { id: true } });
    if (!outro) throw new BadRequestException('Esta pessoa não é da equipe do suporte.');
    const key = [me, outro.id].sort().join(':');
    const chat = await this.prisma.staffChat.upsert({
      where: { key },
      create: { key, members: { create: [{ userId: me }, { userId: outro.id }] } },
      update: {},
      include: { members: { select: MEMBER_SELECT } },
    });
    return { ...this.present(chat, me), unread: 0 };
  }

  @Get('chats/:id/messages')
  async messages(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    await this.chatOf(meId(u), id);
    const rows = await this.prisma.staffMessage.findMany({
      where: { chatId: id, ...(q.before && { createdAt: { lt: new Date(q.before) } }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE,
      include: MESSAGE_INCLUDE,
    });
    return rows.reverse();
  }

  @Post('chats/:id/messages')
  async send(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendDto) {
    const me = meId(u);
    const chat = await this.chatOf(me, id);
    const author = await this.prisma.user.findFirst({ where: { ...STAFF, id: me }, select: { name: true } });
    if (!author) throw new NotFoundException('Conversa não encontrada');
    const text = dto.text.trim();
    if (!text) throw new BadRequestException('Mensagem vazia.');
    if (dto.replyToId && !(await this.prisma.staffMessage.findFirst({ where: { id: dto.replyToId, chatId: chat.id }, select: { id: true } }))) {
      throw new BadRequestException('A mensagem respondida não é desta conversa.');
    }
    const agora = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.staffMessage.create({ data: { chatId: chat.id, authorId: me, authorName: author.name, text, replyToId: dto.replyToId ?? null, createdAt: agora }, include: MESSAGE_INCLUDE }),
      this.prisma.staffChat.update({ where: { id: chat.id }, data: { lastMessageAt: agora, lastMessagePreview: `${author.name}: ${text}`.slice(0, 140) } }),
      // quem escreve leu tudo até aqui (no canal da equipe a linha nasce sob demanda)
      this.prisma.staffChatMember.upsert({ where: { chatId_userId: { chatId: chat.id, userId: me } }, create: { chatId: chat.id, userId: me, lastReadAt: agora }, update: { lastReadAt: agora } }),
    ]);
    this.gateway.emitStaffMessage(chat.key === TEAM_KEY ? null : chat.members.map((m) => m.userId), message);
    return message;
  }

  @Post('chats/:id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const me = meId(u);
    await this.chatOf(me, id);
    const agora = new Date();
    await this.prisma.staffChatMember.upsert({ where: { chatId_userId: { chatId: id, userId: me } }, create: { chatId: id, userId: me, lastReadAt: agora }, update: { lastReadAt: agora } });
    return { ok: true };
  }

  /** Canal da equipe (todos) ou direta de que a pessoa participa — senão 404. */
  private async chatOf(me: string, id: string) {
    const chat = await this.prisma.staffChat.findFirst({ where: { id, OR: [{ key: TEAM_KEY }, { members: { some: { userId: me } } }] }, include: { members: { select: { userId: true } } } });
    if (!chat) throw new NotFoundException('Conversa não encontrada');
    return chat;
  }

  /** Formato da lista do chat interno. Canal da equipe = "grupo" sem lista de membros (é todo mundo). */
  private present(c: ChatRow, me: string) {
    const team = c.key === TEAM_KEY;
    const members = team ? [] : c.members.map((m) => ({ id: m.user.id, name: m.user.name, active: m.user.isActive }));
    const name = team ? 'Equipe do suporte' : members.find((m) => m.id !== me)?.name ?? 'Conversa';
    return { id: c.id, isGroup: team, isStaff: true, name, members, createdById: null, lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview };
  }
}

/** Pessoa do suporte por trás do token (também quando "entrando como" um cliente). */
const meId = (u: AuthUser) => u.impersonatorId ?? u.id;
