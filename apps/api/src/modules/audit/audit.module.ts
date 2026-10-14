import { Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

export type AuditAction = 'conversation.closed_internal';

/**
 * Auditoria imutável (`audit_logs`): só grava e lista — não existe rota de alterar nem de apagar.
 * Nome do ator e do contato são copiados na hora: o rastro não pode sumir quando o usuário é
 * excluído ou o contato renomeado. Ver docs/06-modelo-de-dados.md#encerramento-interno.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Uma linha por conversa. Sem try/catch: auditoria que engole o erro deixa o rastro plausível e incompleto. */
  async record(tenantId: string, action: AuditAction, actorId: string | null, items: { conversationId: string; data?: Prisma.InputJsonValue }[]) {
    if (!items.length) return;
    const [ator, convs] = await Promise.all([
      // super_admin "entrando como" o cliente não tem linha no tenant, mas tem nome
      actorId ? this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null,
      this.prisma.conversation.findMany({ where: { tenantId, id: { in: items.map((i) => i.conversationId) } }, select: { id: true, contact: { select: { id: true, name: true, phone: true } } } }),
    ]);
    const contato = new Map(convs.map((c) => [c.id, c.contact]));
    await this.prisma.auditLog.createMany({
      data: items.map((i) => {
        const c = contato.get(i.conversationId);
        return { tenantId, action, actorId, actorName: ator?.name ?? null, entityType: 'conversation', entityId: i.conversationId, contactId: c?.id ?? null, contactName: c ? c.name || c.phone : null, data: i.data };
      }),
    });
  }
}

const ListQuery = z.object({
  action: z.enum(['conversation.closed_internal']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Leitura da auditoria. `profiles.manage` (por padrão só o Administrador): quem decide quem pode
 * encerrar como interno é quem confere se houve abuso — gerente não audita a si mesmo.
 */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermission('profiles.manage')
class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string | undefined>) {
    const f = ListQuery.parse(q);
    const where: Prisma.AuditLogWhereInput = { tenantId: u.tenantId, ...(f.action && { action: f.action }) };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    ]);
    return { total, page: f.page, pageSize: f.pageSize, rows };
  }
}

@Module({ imports: [AuthModule], controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
