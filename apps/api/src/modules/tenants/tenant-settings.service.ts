import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WelcomeMessage, WelcomeMode } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SettingsUpdate {
  timezone?: string;
  attendanceActive?: boolean;
  welcomeFlowId?: string | null;
  closedFlowId?: string | null;
  onCloseFlowId?: string | null;
  wonFlowId?: string | null;
  lostFlowId?: string | null;
  noneFlowId?: string | null;
  defaultFlowId?: string | null;
  defaultFlowInactivityHours?: number;
  welcomeMessages?: WelcomeMessage[];
  welcomeMode?: WelcomeMode;
  welcomeEnabled?: boolean;
  quickReplyDelaySec?: number;
}

@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria na primeira leitura — cliente novo não precisa configurar nada para funcionar. */
  get(tenantId: string) {
    return this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  }

  async update(tenantId: string, dto: SettingsUpdate) {
    const { welcomeMessages, ...rest } = dto;
    const data: Prisma.TenantSettingsUncheckedUpdateInput = { ...rest, ...(welcomeMessages && { welcomeMessages: welcomeMessages as unknown as Prisma.InputJsonValue }) };
    if (dto.attendanceActive !== undefined) {
      // cada vez que liga/desliga é um período novo da faixa Fechado (a resposta sai de novo)
      const cur = await this.get(tenantId);
      if (cur.attendanceActive !== dto.attendanceActive) data.attendanceChangedAt = new Date();
    }
    await this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { ...(data as Prisma.TenantSettingsUncheckedCreateInput), tenantId }, update: data });
    return this.get(tenantId);
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
