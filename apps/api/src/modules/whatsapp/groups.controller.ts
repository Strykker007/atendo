import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { canManageNumber, canUseNumber } from '../auth/number-scope';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { GroupInboxRegistry } from './group-inbox';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';

class SyncGroupsDto {
  @IsUUID() numberId: string;
}
class AuthorizeGroupDto {
  @IsBoolean() authorized: boolean;
}
class InboxGroupDto {
  @IsBoolean() inbox: boolean;
}
class ListGroupsQuery {
  @IsOptional() @IsUUID() numberId?: string;
}

const GROUP_SELECT = { id: true, numberId: true, jid: true, name: true, size: true, authorized: true, authorizedAt: true, inbox: true, updatedAt: true } as const;

/**
 * Grupos restritos (docs/grupos.md): o admin escolhe, um a um, quais grupos do número podem
 * receber transmissão. Opt-in estrito — grupo novo entra sempre desmarcado.
 */
@Controller('groups')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class GroupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly numbers: NumbersService,
    private readonly inboxRegistry: GroupInboxRegistry,
  ) {}

  /** Lista da tela de configuração e da escolha de público da transmissão (só dos números que a pessoa usa). */
  @Get()
  @RequirePermission('numbers.manage', 'campaigns.manage')
  async list(@CurrentUser() user: AuthUser, @Query() q: ListGroupsQuery) {
    const rows = await this.prisma.whatsAppGroup.findMany({
      where: { tenantId: user.tenantId, ...(q.numberId && { numberId: q.numberId }), number: { deletedAt: null } },
      select: GROUP_SELECT,
      orderBy: [{ authorized: 'desc' }, { name: 'asc' }],
    });
    return rows.filter((g) => canUseNumber(user, g.numberId));
  }

  /**
   * Busca os grupos do número no WhatsApp e atualiza a lista. Grupo novo entra desmarcado;
   * a marcação dos que já existiam é preservada. Grupo que sumiu (o número saiu dele) é
   * removido se não estava marcado (transmissão ou conversas) — o marcado fica, para o admin ver e desmarcar.
   */
  @Post('sync')
  @RequirePermission('numbers.manage')
  async sync(@CurrentUser() user: AuthUser, @Body() dto: SyncGroupsDto) {
    const n = await this.prisma.whatsAppNumber.findFirst({ where: { id: dto.numberId, tenantId: user.tenantId, deletedAt: null } });
    if (!n) throw new NotFoundException('Número não encontrado');
    if (!canManageNumber(user, n.id)) throw new ForbiddenException('Você só gerencia os números que atende.');
    const ctx = await this.numbers.context(n.id);
    const provider = this.registry.get(ctx.provider);
    if (!provider.listGroups) throw new BadRequestException('Grupos só existem na conexão por QR Code — a API oficial da Meta não envia para grupos.');
    if (n.status !== 'connected') throw new BadRequestException('Conecte o número para listar os grupos.');

    const groups = await provider.listGroups(ctx);
    await this.prisma.$transaction([
      ...groups.map((g) =>
        this.prisma.whatsAppGroup.upsert({
          where: { numberId_jid: { numberId: n.id, jid: g.jid } },
          create: { tenantId: user.tenantId, numberId: n.id, jid: g.jid, name: g.name, size: g.size },
          update: { name: g.name, size: g.size },
        }),
      ),
      this.prisma.whatsAppGroup.deleteMany({ where: { numberId: n.id, authorized: false, inbox: false, jid: { notIn: groups.map((g) => g.jid) } } }),
    ]);
    return this.list(user, { numberId: n.id });
  }

  @Patch(':id')
  @RequirePermission('numbers.manage')
  async authorize(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AuthorizeGroupDto) {
    const g = await this.prisma.whatsAppGroup.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!g) throw new NotFoundException('Grupo não encontrado');
    if (!canManageNumber(user, g.numberId)) throw new ForbiddenException('Você só gerencia os números que atende.');
    return this.prisma.whatsAppGroup.update({
      where: { id },
      data: dto.authorized ? { authorized: true, authorizedAt: new Date(), authorizedById: user.id } : { authorized: false, authorizedAt: null, authorizedById: null },
      select: GROUP_SELECT,
    });
  }

  /**
   * "Mostrar nas conversas" (docs/grupos.md#grupos-nas-conversas): o grupo passa pelo filtro do
   * webhook e entra no painel como chat livre. Independente de `authorized`; é recurso de plano.
   */
  @Patch(':id/inbox')
  @UseGuards(FeatureGuard)
  @RequireFeature('groups_inbox')
  @RequirePermission('numbers.manage')
  async inbox(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InboxGroupDto) {
    const g = await this.prisma.whatsAppGroup.findFirst({ where: { id, tenantId: user.tenantId }, include: { number: { select: { externalId: true } } } });
    if (!g) throw new NotFoundException('Grupo não encontrado');
    if (!canManageNumber(user, g.numberId)) throw new ForbiddenException('Você só gerencia os números que atende.');
    const row = await this.prisma.whatsAppGroup.update({
      where: { id },
      data: dto.inbox ? { inbox: true, inboxAt: new Date(), inboxById: user.id } : { inbox: false, inboxAt: null, inboxById: null },
      select: GROUP_SELECT,
    });
    // vale já na próxima mensagem nesta réplica; a outra pega em até 1 min (TTL)
    this.inboxRegistry.invalidate(g.number.externalId);
    return row;
  }
}
