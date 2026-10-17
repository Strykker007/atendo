import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ShiftAccessService } from '../auth/shift-access.service';
import { can } from '../auth/permissions';
import { ConversationsGateway } from '../conversations/conversations.gateway';

class TokenDto {
  @IsString() token: string;
}
class CreateRequestDto extends TokenDto {
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
  /** gestor que vai aprovar; ausente = qualquer um com `team.manage` */
  @IsOptional() @IsUUID() approverId?: string;
}
class ApproveDto {
  /** até quando vale a liberação (dia + hora escolhidos pelo gestor) */
  @IsISO8601() validUntil: string;
}

/** a liberação aprovada vale no máximo isto a partir de agora */
const MAX_APPROVAL_MS = 7 * 86_400_000;

/** Quem pode aprovar: ativos do cliente com `team.manage` (pelo perfil ou pelo papel). */
async function approversOf(prisma: PrismaService, tenantId: string, exceptId: string) {
  const rows = await prisma.user.findMany({
    where: { tenantId, isActive: true, id: { not: exceptId }, role: { in: ['tenant_admin', 'manager', 'agent'] } },
    select: { id: true, name: true, role: true, profile: { select: { permissions: true } } },
    orderBy: { name: 'asc' },
  });
  return rows
    .filter((r) => can({ role: r.role as 'tenant_admin' | 'manager' | 'agent', profilePermissions: r.profile?.permissions ?? null }, 'team.manage'))
    .map((r) => ({ id: r.id, name: r.name, role: r.role }));
}

/**
 * Pedido de autorização de plantão pela tela de login (docs/escalas.md#pedido-de-autorização).
 * Sem sessão: quem foi barrado pela escala recebe no 403 do login um `requestToken` (30 min,
 * segredo próprio) que só abre estas três rotas.
 */
@Controller('auth/access-requests')
@Throttle({ default: { ttl: 60_000, limit: 20 } })
export class PublicAccessRequestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shift: ShiftAccessService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Para quem a pessoa pode pedir. */
  @Post('approvers')
  @HttpCode(200)
  async approvers(@Body() dto: TokenDto) {
    const t = await this.shift.verifyRequestToken(dto.token);
    return approversOf(this.prisma, t.tenantId, t.userId);
  }

  /** Envia o pedido. Já havia um pendente: atualiza motivo e destinatário (não vira fila de pedidos repetidos). */
  @Post()
  @HttpCode(200)
  async create(@Body() dto: CreateRequestDto) {
    const t = await this.shift.verifyRequestToken(dto.token);
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('Conte rapidamente o motivo do pedido.');
    const aprovadores = await approversOf(this.prisma, t.tenantId, t.userId);
    if (dto.approverId && !aprovadores.some((a) => a.id === dto.approverId)) throw new BadRequestException('Essa pessoa não pode aprovar o pedido.');
    if (!aprovadores.length) throw new BadRequestException('Ninguém da sua equipe pode aprovar pedidos agora. Fale com o administrador da conta.');
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: t.userId, tenantId: t.tenantId }, select: { name: true } });
    const pendente = await this.prisma.scheduleAccessRequest.findFirst({ where: { userId: t.userId, status: 'pending' }, select: { id: true } });
    const data = { reason, approverId: dto.approverId ?? null };
    const req = pendente
      ? await this.prisma.scheduleAccessRequest.update({ where: { id: pendente.id }, data, select: { id: true, status: true, createdAt: true } })
      : await this.prisma.scheduleAccessRequest.create({ data: { tenantId: t.tenantId, userId: t.userId, ...data }, select: { id: true, status: true, createdAt: true } });
    // aviso ao vivo para quem vai aprovar (o escolhido, ou todos que podem)
    const destino = dto.approverId ? [dto.approverId] : aprovadores.map((a) => a.id);
    this.gateway.emitAccessRequest(t.tenantId, destino, { id: req.id, userName: user.name, reason });
    return req;
  }

  /** Situação do último pedido — a tela de login acompanha enquanto espera. */
  @Post('status')
  @HttpCode(200)
  async status(@Body() dto: TokenDto) {
    const t = await this.shift.verifyRequestToken(dto.token);
    const req = await this.prisma.scheduleAccessRequest.findFirst({
      where: { userId: t.userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, decidedByName: true, decidedAt: true, overrideId: true },
    });
    if (!req) return null;
    const override = req.overrideId ? await this.prisma.scheduleOverride.findUnique({ where: { id: req.overrideId }, select: { validUntil: true } }) : null;
    return { id: req.id, status: req.status, decidedByName: req.decidedByName, decidedAt: req.decidedAt, validUntil: override?.validUntil ?? null };
  }
}

/** Lado do gestor: pedidos pendentes, aprovar (escolhendo até quando) ou recusar. */
@Controller('work-schedules/access-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('team.manage')
export class AccessRequestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ConversationsGateway,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.scheduleAccessRequest.findMany({
      where: { tenantId: u.tenantId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, reason: true, createdAt: true, updatedAt: true, user: { select: { id: true, name: true, schedule: { select: { id: true, name: true } } } }, approver: { select: { id: true, name: true } } },
    });
  }

  @Post(':id/approve')
  async approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) {
    const req = await this.pending(u, id);
    const now = new Date();
    const validUntil = new Date(dto.validUntil);
    if (validUntil <= now) throw new BadRequestException('Escolha um horário no futuro.');
    if (validUntil.getTime() - now.getTime() > MAX_APPROVAL_MS) throw new BadRequestException('A autorização vale no máximo 7 dias.');
    const decisor = await this.decisor(u);
    const override = await this.prisma.$transaction(async (tx) => {
      const o = await tx.scheduleOverride.create({ data: { tenantId: u.tenantId, userId: req.userId, validFrom: now, validUntil, approvedById: decisor.id, reason: req.reason } });
      await tx.scheduleAccessRequest.update({ where: { id }, data: { status: 'approved', decidedById: decisor.id, decidedByName: decisor.name, decidedAt: now, overrideId: o.id } });
      return o;
    });
    this.gateway.emitAccessRequest(u.tenantId, [], { id, decided: true });
    // a pessoa pode estar com a tela de fim de turno aberta: destrava na hora
    this.gateway.emitShiftUnlocked(u.tenantId, req.userId);
    return { ok: true, validUntil: override.validUntil };
  }

  @Post(':id/deny')
  async deny(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.pending(u, id);
    const decisor = await this.decisor(u);
    await this.prisma.scheduleAccessRequest.update({ where: { id }, data: { status: 'denied', decidedById: decisor.id, decidedByName: decisor.name, decidedAt: new Date() } });
    this.gateway.emitAccessRequest(u.tenantId, [], { id, decided: true });
    return { ok: true };
  }

  private async pending(u: AuthUser, id: string) {
    const req = await this.prisma.scheduleAccessRequest.findFirst({ where: { id, tenantId: u.tenantId }, select: { id: true, userId: true, reason: true, status: true } });
    if (!req) throw new NotFoundException('Pedido não encontrado.');
    if (req.status !== 'pending') throw new BadRequestException('Este pedido já foi respondido.');
    return req;
  }

  /** Dono "entrando como": a decisão fica sem usuário do cliente, com o nome dele. */
  private async decisor(u: AuthUser) {
    return u.impersonatorId ? { id: null, name: u.name } : { id: u.id, name: u.name };
  }
}
