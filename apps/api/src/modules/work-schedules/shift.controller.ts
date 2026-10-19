import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard, ShiftLockOk } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ShiftAccessService } from '../auth/shift-access.service';
import { shiftDuration, type ShiftRule } from '../auth/shift-window';
import { ConversationsService } from '../conversations/conversations.service';

/**
 * Tela de fim de turno (docs/escalas.md#fim-de-turno). Funciona com a sessão travada: é tudo
 * que a pessoa ainda pode fazer depois que o turno acabou — ver o resumo, devolver os
 * atendimentos abertos para a fila (o cliente não fica preso com quem saiu) e pedir mais tempo.
 */
@Controller('me/shift')
@UseGuards(JwtAuthGuard)
@ShiftLockOk()
export class ShiftController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shift: ShiftAccessService,
    private readonly conversations: ConversationsService,
  ) {}

  @Get()
  async summary(@CurrentUser() u: AuthUser) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { schedule: true } });
    const endsAt = u.shiftEndsAt ? new Date(u.shiftEndsAt * 1000) : null;
    // início do turno = fim − duração (sem escala: últimas 12 h)
    const since = endsAt && me.schedule ? new Date(endsAt.getTime() - shiftDuration(me.schedule as ShiftRule) * 60_000) : new Date(Date.now() - 12 * 3_600_000);
    const [eventos, abertos] = await Promise.all([
      // índice (tenantId, actorId, createdAt): barato mesmo em conta movimentada
      this.prisma.conversationEvent.groupBy({ by: ['type'], where: { tenantId: u.tenantId, actorId: u.id, createdAt: { gte: since }, type: { in: ['claimed', 'closed', 'transferred'] } }, _count: true }),
      this.prisma.conversation.findMany({
        where: { tenantId: u.tenantId, assigneeId: u.id, status: { not: 'closed' } },
        select: { id: true, contact: { select: { name: true, phone: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
    ]);
    const n = (t: string) => eventos.find((e) => e.type === t)?._count ?? 0;
    return {
      locked: !!u.shiftLocked,
      shiftEndsAt: endsAt,
      lockedUntil: u.lockedUntil ? new Date(u.lockedUntil * 1000) : null,
      since,
      stats: { claimed: n('claimed'), closed: n('closed'), transferred: n('transferred') },
      open: abertos.map((c) => ({ id: c.id, name: c.contact.name || `+${c.contact.phone}` })),
      // pedir mais tempo usa o mesmo fluxo do login (só faz sentido com o turno encerrado)
      requestToken: u.shiftLocked ? await this.shift.requestToken(u.id, u.tenantId) : null,
    };
  }

  /** Devolve para a fila todos os atendimentos abertos que estão comigo. */
  @Post('handoff')
  @HttpCode(200)
  async handoff(@CurrentUser() u: AuthUser) {
    const abertos = await this.prisma.conversation.findMany({ where: { tenantId: u.tenantId, assigneeId: u.id, status: { not: 'closed' } }, select: { id: true } });
    // pelo mesmo caminho do "Devolver" do chat: registra no histórico e avisa as telas
    for (const c of abertos) await this.conversations.release(u.tenantId, c.id, u);
    return { released: abertos.length };
  }
}
