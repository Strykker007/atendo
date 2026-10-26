import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { env } from '../../config/env';
import { localToUtc, TZ_DEFAULT } from '../../common/time';
import { localOf } from '../tenants/schedule-clock';
import { currentShift, isWithinShift, lastShift, splitLocal, type ShiftRule } from './shift-window';

export const OUT_OF_SCHEDULE = 'FOR_OUT_OF_SCHEDULE';
export const ACCOUNT_EXPIRED = 'ACCOUNT_EXPIRED';
/** API recusou a ação: o turno acabou e a sessão está no modo fim de turno */
export const SHIFT_ENDED = 'SHIFT_ENDED';

/**
 * Passagem de turno: depois que o turno (ou a liberação) acaba, a sessão NÃO cai — fica
 * travada por este tempo na tela de fim de turno (resumo, devolver atendimentos, pedir mais
 * tempo). Passou disso, o refresh recusa e a pessoa sai de vez.
 */
export const HANDOFF_MS = 30 * 60_000;

/**
 * Até quando a sessão vale. `shiftEndsAt` null = sem trava (admin, sem escala). `lockedUntil`
 * presente = sessão já travada (fim de turno), só com as rotas de passagem.
 */
export interface SessionWindow {
  shiftEndsAt: Date | null;
  lockedUntil: Date | null;
  /** fim real do turno quando há tolerância para sair (até `shiftEndsAt` a tela mostra o contador) */
  graceFrom?: Date | null;
}

/**
 * Segredo PRÓPRIO do token de pedido de autorização. Nunca o do access token: o `JwtAuthGuard`
 * aceitaria o token de pedido como sessão e quem está fora da escala entraria por ele.
 */
const requestSecret = () => `${env.JWT_ACCESS_SECRET}:access-request`;
const REQUEST_PURPOSE = 'schedule_access_request';
const cutKey = (userId: string) => `shift:cut:${userId}`;

/** O que a trava precisa saber do usuário (vem do `findUnique` do login/refresh). */
export interface ShiftSubject {
  id: string;
  tenantId: string | null;
  role: string;
  isSystemOwner?: boolean;
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
    private readonly redis: RedisService,
  ) {}

  /**
   * Corte imediato: tokens emitidos antes de agora passam a valer como TRAVADOS (fim de turno)
   * até a pessoa renovar — e a renovação reavalia escala e liberações no banco. Usado quando o
   * gestor encerra uma liberação, troca a escala ou encerra um acesso temporário: sem isto o
   * access token já emitido continuava liberado por até 15 min.
   * Vive 1 h no Redis (bem mais que qualquer access token).
   */
  async cutSessions(userIds: string[], now = Date.now()) {
    if (!userIds.length) return;
    const pipe = this.redis.pipeline();
    for (const id of userIds) pipe.set(cutKey(id), String(now), 'EX', 3600);
    await pipe.exec();
  }

  /** Instante (ms) do último corte da pessoa; null = nenhum na última hora. */
  async cutAt(userId: string): Promise<number | null> {
    const v = await this.redis.get(cutKey(userId));
    return v ? Number(v) : null;
  }

  /**
   * Janela da sessão (docs/escalas.md#fim-de-turno). Login fora do turno é barrado; no refresh,
   * logo depois do fim do turno, a sessão continua TRAVADA por `HANDOFF_MS` em vez de cair.
   */
  async sessionWindow(user: ShiftSubject, mode: 'login' | 'refresh', now = new Date()): Promise<SessionWindow> {
    if (user.isTemporary && (user.expiredAt || (user.accessExpiresAt && user.accessExpiresAt <= now))) {
      if (!user.expiredAt) await this.expire(user.id, now);
      throw new ForbiddenException({ statusCode: 403, code: ACCOUNT_EXPIRED, message: 'Este acesso temporário expirou. Peça um novo ao seu gestor.' });
    }
    // conta temporária trava na hora exata do vencimento
    const vence = user.isTemporary ? user.accessExpiresAt : null;
    const livre = { shiftEndsAt: vence, lockedUntil: null };
    // dono do sistema (docs/donos-do-sistema.md) não fica preso à escala que o cliente dele montar
    if (user.role === 'super_admin' || user.role === 'tenant_admin' || user.isSystemOwner || !user.scheduleId || !user.tenantId) return livre;
    const [schedule, settings] = await Promise.all([
      this.prisma.workSchedule.findFirst({ where: { id: user.scheduleId, tenantId: user.tenantId } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId: user.tenantId }, select: { timezone: true } }),
    ]);
    // escala apagada no meio do caminho: sem escala, sem trava
    if (!schedule) return livre;
    const tz = settings?.timezone ?? TZ_DEFAULT;
    const local = localOf(now, tz);
    const instante = (abs: number) => { const p = splitLocal(abs); return localToUtc(p.ymd, p.hm, tz); };
    const rule = schedule as ShiftRule;
    const turno = currentShift(rule, local);
    const liberacao = await this.activeOverride(user.id, now);
    if (turno || liberacao) {
      // vale o que durar mais (turno ou liberação), mas nunca além do vencimento da conta temporária
      const fins = [turno && instante(turno.end), liberacao?.validUntil].filter((d): d is Date => !!d);
      const maior = new Date(Math.max(...fins.map((d) => d.getTime())));
      const fim = vence && vence < maior ? vence : maior;
      // tolerância para sair só quando quem define o fim é o turno (liberação e conta temporária: fim exato)
      const graceFrom = turno?.graceFrom != null && fim.getTime() === instante(turno.end).getTime() ? instante(turno.graceFrom) : null;
      return { shiftEndsAt: fim, lockedUntil: null, graceFrom };
    }
    if (mode === 'refresh') {
      // acabou há pouco (turno ou liberação): sessão travada na tela de passagem
      const ultimo = lastShift(rule, local);
      // liberação que venceu ou foi encerrada pelo gestor nos últimos minutos também abre a passagem
      const desde = new Date(now.getTime() - HANDOFF_MS);
      const liberacoes = await this.prisma.scheduleOverride.findMany({
        where: { userId: user.id, OR: [{ validUntil: { gt: desde, lte: now } }, { revokedAt: { gt: desde, lte: now } }] },
        select: { validUntil: true, revokedAt: true },
        take: 5,
      });
      const fimLiberacao = Math.max(0, ...liberacoes.map((o) => Math.min(o.validUntil.getTime(), o.revokedAt?.getTime() ?? Infinity)));
      const fim = Math.max(ultimo ? instante(ultimo.end).getTime() : 0, fimLiberacao);
      if (fim && now.getTime() - fim < HANDOFF_MS) return { shiftEndsAt: new Date(fim), lockedUntil: new Date(fim + HANDOFF_MS) };
    }
    // a senha já foi conferida: o token deixa a tela de login pedir autorização (e só isso)
    throw new ForbiddenException({
      statusCode: 403,
      code: OUT_OF_SCHEDULE,
      message: 'Você está fora do horário da sua escala de trabalho.',
      requestToken: await this.requestToken(user.id, user.tenantId),
      userName: user.name,
    });
  }

  /** Compatível com quem só precisa saber se pode entrar (lança fora da escala). */
  async assertCanAccess(user: ShiftSubject, now = new Date()) {
    await this.sessionWindow(user, 'login', now);
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
