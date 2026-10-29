import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { creatorCompanyIds, teamWhere } from '../auth/team-scope';
import { ShiftAccessService } from '../auth/shift-access.service';
import { isCyclic, isWithinShift, shiftDuration, type ShiftRule } from '../auth/shift-window';
import { localOf } from '../tenants/schedule-clock';
import { TZ_DEFAULT } from '../../common/time';
import { BillingModule } from '../billing/billing.module';
import { PlanLimitGuard, RequireLimit } from '../billing/plan-limit.guard';
import { TenantsModule } from '../tenants/tenants.module';
import { TenantProvisioningService } from '../tenants/tenant-provisioning.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { AccessRequestsController, PublicAccessRequestsController } from './access-requests.controller';
import { ShiftController } from './shift.controller';
import { ConversationsGateway } from '../conversations/conversations.gateway';

const QUEUE_WORK_SCHEDULES = 'work-schedules';
const TYPES = ['FIXED_12X36', 'COMMERCIAL_44H', 'CUSTOM'] as const;
type ScheduleType = (typeof TYPES)[number];
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

class ScheduleDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsIn(TYPES) type: ScheduleType;
  @Matches(HM) startTime: string;
  @Matches(HM) endTime: string;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workDays?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(168) restHours?: number;
  @IsOptional() @Matches(YMD) anchorDate?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(120) toleranceMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(30) exitGraceMinutes?: number;
}
class UpdateScheduleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsIn(TYPES) type?: ScheduleType;
  @IsOptional() @Matches(HM) startTime?: string;
  @IsOptional() @Matches(HM) endTime?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workDays?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(168) restHours?: number;
  @IsOptional() @Matches(YMD) anchorDate?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(120) toleranceMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(30) exitGraceMinutes?: number;
}
class AssignScheduleDto {
  /** null/ausente = tira da escala (sem trava de horário) */
  @IsOptional() @IsUUID() scheduleId?: string | null;
}
class OverrideDto {
  @IsUUID() userId: string;
  /** por quantas horas a liberação vale, a partir de agora */
  @IsInt() @Min(1) @Max(72) hours: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
class TemporaryUserDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  /** validade do plantão em horas (ex.: 12) */
  @IsInt() @Min(1) @Max(72) hours: number;
  /** opcional: também prende a conta a uma escala */
  @IsOptional() @IsUUID() scheduleId?: string;
  /** números que a conta opera; vazio = todos (ver number-scope.ts) */
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) numberIds?: string[];
}

/**
 * Normaliza e valida a escala. 12x36 sempre é por ciclo (descanso padrão 36h) e exige o dia
 * de referência; comercial é por dias da semana. Custom escolhe: dias da semana OU ciclo.
 */
function cleanSchedule(dto: ScheduleDto) {
  const restHours = dto.type === 'FIXED_12X36' ? (dto.restHours || 36) : dto.type === 'COMMERCIAL_44H' ? 0 : (dto.restHours ?? 0);
  const rule = { ...dto, name: dto.name.trim(), restHours, workDays: [...new Set(dto.workDays ?? [])].sort((a, b) => a - b), anchorDate: dto.anchorDate || null, toleranceMinutes: dto.toleranceMinutes ?? 15, exitGraceMinutes: dto.exitGraceMinutes ?? 0 };
  if (!rule.name) throw new BadRequestException('Informe o nome da escala.');
  if (isCyclic(rule)) {
    if (!rule.anchorDate) throw new BadRequestException('Informe um dia em que o turno começa (referência do ciclo).');
    rule.workDays = [];
  } else {
    if (!rule.workDays.length) throw new BadRequestException('Marque ao menos um dia de trabalho.');
    rule.anchorDate = null;
  }
  if (rule.toleranceMinutes >= shiftDuration(rule)) throw new BadRequestException('A tolerância precisa ser menor que o turno.');
  // a saída de um turno não pode encostar na entrada do próximo
  if (isCyclic(rule) && rule.toleranceMinutes + rule.exitGraceMinutes >= rule.restHours * 60) throw new BadRequestException('As tolerâncias de entrada e saída precisam caber no descanso.');
  return rule;
}

