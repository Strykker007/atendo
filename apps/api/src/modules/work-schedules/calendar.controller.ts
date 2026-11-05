import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TZ_DEFAULT } from '../../common/time';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { teamWhere } from '../auth/team-scope';
import { ShiftAccessService } from '../auth/shift-access.service';
import { dayIndex, shiftDuration, splitLocal, type ShiftRule } from '../auth/shift-window';
import { plannedShifts, type DayException, type PlannedShift } from '../auth/shift-calendar';
import { localOf } from '../tenants/schedule-clock';
import { ConversationsGateway } from '../conversations/conversations.gateway';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** mês inteiro + as bordas da grade (semanas incompletas) */
const MAX_DAYS = 45;

class ExceptionDto {
  @IsUUID() userId: string;
  @Matches(YMD) date: string;
  @IsIn(['off', 'extra']) kind: 'off' | 'extra';
  @IsOptional() @Matches(HM) startTime?: string;
  @IsOptional() @Matches(HM) endTime?: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
class MoveDto {
  @IsUUID() userId: string;
  @Matches(YMD) date: string;
  @IsUUID() toUserId: string;
  @Matches(YMD) toDate: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

const hm = (abs: number) => splitLocal(abs).hm;
const ymdOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

/**
 * Calendário da escala (docs/escalas.md#calendário): os turnos de cada dia calculados da regra,
 * com as exceções (folga, turno extra, troca) que o gestor lança arrastando no quadro.
 */
@Controller('work-schedules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('team.manage')
export class ScheduleCalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shift: ShiftAccessService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Gerente só mexe em atendentes, como na equipe; admin nunca tem escala. */
  private roles(u: AuthUser) {
    return u.role === 'manager' ? (['agent'] as const) : (['agent', 'manager'] as const);
  }

  private async pessoa(u: AuthUser, id: string) {
    const p = await this.prisma.user.findFirst({
      where: { id, tenantId: u.tenantId, isActive: true, role: { in: [...this.roles(u)] }, ...teamWhere(u) },
      select: { id: true, name: true, schedule: true },
    });
    if (!p) throw new NotFoundException('Colaborador não encontrado (administradores não têm escala).');
    return p;
  }

  /** Turnos planejados da pessoa num dia (regra − folga + extra). */
  private async turnosDoDia(userId: string, rule: ShiftRule | null, date: string) {
    const exc = await this.prisma.shiftException.findMany({ where: { userId, date }, select: { id: true, date: true, kind: true, startTime: true, endTime: true } });
    return { exc, turnos: plannedShifts(rule, exc as DayException[], dayIndex(date), dayIndex(date)) };
  }

  /** Mexeu no turno de alguém: quem está logado é reavaliado na hora (docs/escalas.md#corte-imediato). */
  private async cortar(tenantId: string, userIds: string[]) {
    const ids = [...new Set(userIds)];
    await this.shift.cutSessions(ids);
    for (const id of ids) this.gateway.emitShiftLocked(tenantId, id);
  }

  @Get('calendar')
  async calendar(@CurrentUser() u: AuthUser, @Query('from') from: string, @Query('to') to: string) {
    if (!YMD.test(from ?? '') || !YMD.test(to ?? '')) throw new BadRequestException('Informe from e to (AAAA-MM-DD).');
    const fromDay = dayIndex(from);
    const toDay = dayIndex(to);
    if (toDay < fromDay || toDay - fromDay > MAX_DAYS) throw new BadRequestException(`Período de até ${MAX_DAYS} dias.`);

    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId: u.tenantId }, select: { timezone: true } });
    const tz = settings?.timezone ?? TZ_DEFAULT;
    const [users, schedules, exceptions, overrides] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId: u.tenantId, isActive: true, role: { in: ['agent', 'manager'] }, ...teamWhere(u) },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, role: true, isTemporary: true, scheduleId: true, schedule: true },
      }),
      this.prisma.workSchedule.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true } }),
      this.prisma.shiftException.findMany({
        where: { tenantId: u.tenantId, date: { gte: from, lte: to } },
        select: { id: true, userId: true, date: true, kind: true, startTime: true, endTime: true, reason: true },
      }),
      // liberações que encostam no período (com folga de um dia para o fuso)
      this.prisma.scheduleOverride.findMany({
        where: { tenantId: u.tenantId, revokedAt: null, validFrom: { lt: new Date((toDay + 2) * 86_400_000) }, validUntil: { gt: new Date((fromDay - 1) * 86_400_000) } },
        select: { id: true, userId: true, validFrom: true, validUntil: true, reason: true },
      }),
    ]);
    const editable = new Set(this.roles(u) as readonly string[]);
    const porPessoa = new Map<string, typeof exceptions>();
    for (const e of exceptions) porPessoa.set(e.userId, [...(porPessoa.get(e.userId) ?? []), e]);
    const ids = new Set(users.map((p) => p.id));

    const shifts: { date: string; userId: string; start: string; end: string; minutes: number; source: PlannedShift['source']; exceptionId?: string; reason?: string | null }[] = [];
    for (const p of users) {
      const exc = porPessoa.get(p.id) ?? [];
      for (const s of plannedShifts(p.schedule as ShiftRule | null, exc as DayException[], fromDay, toDay)) {
        shifts.push({
          date: ymdOf(s.day), userId: p.id, start: hm(s.start), end: hm(s.start + s.duration), minutes: s.duration, source: s.source,
          ...(s.exceptionId && { exceptionId: s.exceptionId, reason: exc.find((e) => e.id === s.exceptionId)?.reason ?? null }),
        });
      }
    }
    return {
      from, to, timezone: tz, today: localOf(new Date(), tz).ymd,
      users: users.map((p) => ({ id: p.id, name: p.name, role: p.role, isTemporary: p.isTemporary, scheduleId: p.scheduleId, scheduleName: p.schedule?.name ?? null, editable: editable.has(p.role) })),
      schedules,
      shifts,
      offs: exceptions.filter((e) => e.kind === 'off' && ids.has(e.userId)).map((e) => ({ id: e.id, date: e.date, userId: e.userId, reason: e.reason })),
      overrides: overrides.filter((o) => ids.has(o.userId)),
    };
  }

  /** Folga ou turno extra num dia. */
  @Post('exceptions')
  async createException(@CurrentUser() u: AuthUser, @Body() dto: ExceptionDto) {
    const p = await this.pessoa(u, dto.userId);
    const rule = p.schedule as ShiftRule | null;
    const { exc, turnos } = await this.turnosDoDia(p.id, rule, dto.date);
    if (dto.kind === 'off') {
      if (!turnos.length) throw new BadRequestException(`${p.name} não tem turno neste dia.`);
      // folga num extra = apagar o extra
      const extra = exc.find((e) => e.kind === 'extra');
      if (extra && !turnos.some((t) => t.source === 'rule')) await this.prisma.shiftException.delete({ where: { id: extra.id } });
      else await this.prisma.shiftException.upsert({
        where: { userId_date_kind: { userId: p.id, date: dto.date, kind: 'off' } },
        create: { tenantId: u.tenantId, userId: p.id, date: dto.date, kind: 'off', reason: dto.reason?.trim() || null, createdById: u.impersonatorId ? null : u.id },
        update: { reason: dto.reason?.trim() || null },
      });
    } else {
      const startTime = dto.startTime ?? rule?.startTime;
      const endTime = dto.endTime ?? rule?.endTime;
      if (!startTime || !endTime) throw new BadRequestException('Informe o horário do turno extra.');
      if (turnos.length) throw new BadRequestException(`${p.name} já tem turno neste dia. Lance uma folga antes ou mova o turno.`);
      await this.criarExtra(u, p.id, dto.date, startTime, endTime, dto.reason);
    }
    await this.cortar(u.tenantId, [p.id]);
    return { ok: true };
  }

  /** Desfaz uma exceção (volta ao que a escala dá). */
  @Delete('exceptions/:id')
  async removeException(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const e = await this.prisma.shiftException.findFirst({ where: { id, tenantId: u.tenantId }, select: { id: true, userId: true } });
    if (!e) throw new NotFoundException('Exceção não encontrada.');
    await this.pessoa(u, e.userId);
    await this.prisma.shiftException.delete({ where: { id } });
    await this.cortar(u.tenantId, [e.userId]);
    return { ok: true };
  }

  /**
   * Arrastar no quadro: o turno de `userId` em `date` passa para `toUserId` em `toDate` — outro
   * dia (remanejar), outra pessoa (cobrir/trocar) ou os dois. Vira folga/remoção na origem e
   * turno extra no destino, com o mesmo horário. Tudo ou nada.
   */
  @Post('exceptions/move')
  async move(@CurrentUser() u: AuthUser, @Body() dto: MoveDto) {
    if (dto.userId === dto.toUserId && dto.date === dto.toDate) return { ok: true };
    const [de, para] = await Promise.all([this.pessoa(u, dto.userId), this.pessoa(u, dto.toUserId)]);
    const origem = await this.turnosDoDia(de.id, de.schedule as ShiftRule | null, dto.date);
    const turno = origem.turnos[0];
    if (!turno) throw new BadRequestException(`${de.name} não tem turno neste dia.`);
    const destino = await this.turnosDoDia(para.id, para.schedule as ShiftRule | null, dto.toDate);
    // o destino só pode ter, no máximo, a folga daquele dia (sem turno valendo)
    if (destino.turnos.length) throw new BadRequestException(`${para.name} já tem turno em ${dto.toDate.split('-').reverse().join('/')}.`);
    const startTime = hm(turno.start);
    const endTime = hm(turno.start + turno.duration);
    const reason = dto.reason?.trim() || (de.id === para.id ? 'Turno remanejado' : `Cobre ${de.name}`);
    const by = u.impersonatorId ? null : u.id;

    await this.prisma.$transaction(async (tx) => {
      // origem: extra some; turno da regra vira folga
      if (turno.source === 'extra') await tx.shiftException.delete({ where: { id: turno.exceptionId! } });
      else await tx.shiftException.upsert({
        where: { userId_date_kind: { userId: de.id, date: dto.date, kind: 'off' } },
        create: { tenantId: u.tenantId, userId: de.id, date: dto.date, kind: 'off', reason: de.id === para.id ? 'Turno remanejado' : `Coberto por ${para.name}`, createdById: by },
        update: {},
      });
      // destino: se a folga dele era justamente este horário da regra, basta tirar a folga
      const folga = destino.exc.find((e) => e.kind === 'off');
      const regra = para.schedule as ShiftRule | null;
      const mesmoHorario = regra && regra.startTime === startTime && shiftDuration(regra) === turno.duration;
      if (folga && mesmoHorario) {
        await tx.shiftException.delete({ where: { id: folga.id } });
      } else {
        await tx.shiftException.create({ data: { tenantId: u.tenantId, userId: para.id, date: dto.toDate, kind: 'extra', startTime, endTime, reason, createdById: by } });
      }
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException(`${para.name} já tem turno extra neste dia.`);
      throw e;
    });
    await this.cortar(u.tenantId, [de.id, para.id]);
    return { ok: true };
  }

  private async criarExtra(u: AuthUser, userId: string, date: string, startTime: string, endTime: string, reason?: string) {
    try {
      await this.prisma.shiftException.create({ data: { tenantId: u.tenantId, userId, date, kind: 'extra', startTime, endTime, reason: reason?.trim() || null, createdById: u.impersonatorId ? null : u.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Já existe turno extra neste dia.');
      throw e;
    }
  }
}
