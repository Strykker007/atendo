import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RedisService } from '../../common/redis/redis.service';
import { MailService, senderName } from '../../common/mail/mail.service';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp';

const MAX_FAILS = 5;
const LOCK_S = 15 * 60;

/** Quem age nas telas de dono: a pessoa (login principal), mesmo "entrando como" um cliente. */
export const actorOf = (u: AuthUser) => ({ id: u.impersonatorId ?? u.personId ?? u.id, name: u.name.replace(/ \((dono|parceiro)\)$/, '') });

/**
 * Trava dos pagamentos a parceiros (docs/37-vogopartners.md#segurança): autenticador (TOTP) de quem
 * autoriza, limite de tentativas, código de uso único, trilha de auditoria e aviso aos donos.
 * Uma senha vazada não basta para tirar dinheiro: falta o celular do dono.
 */
@Injectable()
export class PayoutSecurityService {
  private readonly log = new Logger('PartnerSecurity');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
  ) {}

  async status(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpConfirmedAt: true } });
    return { enabled: !!u.totpConfirmedAt, since: u.totpConfirmedAt };
  }

  /** Gera o segredo (pede a senha). Só vale depois de confirmar com um código do app. */
  async setup(userId: string, password: string) {
    if (!(await this.auth.verifyPassword(userId, password))) throw new ForbiddenException('Senha incorreta.');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, totpConfirmedAt: true } });
    if (u.totpConfirmedAt) throw new BadRequestException('O autenticador já está ativo. Desative antes de cadastrar outro celular.');
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: this.crypto.encrypt(secret), totpConfirmedAt: null } });
    return { secret, otpauthUrl: otpauthUrl(secret, u.email ?? userId, `${senderName()} pagamentos`) };
  }

  async confirm(userId: string, code: string, ip?: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpSecret: true, totpConfirmedAt: true, name: true } });
    if (!u.totpSecret) throw new BadRequestException('Comece pelo cadastro do autenticador.');
    if (u.totpConfirmedAt) throw new BadRequestException('O autenticador já está ativo.');
    await this.check(userId, this.crypto.decrypt(u.totpSecret), code);
    await this.prisma.user.update({ where: { id: userId }, data: { totpConfirmedAt: new Date() } });
    await this.event('totp.enabled', { id: userId, name: u.name }, { ip });
    await this.notifyOwners('Autenticador de pagamentos ativado', `${u.name} ativou o autenticador para autorizar pagamentos a parceiros.`);
    return this.status(userId);
  }

  async disable(userId: string, password: string, code: string, ip?: string) {
    if (!(await this.auth.verifyPassword(userId, password))) throw new ForbiddenException('Senha incorreta.');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    await this.assertCode(userId, code);
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpConfirmedAt: null } });
    await this.event('totp.disabled', { id: userId, name: u.name }, { ip });
    await this.notifyOwners('Autenticador de pagamentos desativado', `${u.name} desativou o autenticador de pagamentos a parceiros.`);
    return this.status(userId);
  }

  /** Exige o código do autenticador de quem está agindo. Lança 403 se não bater. */
  async assertCode(userId: string, code: string | undefined) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpSecret: true, totpConfirmedAt: true } });
    if (!u.totpSecret || !u.totpConfirmedAt) throw new ForbiddenException({ statusCode: 403, code: 'TOTP_REQUIRED', message: 'Ative o autenticador em Parceiros → Segurança para autorizar pagamentos e trocar chave Pix.' });
    await this.check(userId, this.crypto.decrypt(u.totpSecret), code ?? '');
  }

  private async check(userId: string, secret: string, code: string) {
    const failKey = `partners:totp:fail:${userId}`;
    const fails = Number((await this.redis.get(failKey)) ?? 0);
    if (fails >= MAX_FAILS) throw new ForbiddenException('Muitos códigos errados. Espere 15 minutos.');
    const step = verifyTotp(secret, code);
    // código de uso único: o mesmo código (mesmo passo) não autoriza duas vezes
    const lastKey = `partners:totp:last:${userId}`;
    const last = Number((await this.redis.get(lastKey)) ?? -1);
    if (step === null || step <= last) {
      const n = await this.redis.incr(failKey);
      if (n === 1) await this.redis.expire(failKey, LOCK_S);
      throw new ForbiddenException(step === null ? 'Código do autenticador inválido.' : 'Este código já foi usado. Espere o próximo.');
    }
    await this.redis.set(lastKey, String(step), 'EX', 120);
    await this.redis.del(failKey);
  }

  /** Trilha de auditoria do programa. */
  async event(action: string, actor: { id: string; name: string } | null, extra: { partnerId?: string; payoutId?: string; data?: Prisma.InputJsonValue; ip?: string } = {}) {
    await this.prisma.partnerEvent.create({ data: { action, actorId: actor?.id ?? null, actorName: actor?.name ?? null, partnerId: extra.partnerId, payoutId: extra.payoutId, data: extra.data, ip: extra.ip } }).catch((e) => this.log.error(`evento ${action} não gravado: ${e}`));
  }

  /** E-mail a todos os donos ativos (troca de chave Pix, autenticador, pagamentos enviados). */
  async notifyOwners(subject: string, text: string) {
    const owners = await this.prisma.user.findMany({ where: { isActive: true, email: { not: null }, OR: [{ role: 'super_admin' }, { isSystemOwner: true }] }, select: { email: true } });
    const to = [...new Set(owners.map((o) => o.email!).filter(Boolean))];
    if (to.length) await this.mail.send({ to, subject: `[${senderName()}] ${subject}`, text }).catch(() => undefined);
  }
}
