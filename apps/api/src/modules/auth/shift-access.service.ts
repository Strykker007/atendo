import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { env } from '../../config/env';
import { TZ_DEFAULT } from '../../common/time';
import { localOf } from '../tenants/schedule-clock';
import { isWithinShift, type ShiftRule } from './shift-window';

export const OUT_OF_SCHEDULE = 'FOR_OUT_OF_SCHEDULE';
export const ACCOUNT_EXPIRED = 'ACCOUNT_EXPIRED';

/**
 * Segredo PRÓPRIO do token de pedido de autorização. Nunca o do access token: o `JwtAuthGuard`
 * aceitaria o token de pedido como sessão e quem está fora da escala entraria por ele.
 */
const requestSecret = () => `${env.JWT_ACCESS_SECRET}:access-request`;
const REQUEST_PURPOSE = 'schedule_access_request';

/** O que a trava precisa saber do usuário (vem do `findUnique` do login/refresh). */
export interface ShiftSubject {
  id: string;
  tenantId: string | null;
  role: string;
  name?: string;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async assertCanAccess(user: ShiftSubject, now = new Date()) {
    if (user.isTemporary && (user.expiredAt || (user.accessExpiresAt && user.accessExpiresAt <= now))) {
      if (!user.expiredAt) await this.expire(user.id, now);
      throw new ForbiddenException({ statusCode: 403, code: ACCOUNT_EXPIRED, message: 'Este acesso temporário expirou. Peça um novo ao seu gestor.' });
    }
    if (user.role === 'super_admin' || user.role === 'tenant_admin' || !user.scheduleId || !user.tenantId) return;
    if (await this.onShift(user.tenantId, user.scheduleId, now)) return;
    if (await this.activeOverride(user.id, now)) return;
    // a senha já foi conferida: o token deixa a tela de login pedir autorização (e só isso)
    throw new ForbiddenException({
      statusCode: 403,
      code: OUT_OF_SCHEDULE,
      message: 'Você está fora do horário da sua escala de trabalho.',
      requestToken: await this.requestToken(user.id, user.tenantId),
      userName: user.name,
    });
  }

  /** Token curto (30 min) que só serve para pedir autorização de plantão e acompanhar o pedido. */
  requestToken(userId: string, tenantId: string) {
    return this.jwt.signAsync({ sub: userId, tenantId, purpose: REQUEST_PURPOSE }, { secret: requestSecret(), expiresIn: '30m' as any });
  }

  async verifyRequestToken(token: string) {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; tenantId: string; purpose: string }>(token, { secret: requestSecret() });
      if (p.purpose !== REQUEST_PURPOSE || !p.tenantId) throw new Error('purpose');
      return { userId: p.sub, tenantId: p.tenantId };
    } catch {
      throw new UnauthorizedException('Este pedido expirou. Entre de novo para pedir autorização.');
    }
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
