import { BadRequestException, Body, Controller, Get, Module, Param, Put, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { vendasPorConsultorSql } from '../../common/reports/sales-base';
import { RedisService } from '../../common/redis/redis.service';
import { ReportLoadService } from '../../common/reports/report-load.service';
import { TZ_DEFAULT, localToUtc } from '../../common/time';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { goalProgress } from './goal-progress';
import { BillingModule } from '../billing/billing.module';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';

/** meta padrão do mês: vale para todo atendente sem meta própria */
export const DEFAULT_GOAL_USER = '*';
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

class GoalTargetDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999_999_999) revenueTarget?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) wonTarget?: number | null;
}
class UserGoalDto extends GoalTargetDto {
  @IsString() @MaxLength(40) userId: string;
}
class SaveGoalsDto {
  /** meta padrão (atendentes sem meta própria); nulo/ausente = sem padrão */
  @IsOptional() @ValidateNested() @Type(() => GoalTargetDto) default?: GoalTargetDto | null;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => UserGoalDto) goals: UserGoalDto[];
}

function assertMonth(month: string) {
  if (!MES.test(month)) throw new BadRequestException('Mês inválido (use AAAA-MM).');
}
const proximoMes = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const vazio = (g: { revenueTarget?: number | null; wonTarget?: number | null }) => !(g.revenueTarget && g.revenueTarget > 0) && !(g.wonTarget && g.wonTarget > 0);
const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

/**
 * Metas mensais de vendas por consultor (docs/metas.md). Cadastrar: `team.manage`; ver o
 * progresso: `reports.view`. O mês é o do fuso do cliente.
 */
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('consultant_ranking')
class GoalsController {
  constructor(private readonly prisma: PrismaService, private readonly load: ReportLoadService, private readonly redis: RedisService) {}

  @Get('sales-goals/:month')
  @RequirePermission('reports.view')
  async list(@CurrentUser() u: AuthUser, @Param('month') month: string) {
    assertMonth(month);
    const rows = await this.prisma.salesGoal.findMany({ where: { tenantId: u.tenantId, month }, select: { userId: true, revenueTarget: true, wonTarget: true } });
    const padrao = rows.find((r) => r.userId === DEFAULT_GOAL_USER);
    return {
      month,
      default: padrao ? { revenueTarget: num(padrao.revenueTarget), wonTarget: padrao.wonTarget } : null,
      goals: rows.filter((r) => r.userId !== DEFAULT_GOAL_USER).map((r) => ({ userId: r.userId, revenueTarget: num(r.revenueTarget), wonTarget: r.wonTarget })),
    };
  }

  /** Substitui as metas do mês inteiro (o que não veio sai). */
  @Put('sales-goals/:month')
  @RequirePermission('team.manage')
  async save(@CurrentUser() u: AuthUser, @Param('month') month: string, @Body() dto: SaveGoalsDto) {
    assertMonth(month);
    const ids = [...new Set(dto.goals.map((g) => g.userId))];
    if (ids.length !== dto.goals.length) throw new BadRequestException('Consultor repetido na lista de metas.');
    const validos = await this.prisma.user.count({ where: { tenantId: u.tenantId, id: { in: ids } } });
    if (validos !== ids.length) throw new BadRequestException('Consultor inválido na lista de metas.');
    const linhas = [
      ...(dto.default && !vazio(dto.default) ? [{ userId: DEFAULT_GOAL_USER, ...dto.default }] : []),
      ...dto.goals.filter((g) => !vazio(g)),
    ];
    await this.prisma.$transaction([
      this.prisma.salesGoal.deleteMany({ where: { tenantId: u.tenantId, month } }),
      this.prisma.salesGoal.createMany({
        data: linhas.map((g) => ({ tenantId: u.tenantId, month, userId: g.userId, revenueTarget: g.revenueTarget && g.revenueTarget > 0 ? g.revenueTarget : null, wonTarget: g.wonTarget && g.wonTarget > 0 ? g.wonTarget : null, updatedById: u.id })),
      }),
    ]);
    // o progresso do mês fica em cache curto: meta nova tem de aparecer na hora
    await this.redis.del(`report:${ReportLoadService.key(u.tenantId, 'goals', { month })}`).catch(() => undefined);
    return this.list(u, month);
  }

