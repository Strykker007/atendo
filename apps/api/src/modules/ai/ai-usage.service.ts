import { Injectable } from '@nestjs/common';
import type { AiTaskKind } from '@prisma/client';
import { aiCostUsd } from '@atendo/shared';
import { isLocalEndpoint } from './providers/base-url';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { env } from '../../config/env';
import { AppLogger } from '../../common/observability/app-logger';
import { MailService } from '../../common/mail/mail.service';
import { creditCharge, platformBudgetStatus, type AiUsageSnapshot } from './ai-quota';

/**
 * Custo de uma chamada em USD. Ordem: endpoint local = 0 → preço do ambiente (endpoint
 * alternativo) → tabela por modelo (que assume o mais caro quando não conhece).
 */
export function costOf(model: string, tokensIn: number, tokensOut: number, ownKey = false) {
  // chave do cliente vai sempre ao endpoint oficial: preço de tabela, sem as variáveis da plataforma
  if (ownKey) return aiCostUsd(model, tokensIn, tokensOut);
  if (isLocalEndpoint()) return 0;
  const { AI_PRICE_IN_PER_1K: i, AI_PRICE_OUT_PER_1K: o } = env;
  if (i !== undefined || o !== undefined) return (tokensIn / 1000) * (i ?? 0) + (tokensOut / 1000) * (o ?? 0);
  return aiCostUsd(model, tokensIn, tokensOut);
}

/** gastam (custo e teto), mas não contam como interação do plano */
const NOT_INTERACTION: AiTaskKind[] = ['knowledge'];

