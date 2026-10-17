import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TZ_DEFAULT } from '../../common/time';
import { localOf } from '../tenants/schedule-clock';
import { isWithinShift, type ShiftRule } from './shift-window';

export const OUT_OF_SCHEDULE = 'FOR_OUT_OF_SCHEDULE';
export const ACCOUNT_EXPIRED = 'ACCOUNT_EXPIRED';

/** O que a trava precisa saber do usuário (vem do `findUnique` do login/refresh). */
export interface ShiftSubject {
  id: string;
  tenantId: string | null;
  role: string;
  scheduleId: string | null;
  isTemporary: boolean;
  accessExpiresAt: Date | null;
  expiredAt: Date | null;
}

/**
 * Trava de acesso por turno e validade de conta temporária (docs/escalas.md). Chamada no
 * login e em cada refresh: o access token dura poucos minutos, então quem sai do turno cai
 * na próxima renovação.
 *
 * Admin da conta e dono do sistema nunca são travados — alguém precisa conseguir entrar
 * para liberar os outros.
 */
@Injectable()
export class ShiftAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanAccess(user: ShiftSubject, now = new Date()) {
    if (user.isTemporary && (user.expiredAt || (user.accessExpiresAt && user.accessExpiresAt <= now))) {
      if (!user.expiredAt) await this.expire(user.id, now);
      throw new ForbiddenException({ statusCode: 403, code: ACCOUNT_EXPIRED, message: `${ACCOUNT_EXPIRED}: Este acesso temporário expirou. Peça um novo ao gestor.` });
    }
    if (user.role === 'super_admin' || user.role === 'tenant_admin' || !user.scheduleId || !user.tenantId) return;
    if (await this.onShift(user.tenantId, user.scheduleId, now)) return;
    if (await this.activeOverride(user.id, now)) return;
    throw new ForbiddenException({ statusCode: 403, code: OUT_OF_SCHEDULE, message: `${OUT_OF_SCHEDULE}: Acesso bloqueado. Solicite autorização de plantão ao gestor.` });
  }

  async onShift(tenantId: string, scheduleId: string, now = new Date()) {
    const [schedule, settings] = await Promise.all([
      this.prisma.workSchedule.findFirst({ where: { id: scheduleId, tenantId } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } }),
    ]);
    // escala apagada no meio do caminho: sem escala, sem trava
    if (!schedule) return true;
    return isWithinShift(schedule as ShiftRule, localOf(now, settings?.timezone ?? TZ_DEFAULT));
  }

  activeOverride(userId: string, now = new Date()) {
    return this.prisma.scheduleOverride.findFirst({
      where: { userId, revokedAt: null, validFrom: { lte: now }, validUntil: { gt: now } },
      orderBy: { validUntil: 'desc' },
    });
  }

  /** Conta temporária vencida: inativa, marca a expiração e derruba as sessões. */
  async expire(userId: string, now = new Date()) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { isActive: false, expiredAt: now } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
  }

  /** Varredura periódica: expira todas as contas temporárias vencidas, mesmo sem tentativa de login. */
  async expireDue(now = new Date()) {
    const due = await this.prisma.user.findMany({ where: { isTemporary: true, expiredAt: null, accessExpiresAt: { lte: now } }, select: { id: true } });
    for (const u of due) await this.expire(u.id, now);
    return due.length;
  }
}