  /**
   * Progresso do mês por consultor: realizado (vendas encerradas como "Comprou" por ele), meta,
   * % atingido, ritmo esperado para o dia e projeção do fim do mês. Ordenado por atingimento.
   */
  @Get('reports/goals')
  @RequirePermission('reports.view')
  async progress(@CurrentUser() u: AuthUser, @Query('month') month?: string) {
    const t = u.tenantId;
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId: t }, select: { timezone: true } });
    const tz = settings?.timezone || TZ_DEFAULT;
    const agora = new Date();
    const mes = month ?? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(agora).slice(0, 7);
    assertMonth(mes);
    return this.load.cached(ReportLoadService.key(t, 'goals', { month: mes }), async () => {
      const from = localToUtc(`${mes}-01`, '00:00', tz);
      const to = localToUtc(`${proximoMes(mes)}-01`, '00:00', tz);
      const [metas, vendas, users] = await this.load.all([
        () => this.prisma.salesGoal.findMany({ where: { tenantId: t, month: mes } }),
        // mesma base do ranking: encerramentos com ator, fora os internos
        // mesma régua do ranking: "Comprou" + orçamento pago ainda sem encerramento − estornos
        () => this.prisma.$queryRaw<{ userId: string; won: number; revenue: number | null }[]>(vendasPorConsultorSql(t, from, to)),
        () => this.prisma.user.findMany({ where: { tenantId: t }, select: { id: true, name: true, role: true, isActive: true } }),
      ]);
      const padrao = metas.find((m) => m.userId === DEFAULT_GOAL_USER);
      const propria = new Map(metas.filter((m) => m.userId !== DEFAULT_GOAL_USER).map((m) => [m.userId, m]));
      const vendeu = new Map(vendas.map((v) => [v.userId, v]));
      // quem entra: atendente ativo (recebe a padrão), quem tem meta própria e quem vendeu no mês
      const pessoas = users.filter((x) => propria.has(x.id) || vendeu.has(x.id) || (x.isActive && x.role === 'agent' && padrao));
      const elapsed = Math.min(1, Math.max(0, (agora.getTime() - from.getTime()) / (to.getTime() - from.getTime())));
      const linhas = pessoas.map((p) => {
        const meta = propria.get(p.id) ?? padrao ?? null;
        const v = vendeu.get(p.id);
        const prog = goalProgress({ revenue: Number(v?.revenue ?? 0), won: Number(v?.won ?? 0) }, meta ? { revenueTarget: num(meta.revenueTarget), wonTarget: meta.wonTarget } : null, elapsed);
        return { userId: p.id, name: p.name, isActive: p.isActive, goalSource: propria.has(p.id) ? 'own' : meta ? 'default' : null, ...prog };
      });
      // com meta primeiro, por atingimento; sem meta no fim, por faturamento
      linhas.sort((a, b) => (b.attainment ?? -1) - (a.attainment ?? -1) || b.revenue - a.revenue || a.name.localeCompare(b.name));
      const totalMeta = linhas.reduce((a, l) => a + (l.revenueTarget ?? 0), 0);
      const totalVendido = linhas.reduce((a, l) => a + l.revenue, 0);
      return {
        month: mes,
        from,
        to,
        elapsedPct: Math.round(elapsed * 1000) / 10,
        team: { revenue: totalVendido, revenueTarget: totalMeta || null, revenuePct: totalMeta ? Math.round((totalVendido / totalMeta) * 1000) / 10 : null, won: linhas.reduce((a, l) => a + l.won, 0) },
        ranking: linhas.map((l, i) => ({ position: l.attainment != null ? i + 1 : null, ...l })),
      };
    });
  }
}

@Module({ imports: [AuthModule, BillingModule], controllers: [GoalsController] })
export class GoalsModule {}
