import { BadRequestException, Body, Controller, Get, Injectable, Logger, Module, OnModuleInit, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AuthModule } from '../auth/auth.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { NumbersService } from '../whatsapp/numbers.service';
import { ProviderRegistry } from '../whatsapp/providers/provider.registry';
import type { MetaProvider } from '../whatsapp/providers/meta.provider';
import { BillingModule } from './billing.module';
import { UsageService, periodOf } from './usage.service';

export const QUEUE_META_COSTS = 'meta-costs';
/** "Atualizar agora" na tela: no máximo uma leitura da Meta a cada 10 min por cliente */
const REFRESH_MIN_MS = 10 * 60_000;

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');
const monthRange = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
};

class BudgetDto {
  /** orçamento mensal em reais; null/0 = sem orçamento (sem aviso) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) budget?: number | null;
}

/**
 * Gasto com a API oficial (docs/gasto-meta.md). O cliente paga a Meta direto (cartão na WABA);
 * aqui ele acompanha: estimativa na hora pelo ledger + valor real lido do `pricing_analytics`
 * da WABA a cada 6 h, por número, tipo e dia, com orçamento e aviso em 80%/100%.
 */
@Injectable()
export class MetaCostsService {
  private readonly log = new Logger(MetaCostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumbersService,
    private readonly registry: ProviderRegistry,
    private readonly usage: UsageService,
  ) {}

  /** Relê da Meta o mês de um número e regrava os dias (a Meta revisa o dia com atraso). */
  async syncNumber(numberId: string, period = periodOf()) {
    const ctx = await this.numbers.context(numberId);
    if (ctx.provider !== 'meta') return 0;
    const { from, to } = monthRange(period);
    const end = Math.min(to.getTime(), Date.now());
    const meta = this.registry.get('meta') as unknown as MetaProvider;
    const { currency, points } = await meta.pricingAnalytics(ctx, Math.floor(from.getTime() / 1000), Math.floor(end / 1000));
    // a WABA pode ter outros números (do sistema antigo, de outro cliente): só os deste
    const meu = digits(ctx.phone);
    const comTelefone = points.some((p) => p.phone_number);
    const daqui = points.filter((p) => !comTelefone || digits(p.phone_number) === meu);
    // agrega por dia+categoria+tipo (a Meta pode devolver um ponto por país)
    const linhas = new Map<string, Prisma.MetaCostDailyCreateManyInput>();
    for (const p of daqui) {
      const day = new Date(p.start * 1000);
      day.setUTCHours(0, 0, 0, 0);
      const pricingCategory = (p.pricing_category ?? 'UNKNOWN').toUpperCase();
      const pricingType = (p.pricing_type ?? 'REGULAR').toUpperCase();
      const k = `${day.toISOString()}|${pricingCategory}|${pricingType}`;
      const atual = linhas.get(k);
      if (atual) {
        atual.volume = Number(atual.volume) + (p.volume ?? 0);
        atual.cost = Number(atual.cost) + (p.cost ?? 0);
      } else {
        linhas.set(k, { tenantId: ctx.tenantId, numberId, day, pricingCategory, pricingType, volume: p.volume ?? 0, cost: p.cost ?? 0, currency });
      }
    }
    await this.prisma.$transaction([
      this.prisma.metaCostDaily.deleteMany({ where: { numberId, day: { gte: from, lt: to } } }),
      this.prisma.metaCostDaily.createMany({ data: [...linhas.values()] }),
    ]);
    return linhas.size;
  }

  async syncTenant(tenantId: string, period = periodOf()) {
    const nums = await this.prisma.whatsAppNumber.findMany({ where: { tenantId, provider: 'meta', isActive: true, deletedAt: null }, select: { id: true, label: true } });
    for (const n of nums) {
      await this.syncNumber(n.id, period).catch((err) => this.log.warn(`gasto da Meta não lido (${n.label}): ${err?.message ?? err}`));
    }
    if (period === periodOf()) await this.usage.checkMetaBudget(tenantId, period);
  }