export const aiPeriodOf = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const key = (tenantId: string, period: string, metric: 'count' | 'cost') => `ai:${tenantId}:${period}:${metric}`;
/** gasto somado de todos os tenants — o que de fato sai do crédito da conta do fornecedor */
const platformKey = (period: string) => `ai:_platform:${period}:cost`;
const alertKey = (period: string, level: number) => `ai:_platform:${period}:alert:${level}`;

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
    private readonly mail: MailService,
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
    /** chave do próprio cliente: grava a linha, mas não soma na cota, no teto nem no orçamento */
    ownKey?: boolean;
    /** custo já calculado (embeddings: preço por token próprio, fora da tabela de modelos de chat) */
    costUsd?: number;
    /** pago com o saldo de IA: desconta custo × (1 + margem%) da carteira (docs/15-ia.md#saldo-de-ia) */
    creditMarkupPct?: number;
  }) {
    const { costUsd: fixed, creditMarkupPct, ...row } = input;
    const costUsd = input.error ? 0 : (fixed ?? costOf(input.model, input.tokensIn, input.tokensOut, input.ownKey));
    const costBrl = costUsd * env.USD_BRL_RATE;
    const creditBrl = creditMarkupPct !== undefined && !input.error ? creditCharge(costBrl, creditMarkupPct) : 0;
    await this.prisma.aiUsage.create({ data: { ...row, ownKey: !!input.ownKey, costUsd, costBrl, creditBrl } });
    // atômico: duas respostas ao mesmo tempo não leem o mesmo saldo (pode ficar levemente negativo na última)
    if (creditBrl > 0) await this.prisma.aiCreditWallet.updateMany({ where: { tenantId: input.tenantId }, data: { balanceBrl: { decrement: creditBrl } } });
    if (input.error || input.ownKey) return { costUsd, costBrl };

    const period = aiPeriodOf();
    const multi = this.redis.multi();
    // embeddings de documento custam (entra no teto), mas não são uma interação com o contato
    if (!NOT_INTERACTION.includes(input.kind)) multi.incr(key(input.tenantId, period, 'count'));
    // custo em centavos de centavo (inteiro) — INCRBYFLOAT perde precisão entre réplicas
    multi.incrby(key(input.tenantId, period, 'cost'), Math.round(costBrl * 10_000));
    multi.incrby(platformKey(period), Math.round(costBrl * 10_000));
    await multi.exec();
    if (costBrl > 0) await this.alertPlatformBudget(period).catch((e) => this.log.warn(`alerta de orçamento de IA falhou: ${e}`));
    return { costUsd, costBrl };
  }

  /** Gasto do mês somando todos os tenants, em BRL. */
  async platformCost(period = aiPeriodOf()) {
    return Number((await this.redis.get(platformKey(period))) ?? 0) / 10_000;
  }

  /** Avisa o dono da conta em 50/80/100% do orçamento — uma vez por faixa por mês. */
  private async alertPlatformBudget(period: string) {
    const budget = env.AI_PLATFORM_BUDGET_BRL;
    const spent = await this.platformCost(period);
    const { level } = platformBudgetStatus(spent, budget);
    if (level === null) return;
    // NX: entre réplicas, só a primeira que cruzar a faixa manda o e-mail
    const first = await this.redis.set(alertKey(period, level), '1', 'EX', 40 * 86_400, 'NX');
    if (!first) return;
    const msg = `Gasto com IA em ${period}: R$ ${spent.toFixed(2)} de R$ ${budget.toFixed(2)} (${level}%).`;
    this.log.warn(msg);
    if (!env.AI_ALERT_EMAIL) return;
    await this.mail.send({
      to: env.AI_ALERT_EMAIL.split(',').map((e) => e.trim()).filter(Boolean),
      subject: level >= 100 ? 'Atendo: IA desligada — orçamento do mês atingido' : `Atendo: IA em ${level}% do orçamento do mês`,
      text: `${msg}\n\n${level >= 100
        ? 'A IA foi desligada para todos os clientes até virar o mês: o copiloto responde indisponível e os fluxos seguem pela saída "Não conseguiu". Para religar, aumente AI_PLATFORM_BUDGET_BRL e reinicie a API.'
        : 'Ao atingir 100% a IA é desligada para todos os clientes até virar o mês. Confira o consumo por cliente na tabela ai_usage e o crédito no console do fornecedor.'}`,
    });
  }

  /** Consumo do mês para o guard de quota. */
  async current(tenantId: string, period = aiPeriodOf()): Promise<AiUsageSnapshot> {
    const [count, cost] = await this.redis.mget(key(tenantId, period, 'count'), key(tenantId, period, 'cost'));
    return { interactions: Number(count ?? 0), costBrl: Number(cost ?? 0) / 10_000 };
  }

  /** Reconstrói os contadores a partir do ledger (job diário e conserto manual). */
  async reconcile(period = aiPeriodOf()) {
    const [y, m] = period.split('-').map(Number);
    const where = { occurredAt: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }, error: null, ownKey: false };
    const [rows, counted] = await Promise.all([
      this.prisma.aiUsage.groupBy({ by: ['tenantId'], where, _sum: { costBrl: true } }),
      this.prisma.aiUsage.groupBy({ by: ['tenantId'], where: { ...where, kind: { notIn: NOT_INTERACTION } }, _count: { _all: true } }),
    ]);
    const countOf = new Map(counted.map((c) => [c.tenantId, c._count._all]));
    const total = rows.reduce((sum, r) => sum + Number(r._sum.costBrl ?? 0), 0);
    await this.redis.set(platformKey(period), Math.round(total * 10_000));
    for (const r of rows) {
      await this.redis.mset(
        key(r.tenantId, period, 'count'), countOf.get(r.tenantId) ?? 0,
        key(r.tenantId, period, 'cost'), Math.round(Number(r._sum.costBrl ?? 0) * 10_000),
      );
    }
    this.log.log(`IA reconciliada para ${rows.length} tenants em ${period}`);
  }

  /** Consumo detalhado para a tela de Plano e uso e para o financeiro do dono. */
  async summary(tenantId: string, period = aiPeriodOf()) {
    const [y, m] = period.split('-').map(Number);
    const where = { tenantId, occurredAt: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } };
    // só chamadas bem-sucedidas contam como interação; as que falharam entram em `failed`
    // chave própria do cliente fica fora da cota: contada à parte (`ownKeyInteractions`)
    const ok = { ...where, error: null, ownKey: false };
    const [byKind, total, failed, own] = await Promise.all([
      this.prisma.aiUsage.groupBy({ by: ['kind'], where: ok, _count: { _all: true }, _sum: { costBrl: true, tokensIn: true, tokensOut: true } }),
      this.prisma.aiUsage.aggregate({ where: ok, _sum: { costBrl: true } }),
      this.prisma.aiUsage.count({ where: { ...where, NOT: { error: null } } }),
      this.prisma.aiUsage.count({ where: { ...where, error: null, ownKey: true } }),
    ]);
    return {
      period,
      interactions: byKind.filter((k) => !NOT_INTERACTION.includes(k.kind)).reduce((s, k) => s + k._count._all, 0),
      costBrl: Number(total._sum.costBrl ?? 0),
      failed,
      ownKeyInteractions: own,
      byKind: byKind.map((k) => ({ kind: k.kind, count: k._count._all, costBrl: Number(k._sum.costBrl ?? 0), tokensIn: k._sum.tokensIn ?? 0, tokensOut: k._sum.tokensOut ?? 0 })),
    };
  }
}