const scheduleSelect = { id: true, name: true, type: true, startTime: true, endTime: true, workDays: true, restHours: true, anchorDate: true, toleranceMinutes: true, exitGraceMinutes: true, users: { select: { id: true, name: true } } } as const;

/** Modelos de escala do tenant e vínculo com colaboradores (docs/escalas.md). */
@Controller('work-schedules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('team.manage')
class WorkSchedulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ConversationsGateway,
    private readonly shift: ShiftAccessService,
  ) {}

  /** Mudou a regra de quem já está logado: corta agora (a renovação reavalia — docs/escalas.md#corte-imediato). */
  private async cortar(tenantId: string, userIds: string[]) {
    await this.shift.cutSessions(userIds);
    for (const id of userIds) this.gateway.emitShiftLocked(tenantId, id);
  }

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.workSchedule.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' }, select: scheduleSelect });
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: ScheduleDto) {
    return this.prisma.workSchedule.create({ data: { tenantId: u.tenantId, ...cleanSchedule(dto) }, select: scheduleSelect });
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateScheduleDto) {
    const cur = await this.prisma.workSchedule.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!cur) throw new NotFoundException('Escala não encontrada.');
    const merged = { name: cur.name, type: cur.type, startTime: cur.startTime, endTime: cur.endTime, workDays: cur.workDays, restHours: cur.restHours, anchorDate: cur.anchorDate, toleranceMinutes: cur.toleranceMinutes, exitGraceMinutes: cur.exitGraceMinutes, ...dto };
    const updated = await this.prisma.workSchedule.update({ where: { id }, data: cleanSchedule(merged), select: scheduleSelect });
    // horário mudou: quem está nesta escala é reavaliado na hora
    await this.cortar(u.tenantId, updated.users.map((x) => x.id));
    return updated;
  }

  /** Apagar a escala solta os colaboradores (ficam sem trava de horário). */
  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const { count } = await this.prisma.workSchedule.deleteMany({ where: { id, tenantId: u.tenantId } });
    if (!count) throw new NotFoundException('Escala não encontrada.');
    return { ok: true };
  }

  /**
   * Situação da equipe agora: escala, se está no turno e a liberação ativa. Base do painel de
   * aprovações. Admins aparecem sem trava (nunca são bloqueados).
   */
  @Get('team')
  async team(@CurrentUser() u: AuthUser) {
    const now = new Date();
    const [schedules, settings] = await Promise.all([
      this.prisma.workSchedule.findMany({ where: { tenantId: u.tenantId } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId: u.tenantId }, select: { timezone: true } }),
    ]);
    const local = localOf(now, settings?.timezone ?? TZ_DEFAULT);
    const onShift = new Map(schedules.map((s) => [s.id, isWithinShift(s as ShiftRule, local)]));
    const users = await this.prisma.user.findMany({
      where: { tenantId: u.tenantId, isActive: true, ...teamWhere(u) },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, email: true, role: true, scheduleId: true, isTemporary: true, accessExpiresAt: true,
        schedule: { select: { id: true, name: true } },
        scheduleOverrides: { where: { revokedAt: null, validFrom: { lte: now }, validUntil: { gt: now } }, orderBy: { validUntil: 'desc' }, take: 1, select: { id: true, validUntil: true, reason: true } },
      },
    });
    return users.map(({ scheduleOverrides, ...p }) => {
      const exempt = p.role === 'tenant_admin' || !p.scheduleId;
      return { ...p, exempt, onShift: exempt || (onShift.get(p.scheduleId!) ?? true), override: scheduleOverrides[0] ?? null };
    });
  }

  // ---------- liberações excepcionais de plantão ----------

  /** Liberações ativas e futuras (as encerradas e vencidas saem da lista). */
  @Get('overrides')
  overrides(@CurrentUser() u: AuthUser) {
    return this.prisma.scheduleOverride.findMany({
      where: { tenantId: u.tenantId, revokedAt: null, validUntil: { gt: new Date() }, user: teamWhere(u) },
      orderBy: { validUntil: 'asc' },
      select: { id: true, validFrom: true, validUntil: true, reason: true, createdAt: true, user: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
    });
  }

  /** "Autorizar plantão excepcional": libera o colaborador fora da escala por X horas. */
  @Post('overrides')
  async createOverride(@CurrentUser() u: AuthUser, @Body() dto: OverrideDto) {
    // colaborador de outro cliente não entra: o id vem do corpo da requisição
    const target = await this.prisma.user.findFirst({ where: { id: dto.userId, tenantId: u.tenantId, ...teamWhere(u) }, select: { id: true } });
    if (!target) throw new NotFoundException('Colaborador não encontrado.');
    const now = new Date();
    // impersonação: o dono não é usuário do tenant, a liberação fica sem aprovador
    const approver = u.impersonatorId ? null : u.id;
    const created = await this.prisma.scheduleOverride.create({
      data: { tenantId: u.tenantId, userId: target.id, validFrom: now, validUntil: new Date(now.getTime() + dto.hours * 3_600_000), approvedById: approver, reason: dto.reason?.trim() || null },
      select: { id: true, validFrom: true, validUntil: true, reason: true },
    });
    // quem está na tela de fim de turno destrava na hora
    this.gateway.emitShiftUnlocked(u.tenantId, target.id);
    return created;
  }

  /** Encerra a liberação antes do fim. A sessão aberta cai na próxima renovação do token. */
  @Delete('overrides/:id')
  async revokeOverride(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const o = await this.prisma.scheduleOverride.findFirst({ where: { id, tenantId: u.tenantId, revokedAt: null, user: teamWhere(u) }, select: { id: true, userId: true } });
    if (!o) throw new NotFoundException('Liberação não encontrada.');
    await this.prisma.scheduleOverride.update({ where: { id }, data: { revokedAt: new Date() } });
    // encerrou o plantão: trava AGORA (antes, o token já emitido seguia liberado por até 15 min)
    await this.cortar(u.tenantId, [o.userId]);
    return { ok: true };
  }
}

