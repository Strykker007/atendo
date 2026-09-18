import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { env } from '../../config/env';
import { MailService } from '../../common/mail/mail.service';
import type { AuthTokenKind } from '@prisma/client';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ttlMs = (ttl: string) => {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 15 * 60_000;
  return Number(m[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  // ---------- tokens de uso único (esqueci a senha, convite) ----------

  private async issueToken(userId: string, kind: AuthTokenKind, ttlHours: number) {
    // invalida tokens anteriores do mesmo tipo
    await this.prisma.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.authToken.create({ data: { userId, kind, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlHours * 3_600_000) } });
    return raw;
  }

  private async consumeToken(raw: string, kind: AuthTokenKind) {
    const t = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
    if (!t || t.kind !== kind || t.usedAt || t.expiresAt < new Date()) throw new BadRequestException('Link inválido ou expirado. Peça um novo.');
    await this.prisma.authToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
    return t.user;
  }

  /** Esqueci a senha: sempre responde OK (não revela se o e-mail existe). */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return;
    const raw = await this.issueToken(user.id, 'reset', 2);
    const link = `${env.WEB_ORIGIN}/redefinir-senha?token=${raw}`;
    await this.mail.send({
      to: user.email,
      subject: 'Redefinir sua senha no Atendo',
      text: `Olá, ${user.name}.

Recebemos um pedido para redefinir a sua senha. O link vale por 2 horas:

${link}

Se não foi você, ignore este e-mail — nada muda.`,
    });
  }

  async resetPassword(token: string, password: string) {
    const user = await this.consumeToken(token, 'reset');
    await this.setPassword(user.id, password);
  }

  /** Trocar a própria senha (logado). */
  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, current))) throw new BadRequestException('Senha atual incorreta.');
    await this.setPassword(userId, next);
  }

  /** Convite: cria o usuário sem senha utilizável e manda o link para ele definir a própria. */
  async invite(inviter: { name: string; tenantId: string }, data: { email: string; name: string; role: 'agent' | 'manager' | 'tenant_admin' }, tenantName: string) {
    const user = await this.prisma.user.create({
      data: { tenantId: inviter.tenantId, email: data.email, name: data.name, role: data.role, passwordHash: await this.hashPassword(randomBytes(24).toString('base64url')), invitedAt: new Date() },
    });
    await this.sendInvite(user.id, inviter.name, tenantName);
    return user;
  }

  async sendInvite(userId: string, inviterName: string, tenantName: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const raw = await this.issueToken(user.id, 'invite', 72);
    const link = `${env.WEB_ORIGIN}/convite?token=${raw}`;
    await this.mail.send({
      to: user.email,
      subject: `${inviterName} convidou você para a equipe de ${tenantName} no Atendo`,
      text: `Olá, ${user.name}!

${inviterName} adicionou você à equipe de ${tenantName} no Atendo, o painel de atendimento via WhatsApp.

Defina sua senha para começar (o link vale por 3 dias):

${link}

Seu login será: ${user.email}`,
    });
  }

  async acceptInvite(token: string, password: string) {
    const user = await this.consumeToken(token, 'invite');
    await this.setPassword(user.id, password);
    return user;
  }

  private async setPassword(userId: string, password: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hashPassword(password), passwordSetAt: new Date(), isActive: true } });
    // senha nova = sessões antigas fora
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async login(email: string, password: string, meta: { userAgent?: string; ip?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // argon2.verify em hash fake evita timing attack de enumeração de e-mail
    const ok = user ? await argon2.verify(user.passwordHash, password) : (await argon2.hash(password), false);
    if (user?.invitedAt && !user.passwordSetAt) throw new UnauthorizedException('Você ainda não definiu sua senha. Use o link do convite recebido por e-mail.');
    if (!user || !ok || !user.isActive) throw new UnauthorizedException('Credenciais inválidas');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issue(user, meta);
  }

  async refresh(refreshToken: string, meta: { userAgent?: string; ip?: string }) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) throw new UnauthorizedException('Refresh inválido');
    // rotação: revoga o antigo e emite novo par
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return this.issue(row.user, meta);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken) }, data: { revokedAt: new Date() } });
  }

  private async issue(user: { id: string; tenantId: string | null; role: string; email: string; name: string }, meta: { userAgent?: string; ip?: string }) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, tenantId: user.tenantId, role: user.role, email: user.email, name: user.name },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL as any },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + ttlMs(env.JWT_REFRESH_TTL)), ...meta },
    });
    return { accessToken, refreshToken, refreshMaxAge: ttlMs(env.JWT_REFRESH_TTL) };
  }

  /**
   * Dono do sistema "entra como" um cliente: token de acesso com o tenant escolhido e papel de admin,
   * marcado com `impersonatorId`. O refresh cookie continua sendo o do dono — o front renova
   * chamando /tenants/:id/impersonate de novo.
   */
  async impersonate(owner: { id: string; email: string; name: string }, tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const accessToken = await this.jwt.signAsync(
      { sub: owner.id, tenantId: tenant.id, role: 'tenant_admin', email: owner.email, name: `${owner.name} (dono)`, impersonatorId: owner.id },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: '1h' as any },
    );
    return { accessToken, tenant: { id: tenant.id, name: tenant.name } };
  }

  hashPassword(p: string) {
    return argon2.hash(p, { type: argon2.argon2id });
  }
}
