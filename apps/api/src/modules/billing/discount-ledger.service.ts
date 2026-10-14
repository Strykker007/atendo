import { Injectable } from '@nestjs/common';
import type { DiscountKind, DiscountSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface GrantInput {
  tenantId: string;
  plan: { id: string; name: string; priceMonth: { toString(): string } | number };
  priceMonth: number;
  kind: DiscountKind;
  source: DiscountSource;
  promotion?: { id: string; name: string } | null;
  units?: number;
  endsAt: Date | null;
  /** quem concedeu; ausente = automático (checkout) */
  by?: { id: string; name: string } | null;
}

/**
 * Livro de descontos (docs/05-planos-e-cobranca.md#livro-de-descontos): toda concessão de valor
 * diferente do de tabela vira uma linha permanente — é o que a contabilidade lê e o Financeiro
 * soma. Só Prisma, de propósito: checkout, criação de cliente, troca de plano e personalização
 * registram por aqui sem dependência circular entre os serviços de cobrança.
 */
@Injectable()
export class DiscountLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra uma concessão; a que estava correndo para o cliente termina agora (foi substituída). */
  async open(input: GrantInput, db: Db = this.prisma, now = new Date()) {
    await this.close(input.tenantId, db, now);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { name: true, subscription: { select: { units: true } } } });
    const list = Number(input.plan.priceMonth);
    return db.discountGrant.create({
      data: {
        tenantId: input.tenantId,
        planId: input.plan.id,
        promotionId: input.promotion?.id ?? null,
        kind: input.kind,
        source: input.source,
        tenantName: tenant.name,
        planName: input.plan.name,
        promotionName: input.promotion?.name ?? null,
        listPrice: list,
        priceMonth: input.priceMonth,
        discountPercent: list > 0 ? Math.round(((list - input.priceMonth) / list) * 10_000) / 100 : 0,
        units: Math.max(1, input.units ?? tenant.subscription?.units ?? 1),
        startsAt: now,
        endsAt: input.endsAt,
        grantedById: input.by?.id ?? null,
        grantedByName: input.by?.name ?? null,
      },
    });
  }

  /** Encerra antes do previsto a concessão que ainda corre (removida, substituída, trocou de plano). */
  close(tenantId: string, db: Db = this.prisma, at = new Date()) {
    return db.discountGrant.updateMany({
      where: { tenantId, closedAt: null, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
      data: { closedAt: at },
    });
  }
}

/** Fim efetivo de uma concessão: o que vier primeiro entre o previsto e o encerramento. */
export function grantEnd(g: { endsAt: Date | null; closedAt: Date | null }): Date | null {
  if (g.endsAt && g.closedAt) return g.endsAt < g.closedAt ? g.endsAt : g.closedAt;
  return g.closedAt ?? g.endsAt;
}

/**
 * Desconto que uma concessão representa num mês (`AAAA-MM`): diferença × unidades, se ela valeu
 * em algum momento do mês. Aproximação mensal de propósito — a cobrança também é mensal.
 */
export function grantDiscountIn(g: { listPrice: number; priceMonth: number; units: number; startsAt: Date; endsAt: Date | null; closedAt: Date | null }, period: string): number {
  const [y, m] = period.split('-').map(Number);
  const inicio = new Date(Date.UTC(y, m - 1, 1));
  const fim = new Date(Date.UTC(y, m, 1));
  const ate = grantEnd(g);
  if (g.startsAt >= fim || (ate && ate <= inicio)) return 0;
  return Math.round((g.listPrice - g.priceMonth) * Math.max(1, g.units) * 100) / 100;
}
