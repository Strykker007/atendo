import { Logger, BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { env } from '../../config/env';
import { MailService } from '../../common/mail/mail.service';
import { Prisma, type AuthTokenKind } from '@prisma/client';
import { refreshAcceptable } from './refresh-grace';
import { ShiftAccessService, type SessionWindow } from './shift-access.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ttlMs = (ttl: string) => {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 15 * 60_000;
  return Number(m[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
};

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly shift: ShiftAccessService,
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
      to: email,
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

  /** Trocar a própria senha (logado). Num vínculo, a senha é a do login principal (`personId`). */
  async changePassword(personId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: personId } });
    if (!(await argon2.verify(user.passwordHash, current))) throw new BadRequestException('Senha atual incorreta.');
    await this.setPassword(personId, next);
  }

  /**
   * Trocar o próprio nome de exibição (logado). O nome também viaja no access token: quem
   * chama renova a sessão (`/auth/refresh`) para o painel e as assinaturas já usarem o novo.
   */
  async updateName(userId: string, name: string) {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Informe o nome.');
    // o nome é da pessoa: vale em todas as empresas dela (docs/multiempresa.md)
    const { personId } = await this.person(userId);
    await this.prisma.user.updateMany({ where: { OR: [{ id: personId }, { primaryUserId: personId }] }, data: { name: clean } });
    return { id: userId, name: clean };
  }

  /** Convite: cria o usuário sem senha utilizável e manda o link para ele definir a própria. */
  async invite(inviter: { name: string; tenantId: string }, data: { email: string; name: string; role: 'agent' | 'manager' | 'tenant_admin' }, tenantName: string) {
    const user = await this.prisma.user.create({
      data: { tenantId: inviter.tenantId, email: data.email, name: data.name, role: data.role, passwordHash: await this.hashPassword(randomBytes(24).toString('base64url')), invitedAt: new Date() },
    });
    // o e-mail é melhor esforço: sem provedor configurado, o admin usa o link copiável
    const link = await this.sendInvite(user.id, inviter.name, tenantName).catch((err) => {
      this.log.warn(`Convite por e-mail não enviado para ${data.email}: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    return { user, link };
  }

  /**
   * Gera o link de convite **sem enviar e-mail**. Existe porque o convite não pode depender
   * de e-mail configurado: sem isto, um cliente sem provedor de e-mail não consegue cadastrar
   * a própria equipe. O admin copia o link e manda pelo WhatsApp.
   */
  async inviteLink(userId: string, ttlHours = 72) {
    const raw = await this.issueToken(userId, 'invite', ttlHours);
    return { link: `${env.WEB_ORIGIN}/convite?token=${raw}`, expiresInHours: ttlHours };
  }

  async sendInvite(userId: string, inviterName: string, tenantName: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.email) throw new BadRequestException('Vínculo não tem convite: a pessoa entra pelo login principal.');
    const { link } = await this.inviteLink(user.id);
    await this.mail.send({
      to: user.email,
      subject: `${inviterName} convidou você para a equipe de ${tenantName} no Atendo`,
      text: `Olá, ${user.name}!

${inviterName} adicionou você à equipe de ${tenantName} no Atendo, o painel de atendimento via WhatsApp.

Defina sua senha para começar (o link vale por 3 dias):

${link}

Seu login será: ${user.email}`,
    });
    return link;
  }

  async acceptInvite(token: string, password: string) {
    const user = await this.consumeToken(token, 'invite');
    await this.setPassword(user.id, password);
    return user;
  }

  private async setPassword(userId: string, password: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hashPassword(password), passwordSetAt: new Date(), isActive: true } });
    // senha nova = sessões antigas fora, em todas as empresas da pessoa
    await this.prisma.refreshToken.updateMany({ where: { revokedAt: null, user: { OR: [{ id: userId }, { primaryUserId: userId }] } }, data: { revokedAt: new Date() } });
  }

  async login(email: string, password: string, meta: { userAgent?: string; ip?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // argon2.verify em hash fake evita timing attack de enumeração de e-mail
    const ok = user ? await argon2.verify(user.passwordHash, password) : (await argon2.hash(password), false);
    if (user?.invitedAt && !user.passwordSetAt) throw new UnauthorizedException('Você ainda não definiu sua senha. Use o link do convite recebido por e-mail.');
    // conta temporária vencida fica inativa: com a senha certa, explica o motivo em vez de "credenciais inválidas"
    if (!user || !ok || !(user.isActive || user.isTemporary)) throw new UnauthorizedException('Credenciais inválidas');
    // validade da conta temporária + escala de trabalho: fora do turno (e sem liberação de plantão) não entra — docs/escalas.md
    const janela = await this.shift.sessionWindow(user, 'login');
    if (!user.isActive) throw new UnauthorizedException('Credenciais inválidas');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issue(user, meta, janela);
  }

  async refresh(refreshToken: string, meta: { userAgent?: string; ip?: string }) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    // revogado há poucos segundos ainda passa: é a corrida de duas abas renovando juntas,
    // não um token vazado (ver refresh-grace.ts)
    if (!row || !refreshAcceptable(row)) throw new UnauthorizedException('Refresh inválido');
    // vínculo: login principal desativado derruba as outras empresas junto
    if (row.user.primaryUserId) {
      const principal = await this.prisma.user.findUnique({ where: { id: row.user.primaryUserId }, select: { isActive: true } });
      if (!principal?.isActive) throw new UnauthorizedException('Refresh inválido');
    }
    // turno acabou há pouco: token TRAVADO (modo fim de turno). Acabou faz tempo ou a conta
    // temporária venceu: a sessão para aqui (o token não é rotacionado) — docs/escalas.md#fim-de-turno
    const janela = await this.shift.sessionWindow(row.user, 'refresh');
    // rotação: revoga o antigo e emite novo par
    if (!row.revokedAt) await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return this.issue(row.user, meta, janela);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken) }, data: { revokedAt: new Date() } });
  }

  /**
   * Limpeza diária de `refresh_tokens`: cada renovação (15 min com o painel aberto) deixa um
   * token revogado para trás e a tabela só crescia. Apaga os vencidos e os revogados há mais de
   * 1 dia (revogado só vale 30 s — refresh-grace.ts), mas sempre mantém o mais recente de cada usuário — é a "última atividade" do Monitor.
   */
  async purgeStaleRefreshTokens(now = new Date()) {
    const cutoff = new Date(now.getTime() - 86_400_000);
    const removed = await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM refresh_tokens t
      WHERE (t."expiresAt" < ${now} OR t."revokedAt" < ${cutoff})
        AND t."createdAt" < (SELECT max(x."createdAt") FROM refresh_tokens x WHERE x."userId" = t."userId")`);
    if (removed) this.log.log(`refresh tokens antigos apagados: ${removed}`);
    return removed;
  }

  /**
   * Pessoa da linha de usuário (docs/multiempresa.md): `personId` = login principal; e-mail do login;
   * `owner` = dona do sistema em qualquer das empresas dela (os menus de dono são da pessoa).
   */
  async person(userId: string) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, primaryUserId: true, email: true } });
    const personId = row.primaryUserId ?? row.id;
    const rows = await this.prisma.user.findMany({ where: { isActive: true, OR: [{ id: personId }, { primaryUserId: personId }] }, select: { id: true, email: true, role: true, isSystemOwner: true } });
    return {
      personId,
      email: row.email ?? rows.find((r) => r.id === personId)?.email ?? '',
      owner: rows.some((r) => r.isSystemOwner || r.role === 'super_admin'),
    };
  }

  /**
   * Empresas da pessoa logada (seletor "Minhas empresas"). Entrando como cliente, as do dono.
   * `current` = a linha desta sessão.
   */
  async memberships(caller: { id: string; impersonatorId?: string }) {
    const { personId } = await this.person(caller.impersonatorId ?? caller.id);
    const rows = await this.prisma.user.findMany({
      where: { isActive: true, OR: [{ id: personId }, { primaryUserId: personId }] },
      select: { id: true, role: true, isSystemOwner: true, tenant: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      userId: r.id,
      tenantId: r.tenant?.id ?? null,
      tenantName: r.tenant?.name ?? null,
      role: r.role,
      systemOwner: r.isSystemOwner || r.role === 'super_admin',
      current: r.id === caller.id && !caller.impersonatorId,
    }));
  }

  /**
   * Troca de empresa (seletor): sessão nova, com refresh próprio, como a linha escolhida — membro de
   * verdade daquela empresa, não "entrando como". Só entre linhas da mesma pessoa; escala e conta
   * temporária da empresa de destino valem como num login.
   */
  async switchTo(caller: { id: string; impersonatorId?: string }, targetId: string, meta: { userAgent?: string; ip?: string }) {
    const { personId } = await this.person(caller.impersonatorId ?? caller.id);
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target || (target.id !== personId && target.primaryUserId !== personId)) throw new ForbiddenException('Esta empresa não está entre as suas.');
    if (!target.isActive) throw new ForbiddenException('Seu acesso a esta empresa foi desativado.');
    const janela = await this.shift.sessionWindow(target, 'login');
    if (!target.isActive) throw new ForbiddenException('Seu acesso a esta empresa venceu.');
    await this.prisma.user.update({ where: { id: target.id }, data: { lastLoginAt: new Date() } });
    return this.issue(target, meta, janela);
  }

  private async issue(user: { id: string; tenantId: string | null; role: string; name: string }, meta: { userAgent?: string; ip?: string }, janela?: SessionWindow) {
    // Fim de turno viaja no token: o JwtAuthGuard trava as ações sem consultar o banco a cada
    // requisição. `shiftEndsAt` = a partir de quando trava; `locked` = já nasce travado (passagem)
    const sec = (d: Date) => Math.floor(d.getTime() / 1000);
    const shift = janela?.lockedUntil
      ? { shiftEndsAt: sec(janela.shiftEndsAt ?? new Date()), locked: true, lockedUntil: sec(janela.lockedUntil) }
      : janela?.shiftEndsAt ? { shiftEndsAt: sec(janela.shiftEndsAt), ...(janela.graceFrom && { graceFrom: sec(janela.graceFrom) }) } : {};
    // travado: o token não vive além da janela de passagem
    const ttl = janela?.lockedUntil ? Math.max(30, Math.min(ttlMs(env.JWT_ACCESS_TTL), janela.lockedUntil.getTime() - Date.now()) / 1000 | 0) : (env.JWT_ACCESS_TTL as any);
    const who = await this.person(user.id);
    const accessToken = await this.jwt.signAsync(
      // `iatMs`: o corte de sessão (cutSessions) compara em milissegundos — `iat` do JWT é em segundos
      // `owner`: só para o socket (salas do suporte); nas rotas a marcação vem do banco (PermissionsService)
      // `pid`: login principal, quando a sessão é de um vínculo (docs/multiempresa.md)
      { sub: user.id, tenantId: user.tenantId, role: user.role, email: who.email, name: user.name, iatMs: Date.now(), ...(who.owner && { owner: true }), ...(who.personId !== user.id && { pid: who.personId }), ...shift },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: ttl },
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
  async impersonate(caller: { id: string; impersonatorId?: string }, tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    // nome e e-mail do banco: trocando de um cliente para outro, o token atual já é o de
    // "entrando como" (nome com "(dono)") — docs/donos-do-sistema.md#ver-cliente
    // sempre pelo login principal: `impersonatorId` identifica a pessoa (equipe do suporte, auditoria)
    const { personId, email } = await this.person(caller.impersonatorId ?? caller.id);
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: personId }, select: { id: true, name: true } });
    const accessToken = await this.jwt.signAsync(
      { sub: owner.id, tenantId: tenant.id, role: 'tenant_admin', email, name: `${owner.name} (dono)`, impersonatorId: owner.id },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: '1h' as any },
    );
    return { accessToken, tenant: { id: tenant.id, name: tenant.name } };
  }

  hashPassword(p: string) {
    return argon2.hash(p, { type: argon2.argon2id });
  }
}
