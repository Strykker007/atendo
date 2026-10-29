import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localToUtc, TZ_DEFAULT } from '../../common/time';
import { localOf } from '../tenants/schedule-clock';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from './permissions.guard';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { teamWhere } from './team-scope';
import { deviceLabel, onlineMinutes, sessionEnd } from './access-log';

const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const sessionSelect = { id: true, userId: true, outcome: true, startedAt: true, lastSeenAt: true, endedAt: true, endReason: true, ip: true, userAgent: true } as const;
type Row = { id: string; userId: string; outcome: string; startedAt: Date; lastSeenAt: Date; endedAt: Date | null; endReason: string | null; ip: string | null; userAgent: string | null };

/**
 * Registro de acessos (docs/registro-de-acessos.md): quem esteve logado em cada dia e o histórico
 * de logins de uma pessoa, em calendário. Dias e horas no fuso do cliente.
 */
@Controller('access-log')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('team.manage')
export class AccessLogController {
  constructor(private readonly prisma: PrismaService) {}

  private async tz(tenantId: string) {
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    return s?.timezone ?? TZ_DEFAULT;
  }

  /** Sessões do cliente que tocam [from, to) — inclusive a que começou ontem e virou a meia-noite. */
  private overlapping(tenantId: string, from: Date, to: Date, userId?: string) {
    return this.prisma.userSession.findMany({
      where: { tenantId, ...(userId && { userId }), startedAt: { lt: to }, OR: [{ endedAt: { gte: from } }, { endedAt: null, lastSeenAt: { gte: from } }] },
      select: sessionSelect,
      orderBy: { startedAt: 'asc' },
      take: 5000,
    });
  }

  private view(r: Row, now: Date) {
    const { end, online } = sessionEnd(r, now);
    return { id: r.id, outcome: r.outcome, startedAt: r.startedAt, endAt: end, online, endReason: r.endReason, ip: r.ip, device: deviceLabel(r.userAgent) };
  }

  /** Pessoas da equipe para a busca (inclui inativas e temporárias: auditoria olha o passado). */
  @Get('people')
  people(@CurrentUser() u: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: u.tenantId, ...teamWhere(u) },
      select: { id: true, name: true, email: true, role: true, isActive: true, isTemporary: true },
      orderBy: { name: 'asc' },
      take: 1000,
    });
  }

  /** Quem esteve logado no dia: primeiro login, último sinal, tempo online e tentativas barradas. */
  @Get('day')
  async day(@CurrentUser() u: AuthUser, @Query('date') date?: string) {
    const tz = await this.tz(u.tenantId);
    const now = new Date();
    const ymd = date ?? localOf(now, tz).ymd;
    if (!YMD.test(ymd)) throw new BadRequestException('Data inválida (use AAAA-MM-DD).');
    const from = localToUtc(ymd, '00:00', tz);
    const to = localToUtc(addDays(ymd, 1), '00:00', tz);
    const rows = await this.overlapping(u.tenantId, from, to);
    const users = await this.prisma.user.findMany({ where: { tenantId: u.tenantId, id: { in: [...new Set(rows.map((r) => r.userId))] }, ...teamWhere(u) }, select: { id: true, name: true, role: true, isTemporary: true } });
    const people = users.map((user) => {
      const mine = rows.filter((r) => r.userId === user.id);
      const ok = mine.filter((r) => r.outcome === 'ok');
      const views = mine.map((r) => this.view(r, now));
      const okViews = views.filter((v) => v.outcome === 'ok');
      return {
        user,
        firstAt: ok[0]?.startedAt ?? null,
        lastAt: okViews.length ? new Date(Math.max(...okViews.map((v) => v.endAt.getTime()))) : null,
        onlineMinutes: onlineMinutes(okViews.map((v) => ({ start: v.startedAt, end: v.endAt })), from, to),
        online: okViews.some((v) => v.online),
        logins: ok.length,
        denied: mine.length - ok.length,
        sessions: views,
      };
    });
    people.sort((a, b) => (a.firstAt?.getTime() ?? Infinity) - (b.firstAt?.getTime() ?? Infinity) || a.user.name.localeCompare(b.user.name));
    return { date: ymd, timezone: tz, people };
  }

  /** Calendário de uma pessoa no mês: tempo online por dia + a lista de logins. */
  @Get('user/:id')
  async user(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('month') month?: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId: u.tenantId, ...teamWhere(u) }, select: { id: true, name: true, email: true, role: true, isActive: true, isTemporary: true, lastLoginAt: true } });
    if (!user) throw new NotFoundException('Pessoa não encontrada.');
    const tz = await this.tz(u.tenantId);
    const now = new Date();
    const ym = month ?? localOf(now, tz).ymd.slice(0, 7);
    if (!YM.test(ym)) throw new BadRequestException('Mês inválido (use AAAA-MM).');
    const first = `${ym}-01`;
    const next = addDays(`${ym}-28`, 4).slice(0, 7) + '-01';
    const rows = await this.overlapping(u.tenantId, localToUtc(first, '00:00', tz), localToUtc(next, '00:00', tz), id);
    const views = rows.map((r) => this.view(r, now));
    const spans = views.filter((v) => v.outcome === 'ok').map((v) => ({ start: v.startedAt, end: v.endAt }));
    const days: { date: string; onlineMinutes: number; logins: number; denied: number }[] = [];
    for (let d = first; d < next; d = addDays(d, 1)) {
      const from = localToUtc(d, '00:00', tz);
      const to = localToUtc(addDays(d, 1), '00:00', tz);
      const begun = views.filter((v) => v.startedAt >= from && v.startedAt < to);
      days.push({ date: d, onlineMinutes: onlineMinutes(spans, from, to), logins: begun.filter((v) => v.outcome === 'ok').length, denied: begun.filter((v) => v.outcome !== 'ok').length });
    }
    return { user, month: ym, timezone: tz, days, sessions: views.reverse() };
  }
}
