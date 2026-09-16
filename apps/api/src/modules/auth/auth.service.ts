import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { env } from '../../config/env';

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
  ) {}

  async login(email: string, password: string, meta: { userAgent?: string; ip?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // argon2.verify em hash fake evita timing attack de enumeração de e-mail
    const ok = user ? await argon2.verify(user.passwordHash, password) : (await argon2.hash(password), false);
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

  private async issue(user: { id: string; tenantId: string | null; role: string; email: string }, meta: { userAgent?: string; ip?: string }) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, tenantId: user.tenantId, role: user.role, email: user.email },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL as any },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + ttlMs(env.JWT_REFRESH_TTL)), ...meta },
    });
    return { accessToken, refreshToken, refreshMaxAge: ttlMs(env.JWT_REFRESH_TTL) };
  }

  hashPassword(p: string) {
    return argon2.hash(p, { type: argon2.argon2id });
  }
}
