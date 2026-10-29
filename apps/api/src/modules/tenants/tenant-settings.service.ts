import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeRankingWeights, type WelcomeMessage, type WelcomeMode } from '@atendo/shared';
import { Prisma as PrismaNS } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SettingsUpdate {
  timezone?: string;
  attendanceActive?: boolean;
  welcomeFlowId?: string | null;
  closedFlowId?: string | null;
  onCloseFlowId?: string | null;
  wonFlowId?: string | null;
  lostFlowId?: string | null;
  requireSaleValue?: boolean;
  salesEnabled?: boolean;
  companyIsolation?: boolean;
  requireSignature?: boolean;
  budgetQuoteItems?: string;
  requireReasonOnWon?: boolean;
  requireReasonOnLost?: boolean;
  rankingWeights?: Record<string, number> | null;
  wonLabel?: string;
  lostLabel?: string;
  defaultFlowId?: string | null;
  defaultFlowInactivityHours?: number;
  welcomeMessages?: WelcomeMessage[];
  welcomeMode?: WelcomeMode;
  welcomeEnabled?: boolean;
  secureMediaText?: string | null;
  publicLogoKey?: string | null;
  transferMessageEnabled?: boolean;
  transferMessageText?: string | null;
  departmentTransferMessageText?: string | null;
  closeMessageEnabled?: boolean;
  closeMessageText?: string | null;
}

export const OUTCOME_LABELS_DEFAULT = { won: 'Comprou', lost: 'Não comprou' } as const;

@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria na primeira leitura — cliente novo não precisa configurar nada para funcionar. */
  get(tenantId: string) {
    return this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  }

  async update(tenantId: string, dto: SettingsUpdate) {
    const { welcomeMessages, wonLabel, lostLabel, rankingWeights, secureMediaText, transferMessageText, departmentTransferMessageText, closeMessageText, ...rest } = dto;
    const data: Prisma.TenantSettingsUncheckedUpdateInput = {
      ...rest,
      ...(welcomeMessages && { welcomeMessages: welcomeMessages as unknown as Prisma.InputJsonValue }),
      // pesos fora de 0–100 viram o limite; todos zero = padrão (normalizeRankingWeights)
      ...(rankingWeights !== undefined && { rankingWeights: rankingWeights === null ? PrismaNS.DbNull : (normalizeRankingWeights(rankingWeights) as unknown as Prisma.InputJsonValue) }),
      // apagar o nome volta ao padrão: resultado sem nome deixaria o botão do encerramento vazio
      ...(wonLabel !== undefined && { wonLabel: wonLabel.trim() || OUTCOME_LABELS_DEFAULT.won }),
      ...(lostLabel !== undefined && { lostLabel: lostLabel.trim() || OUTCOME_LABELS_DEFAULT.lost }),
      // frase vazia = volta à padrão
      ...(secureMediaText !== undefined && { secureMediaText: secureMediaText?.trim() || null }),
      ...(transferMessageText !== undefined && { transferMessageText: transferMessageText?.trim() || null }),
      ...(departmentTransferMessageText !== undefined && { departmentTransferMessageText: departmentTransferMessageText?.trim() || null }),
      ...(closeMessageText !== undefined && { closeMessageText: closeMessageText?.trim() || null }),
    };
    if (dto.attendanceActive !== undefined) {
      // cada vez que liga/desliga é um período novo da faixa Fechado (a resposta sai de novo)
      const cur = await this.get(tenantId);
      if (cur.attendanceActive !== dto.attendanceActive) data.attendanceChangedAt = new Date();
    }
    await this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { ...(data as Prisma.TenantSettingsUncheckedCreateInput), tenantId }, update: data });
    return this.get(tenantId);
  }

  /** Nome dos resultados do encerramento na empresa (mensagens de erro da API). */
  async outcomeLabels(tenantId: string) {
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { wonLabel: true, lostLabel: true } });
    return { won: s?.wonLabel || OUTCOME_LABELS_DEFAULT.won, lost: s?.lostLabel || OUTCOME_LABELS_DEFAULT.lost };
  }

  /** Fuso do cliente. Usado pela agenda, pelos fluxos e pelos relatórios. */
  async timezone(tenantId: string) {
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    return s?.timezone || 'America/Sao_Paulo';
  }

  /**
   * Boas-vindas da vez: aleatória ou a próxima da fila (sequencial). O contador incrementa no
   * banco (atômico), então dois contatos chegando juntos não recebem a mesma no sequencial.
   */
  async nextWelcome(tenantId: string): Promise<WelcomeMessage | null> {
    const s = await this.get(tenantId);
    if (!s.welcomeEnabled) return null;
    const list = ((s.welcomeMessages as unknown as WelcomeMessage[] | null) ?? []).filter((w) => w.items?.length);
    if (!list.length) return null;
    if (s.welcomeMode !== 'sequential') return list[Math.floor(Math.random() * list.length)];
    const { welcomeCursor } = await this.prisma.tenantSettings.update({ where: { tenantId }, data: { welcomeCursor: { increment: 1 } }, select: { welcomeCursor: true } });
    return list[(welcomeCursor - 1) % list.length];
  }
}