/** Vínculo de escala e contas temporárias / descartáveis (docs/escalas.md). */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('team.manage')
class UsersScheduleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly shift: ShiftAccessService,
    private readonly provisioning: TenantProvisioningService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Associa (ou tira) a escala de um colaborador. Gerente só mexe em atendentes, como na equipe. */
  @Patch(':id/schedule')
  async assign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AssignScheduleDto) {
    if (dto.scheduleId) {
      const ok = await this.prisma.workSchedule.count({ where: { id: dto.scheduleId, tenantId: u.tenantId } });
      if (!ok) throw new BadRequestException('Escala não encontrada.');
    }
    const roles = u.role === 'manager' ? ['agent' as const] : ['agent' as const, 'manager' as const];
    const { count } = await this.prisma.user.updateMany({ where: { id, tenantId: u.tenantId, role: { in: roles }, ...teamWhere(u) }, data: { scheduleId: dto.scheduleId ?? null } });
    if (!count) throw new BadRequestException('Este colaborador não pode receber escala (admins nunca são travados por horário).');
    // escala nova pode deixar a pessoa fora do turno: reavalia já
    await this.shift.cutSessions([id]);
    this.gateway.emitShiftLocked(u.tenantId, id);
    return { ok: true };
  }

  @Get('temporary')
  async temporary(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.user.findMany({
      where: { tenantId: u.tenantId, isTemporary: true, ...teamWhere(u) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, name: true, email: true, isActive: true, accessExpiresAt: true, expiredAt: true, lastLoginAt: true, createdAt: true, schedule: { select: { id: true, name: true } }, temporaryCreatedBy: { select: { id: true, name: true } } },
    });
    const now = new Date();
    return rows.map((r) => ({ ...r, status: r.expiredAt || (r.accessExpiresAt && r.accessExpiresAt <= now) ? 'EXPIRED' : r.isActive ? 'ACTIVE' : 'INACTIVE' }));
  }

  /**
   * "Gerar acesso temporário": conta provisória de atendente para freelancer/substituto. A
   * senha volta UMA vez nesta resposta (não fica legível em lugar nenhum). Vencido o prazo, a
   * conta expira sozinha e não serve para outro dia.
   */
  @Post('temporary')
  @UseGuards(PlanLimitGuard)
  @RequireLimit('maxAgents')
  async createTemporary(@CurrentUser() u: AuthUser, @Body() dto: TemporaryUserDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Informe o nome.');
    if (dto.scheduleId) {
      const ok = await this.prisma.workSchedule.count({ where: { id: dto.scheduleId, tenantId: u.tenantId } });
      if (!ok) throw new BadRequestException('Escala não encontrada.');
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId }, select: { slug: true } });
    const domain = tenant.slug.replace(/^-+|-+$/g, '') || 'conta';
    const email = `plantao-${randomBytes(4).toString('hex')}@${domain}.temp`;
    const password = randomBytes(9).toString('base64url');
    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + dto.hours * 3_600_000);
    const user = await this.prisma.user.create({
      data: {
        tenantId: u.tenantId, email, name, role: 'agent', passwordHash: await this.auth.hashPassword(password), passwordSetAt: now,
        isTemporary: true, accessExpiresAt, scheduleId: dto.scheduleId ?? null, temporaryCreatedById: u.impersonatorId ? null : u.id,
      },
      select: { id: true, name: true, email: true },
    });
    await this.provisioning.linkRoleProfile(u.tenantId, user.id, 'agent');
    // criado por quem é restrito: nasce no(s) condomínio(s) dele (docs/empresas.md#equipe)
    const empresas = creatorCompanyIds(u);
    if (empresas.length) await this.prisma.userCompany.createMany({ data: empresas.map((companyId) => ({ userId: user.id, companyId })), skipDuplicates: true });
    if (dto.numberIds?.length) {
      const valid = await this.prisma.whatsAppNumber.findMany({ where: { id: { in: dto.numberIds }, tenantId: u.tenantId, deletedAt: null }, select: { id: true } });
      await this.prisma.userNumber.createMany({ data: valid.map((n) => ({ userId: user.id, numberId: n.id })), skipDuplicates: true });
    }
    return { ...user, password, accessExpiresAt };
  }

  /** Encerra o acesso temporário antes do prazo (status EXPIRED, sessões derrubadas). */
  @Post('temporary/:id/expire')
  async expireTemporary(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, tenantId: u.tenantId, isTemporary: true, expiredAt: null, ...teamWhere(u) }, select: { id: true } });
    if (!target) throw new NotFoundException('Acesso temporário não encontrado ou já expirado.');
    await this.shift.expire(target.id);
    await this.shift.cutSessions([target.id]);
    this.gateway.emitShiftLocked(u.tenantId, target.id);
    return { ok: true };
  }
}

