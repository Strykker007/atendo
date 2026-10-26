import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

type Meta = { userAgent?: string; ip?: string };
type Subject = { id: string; tenantId: string | null };
export type SessionEndReason = 'logout' | 'shift_end' | 'expired' | 'revoked';

/**
 * Grava o registro de acessos (docs/registro-de-acessos.md): abre a sessão no login, avança
 * `lastSeenAt` a cada renovação e fecha na saída. Sem tenant (dono no painel do sistema) não grava.
 */
@Injectable()
export class AccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Login aceito: abre a sessão. Devolve o id que viaja nos refresh tokens seguintes. */
  async start(user: Subject, meta: Meta): Promise<string | null> {
    if (!user.tenantId) return null;
    const s = await this.prisma.userSession.create({ data: { tenantId: user.tenantId, userId: user.id, ip: meta.ip, userAgent: meta.userAgent }, select: { id: true } });
    return s.id;
  }

  /** Senha certa, mas barrado (fora da escala, acesso vencido): fica no registro como tentativa. */
  async denied(user: Subject, outcome: 'out_of_schedule' | 'account_expired', meta: Meta) {
    if (!user.tenantId) return;
    const now = new Date();
    await this.prisma.userSession.create({ data: { tenantId: user.tenantId, userId: user.id, outcome, startedAt: now, lastSeenAt: now, endedAt: now, ip: meta.ip, userAgent: meta.userAgent } });
  }

  /** Renovação aceita: a sessão segue viva. Token de antes do registro ganha uma sessão agora. */
  async touch(user: Subject, sessionId: string | null, meta: Meta): Promise<string | null> {
    if (!sessionId) return this.start(user, meta);
    await this.prisma.userSession.updateMany({ where: { id: sessionId, endedAt: null }, data: { lastSeenAt: new Date() } });
    return sessionId;
  }

  async end(sessionId: string | null | undefined, reason: SessionEndReason) {
    if (!sessionId) return;
    const now = new Date();
    await this.prisma.userSession.updateMany({ where: { id: sessionId, endedAt: null }, data: { endedAt: now, lastSeenAt: now, endReason: reason } });
  }

  /** Senha trocada: todas as sessões abertas da pessoa (em todas as empresas dela) acabam. */
  async endAllOfPerson(personId: string, reason: SessionEndReason) {
    const now = new Date();
    await this.prisma.userSession.updateMany({ where: { endedAt: null, outcome: 'ok', user: { OR: [{ id: personId }, { primaryUserId: personId }] } }, data: { endedAt: now, endReason: reason } });
  }
}
