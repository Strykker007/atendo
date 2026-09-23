import { Injectable } from '@nestjs/common';
import type { AiTaskKind } from '@prisma/client';
import { aiCostUsd } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { env } from '../../config/env';
import { AppLogger } from '../../common/observability/app-logger';
import type { AiUsageSnapshot } from './ai-quota';

export const aiPeriodOf = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const key = (tenantId: string, period: string, metric: 'count' | 'cost') => `ai:${tenantId}:${period}:${metric}`;

/**
 * Ledger de IA. Mesmo desenho do de mensagens: o Postgres é a fonte da verdade,
 * o Redis é o contador rápido lido antes de cada chamada.
 */
@Injectable()
export class AiUsageService {
  private readonly log = new AppLogger(AiUsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Grava a chamada (inclusive as que falharam — a linha de erro serve para diagnóstico). */
  async record(input: {
    tenantId: string;
    kind: AiTaskKind;
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    conversationId?: string;
    userId?: string;
    latencyMs?: number;
    error?: string;
  }) {
    const costUsd = input.error ? 0 : aiCostUsd(input.model, input.tokensIn, input.tokensOut);
    const costBrl = costUsd * env.USD_BRL_RATE;
    await this.prisma.aiUsage.create({ data: { ...input, costUsd, costBrl } });
    if (input.error) return { costUsd, costBrl };

    const period = aiPeriodOf();
    const multi = this.redis.multi();
    multi.incr(key(input.tenantId, period, 'count'));
    // custo em centavos de centavo (inteiro) — INCRBYFLOAT perde precisão entre réplicas
    multi.incrby(key(input.tenantId, period, 'cost'), Math.round(costBrl * 10_000));
    await multi.exec();
    return { costUsd, costBrl };
  }

  /** Consumo do mês para o guard de quota. */
  async current(tenantId: string, period = aiPeriodOf()): Promise<AiUsageSnapshot> {
    const [count, cost] = await this.redis.mget(key(tenantId, period, 'count'), key(tenantId, period, 'cost'));
    return { interactions: Number(count ?? 0), costBrl: Number(cost ?? 0) / 10_000 };
  }

  /** Reconstrói os contadores a partir do ledger (job diário e conserto manual). */
  async reconcile(period = aiPeriodOf()) {
    const [y, m] = period.split('-').map(Number);
    const rows = await this.prisma.aiUsage.groupBy({
      by: ['tenantId'],
      where: { occurredAt: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }, error: null },
      _count: { _all: true },
      _sum: { costBrl: true },
    });
    for (const r of rows) {
      await this.redis.mset(
        key(r.tenantId, period, 'count'), r._count._all,
        key(r.tenantId, period, 'cost'), Math.round(Number(r._sum.costBrl ?? 0) * 10_000),
      );
    }
    this.log.log(`IA reconciliada para ${rows.length} tenants em ${period}`);
  }

  /** Consumo detalhado para a tela de Plano e uso e para o financeiro do dono. */
  async summary(tenantId: string, period = aiPeriodOf()) {
    const [y, m] = period.split('-').map(Number);
    const where = { tenantId, occurredAt: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } };
    const [byKind, total] = await Promise.all([
      this.prisma.aiUsage.groupBy({ by: ['kind'], where, _count: { _all: true }, _sum: { costBrl: true, tokensIn: true, tokensOut: true } }),
      this.prisma.aiUsage.aggregate({ where: { ...where, error: null }, _count: { _all: true }, _sum: { costBrl: true } }),
    ]);
    return {
      period,
      interactions: total._count._all,
      costBrl: Number(total._sum.costBrl ?? 0),
      byKind: byKind.map((k) => ({ kind: k.kind, count: k._count._all, costBrl: Number(k._sum.costBrl ?? 0), tokensIn: k._sum.tokensIn ?? 0, tokensOut: k._sum.tokensOut ?? 0 })),
    };
  }
}