/**
 * Expira contas temporárias vencidas a cada minuto e limpa sessões antigas uma vez por dia
 * (03:30 UTC). `upsertJobScheduler` é idempotente entre instâncias.
 */
@Injectable()
class WorkSchedulesScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_WORK_SCHEDULES) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('temporary-expiry', { every: 60_000 }, { name: 'temporary-expiry' });
    await this.queue.upsertJobScheduler('refresh-token-purge', { pattern: '30 3 * * *' }, { name: 'refresh-token-purge' });
  }
}

@Processor(QUEUE_WORK_SCHEDULES)
class WorkSchedulesProcessor extends TrackedWorkerHost {
  constructor(
    private readonly shift: ShiftAccessService,
    private readonly auth: AuthService,
  ) {
    super(QUEUE_WORK_SCHEDULES);
  }
  protected async handle(job: Job) {
    if (job.name === 'refresh-token-purge') await this.auth.purgeStaleRefreshTokens();
    else await this.shift.expireDue();
  }
}

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_WORK_SCHEDULES, defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50 } }),
    AuthModule,
    BillingModule,
    TenantsModule,
    ConversationsModule,
  ],
  controllers: [WorkSchedulesController, UsersScheduleController, AccessRequestsController, PublicAccessRequestsController, ShiftController],
  providers: [WorkSchedulesScheduler, WorkSchedulesProcessor],
})
export class WorkSchedulesModule {}
