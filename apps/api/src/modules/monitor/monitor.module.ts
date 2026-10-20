import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';

/**
 * Monitor do dono do sistema (docs/08-frontend.md): quem de cada
 * cliente está com o painel aberto agora e a saúde de cada número. Ao vivo pelo socket da sala
 * `owners` (`tenant_presence`, `tenant_number`); o painel recarrega este endpoint.
 */
@Controller('monitor')
@UseGuards(JwtAuthGuard, RolesGuard)
class MonitorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ConversationsGateway,
  ) {}

  @Get('tenants')
  @NoTenantOk()
  @Roles('super_admin')
  async tenants() {
    const [presence, users, lastRefresh, numbers] = await Promise.all([
      this.gateway.presence(),
      this.prisma.user.findMany({ where: { tenantId: { not: null }, isActive: true }, select: { id: true, tenantId: true, lastLoginAt: true } }),
      // o access token dura 15 min: painel aberto renova o refresh — o último é a última atividade.
      // Um GROUP BY só (antes era um "último token" por usuário, que varria a tabela inteira)
      this.prisma.refreshToken.groupBy({ by: ['userId'], _max: { createdAt: true } }),
      this.prisma.whatsAppNumber.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, tenantId: true, label: true, phone: true, color: true, provider: true, status: true, isActive: true, receiveStalledAt: true, waRemovedAt: true, updatedAt: true },
      }),
    ]);
    const refreshAt = new Map(lastRefresh.map((r) => [r.userId, r._max.createdAt?.getTime() ?? 0]));
    const lastActivity = new Map<string, number>();
    for (const u of users) {
      const at = Math.max(u.lastLoginAt?.getTime() ?? 0, refreshAt.get(u.id) ?? 0);
      if (at > (lastActivity.get(u.tenantId!) ?? 0)) lastActivity.set(u.tenantId!, at);
    }
    const ids = new Set([...presence.keys(), ...lastActivity.keys(), ...numbers.map((n) => n.tenantId)]);
    return [...ids].map((tenantId) => ({
      tenantId,
      onlineUsers: presence.get(tenantId)?.size ?? 0,
      lastActivityAt: lastActivity.get(tenantId) ? new Date(lastActivity.get(tenantId)!).toISOString() : null,
      numbers: numbers.filter((n) => n.tenantId === tenantId).map(({ tenantId: _t, ...n }) => n),
    }));
  }
}

@Module({ imports: [AuthModule, ConversationsModule], controllers: [MonitorController] })
export class MonitorModule {}