  /** Job a cada 6 h: mês corrente de todos; nos 3 primeiros dias, também fecha o mês anterior. */
  async syncAll() {
    const agora = new Date();
    const anterior = periodOf(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1)));
    const tenants = await this.prisma.whatsAppNumber.findMany({
      where: { provider: 'meta', isActive: true, deletedAt: null, tenant: { isActive: true } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    for (const { tenantId } of tenants) {
      if (agora.getUTCDate() <= 3) await this.syncTenant(tenantId, anterior);
      await this.syncTenant(tenantId);
    }
  }

  async summary(tenantId: string, period: string) {
    const { from, to } = monthRange(period);
    const [tenant, nums, spend, estCat, estNum, estDia, realCat, realNum, realDia] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { metaBudgetMonth: true } }),
      this.prisma.whatsAppNumber.findMany({ where: { tenantId, provider: 'meta', deletedAt: null }, select: { id: true, label: true, phone: true, isActive: true } }),
      this.usage.metaSpend(tenantId, period),
      this.prisma.messageUsage.groupBy({ by: ['billingCategory'], where: { tenantId, provider: 'meta', direction: 'out', occurredAt: { gte: from, lt: to } }, _count: { _all: true }, _sum: { providerCost: true } }),
      this.prisma.messageUsage.groupBy({ by: ['numberId'], where: { tenantId, provider: 'meta', occurredAt: { gte: from, lt: to } }, _sum: { providerCost: true } }),
      this.prisma.$queryRaw<{ day: Date; cost: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT date_trunc('day', "occurredAt") AS day, SUM("providerCost") AS cost
        FROM message_usage
        WHERE "tenantId" = ${tenantId} AND provider = 'meta' AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
        GROUP BY 1 ORDER BY 1`),
      this.prisma.metaCostDaily.groupBy({ by: ['pricingCategory', 'pricingType'], where: { tenantId, day: { gte: from, lt: to } }, _sum: { volume: true, cost: true } }),
      this.prisma.metaCostDaily.groupBy({ by: ['numberId'], where: { tenantId, day: { gte: from, lt: to } }, _sum: { cost: true } }),
      this.prisma.metaCostDaily.groupBy({ by: ['day'], where: { tenantId, day: { gte: from, lt: to } }, _sum: { cost: true }, orderBy: { day: 'asc' } }),
    ]);
    const real = spend.real[0] ?? null;
    // projeção só no mês corrente: ritmo até agora × dias do mês (o real, se já existe, manda)
    const agora = new Date();
    const corrente = period === periodOf(agora);
    const diasMes = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate();
    const base = real && real.currency === 'BRL' ? Math.max(real.total, spend.estimated) : spend.estimated;
    const decorrido = corrente ? (agora.getTime() - from.getTime()) / 86_400_000 : diasMes;
    const projection = corrente && decorrido >= 1 ? (base / decorrido) * diasMes : null;
    const dias = new Map<string, { day: string; estimated: number; real: number | null }>();
    for (const d of estDia) dias.set(d.day.toISOString().slice(0, 10), { day: d.day.toISOString().slice(0, 10), estimated: Number(d.cost ?? 0), real: null });
    for (const d of realDia) {
      const k = d.day.toISOString().slice(0, 10);
      dias.set(k, { day: k, estimated: dias.get(k)?.estimated ?? 0, real: Number(d._sum.cost ?? 0) });
    }
    return {
      period,
      hasMeta: nums.length > 0,
      budget: tenant?.metaBudgetMonth != null ? Number(tenant.metaBudgetMonth) : null,
      estimated: spend.estimated,
      real: real && { ...real, currencies: spend.real.length },
      projection,
      byCategory: {
        estimated: estCat.map((c) => ({ category: c.billingCategory, count: c._count._all, cost: Number(c._sum.providerCost ?? 0) })),
        real: realCat.map((c) => ({ category: c.pricingCategory, type: c.pricingType, volume: c._sum.volume ?? 0, cost: Number(c._sum.cost ?? 0) })),
      },
      byNumber: nums.map((n) => ({
        numberId: n.id,
        label: n.label,
        phone: n.phone,
        isActive: n.isActive,
        estimated: Number(estNum.find((e) => e.numberId === n.id)?._sum.providerCost ?? 0),
        real: realNum.some((r) => r.numberId === n.id) ? Number(realNum.find((r) => r.numberId === n.id)?._sum.cost ?? 0) : null,
      })),
      byDay: [...dias.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  }

  async setBudget(tenantId: string, budget: number | null) {
    await this.prisma.$transaction([
      this.prisma.tenant.update({ where: { id: tenantId }, data: { metaBudgetMonth: budget || null } }),
      // orçamento novo: os avisos do mês voltam a valer contra ele
      this.prisma.usageAlert.deleteMany({ where: { tenantId, period: periodOf(), metric: 'meta_cost' } }),
    ]);
    await this.usage.checkMetaBudget(tenantId);
    return { budget: budget || null };
  }
}

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class MetaCostsController {
  /** última leitura manual por cliente (memória da réplica: basta para não martelar a Meta) */
  private readonly ultimaLeitura = new Map<string, number>();

  constructor(private readonly costs: MetaCostsService) {}

  private tenant(user: AuthUser) {
    if (!user.tenantId) throw new BadRequestException('Entre como um cliente para ver o gasto com a Meta.');
    return user.tenantId;
  }

  @Get('meta-costs')
  @RequirePermission('billing.manage')
  summary(@CurrentUser() user: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : periodOf();
    return this.costs.summary(this.tenant(user), p);
  }

  @Post('meta-costs/refresh')
  @RequirePermission('billing.manage')
  async refresh(@CurrentUser() user: AuthUser) {
    const tenantId = this.tenant(user);
    const ultima = this.ultimaLeitura.get(tenantId) ?? 0;
    if (Date.now() - ultima < REFRESH_MIN_MS) throw new BadRequestException('O gasto foi atualizado há pouco. Tente de novo em alguns minutos.');
    this.ultimaLeitura.set(tenantId, Date.now());
    await this.costs.syncTenant(tenantId);
    return { ok: true };
  }

  @Patch('meta-budget')
  @RequirePermission('billing.manage')
  budget(@CurrentUser() user: AuthUser, @Body() dto: BudgetDto) {
    return this.costs.setBudget(this.tenant(user), dto.budget ?? null);
  }
}

@Processor(QUEUE_META_COSTS)
export class MetaCostsProcessor extends TrackedWorkerHost {
  constructor(private readonly costs: MetaCostsService) {
    super(QUEUE_META_COSTS);
  }
  protected async handle(job: Job) {
    if (job.name === 'sync') await this.costs.syncAll();
  }
}

/** A cada 6 h (minuto 20, fora do pico dos outros jobs). Idempotente entre instâncias. */
@Injectable()
export class MetaCostsScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_META_COSTS) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('meta-costs-sync', { pattern: '20 */6 * * *' }, { name: 'sync' });
  }
}

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_META_COSTS, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 20 } }),
    AuthModule,
    BillingModule,
    WhatsAppModule,
  ],
  controllers: [MetaCostsController],
  providers: [MetaCostsService, MetaCostsProcessor, MetaCostsScheduler],
})
export class MetaCostsModule {}
