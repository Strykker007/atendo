import { Body, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsHexColor, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { MAX_CONFLICTS_PER_TAG, conflictPair } from './conflicts';

class TagDto {
  @IsString() @MaxLength(40) name: string;
  @IsOptional() @IsHexColor() color?: string;
  /** vira coluna no Kanban */
  @IsOptional() @IsBoolean() isKanban?: boolean;
  /** aparece para escolha ao encerrar como "Comprou" */
  @IsOptional() @IsBoolean() showOnWon?: boolean;
  /** aparece para escolha ao encerrar como "Não comprou" */
  @IsOptional() @IsBoolean() showOnLost?: boolean;
  /** ordem da coluna; para reordenar várias de uma vez use PATCH /kanban/columns */
  @IsOptional() @IsInt() @Min(0) position?: number;
}

/** teto de uma ação em massa — a tela manda as selecionadas, que cabem folgado aqui */
const BULK_MAX = 500;

class BulkIdsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(BULK_MAX) @IsUUID('4', { each: true }) ids: string[];
}
class BulkUpdateDto extends BulkIdsDto {
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() isKanban?: boolean;
  @IsOptional() @IsBoolean() showOnWon?: boolean;
  @IsOptional() @IsBoolean() showOnLost?: boolean;
}
class OrderDto {
  /** todas as tags na ordem nova (a lista inteira, arrastada na tela de Tags) */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(1000) @IsUUID('4', { each: true }) ids: string[];
}
class ConflictsDto {
  /** a lista inteira de opostas desta tag (substitui); vazia = sem conflito */
  @IsArray() @ArrayMaxSize(MAX_CONFLICTS_PER_TAG) @IsUUID('4', { each: true }) ids: string[];
}
class BulkCreateItemDto {
  @IsString() @MaxLength(40) name: string;
  /** cor desta tag; sem ela, a `color` geral */
  @IsOptional() @IsHexColor() color?: string;
}
class BulkCreateDto {
  /** uma por tag (a tela manda uma linha por tag); repetida ou já existente é ignorada */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(BULK_MAX) @ValidateNested({ each: true }) @Type(() => BulkCreateItemDto) items: BulkCreateItemDto[];
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() isKanban?: boolean;
  @IsOptional() @IsBoolean() showOnWon?: boolean;
  @IsOptional() @IsBoolean() showOnLost?: boolean;
}

/** Tags são criadas dinamicamente em configurações e viram filtros/relatórios. */
@Controller('tags')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
class TagsController {
  constructor(private readonly prisma: PrismaService, private readonly gateway: ConversationsGateway) {}

  // na ordem do Kanban: é a mesma lista que monta as colunas
  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const tags = await this.prisma.tag.findMany({
      where: { tenantId: u.tenantId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { conversations: true, contacts: true } }, conflictsA: { select: { otherId: true } }, conflictsB: { select: { tagId: true } } },
    });
    // o par é guardado uma vez só; a tela recebe as opostas de cada tag, dos dois lados
    return tags.map(({ conflictsA, conflictsB, ...t }) => ({ ...t, conflictIds: [...conflictsA.map((c) => c.otherId), ...conflictsB.map((c) => c.tagId)] }));
  }

  /**
   * Opostas desta tag ("Comprou" × "Não comprou"): marcar uma tira as outras do atendimento.
   * Substitui a lista inteira; o par vale nos dois sentidos. Só tags do tenant, sem ela mesma.
   */
  @Put(':id/conflicts')
  @RequirePermission('tags.manage')
  async setConflicts(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ConflictsDto) {
    const tag = await this.prisma.tag.findFirst({ where: { id, tenantId: u.tenantId }, select: { id: true } });
    if (!tag) throw new NotFoundException('Tag não encontrada');
    const outras = await this.prisma.tag.findMany({ where: { tenantId: u.tenantId, id: { in: [...new Set(dto.ids)].filter((x) => x !== id) } }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.tagConflict.deleteMany({ where: { OR: [{ tagId: id }, { otherId: id }] } }),
      this.prisma.tagConflict.createMany({ data: outras.map((o) => conflictPair(id, o.id)), skipDuplicates: true }),
    ]);
    return { conflictIds: outras.map((o) => o.id) };
  }

  @Post()
  @RequirePermission('tags.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: TagDto) {
    // tag nova entra como última coluna
    const last = await this.prisma.tag.aggregate({ where: { tenantId: u.tenantId }, _max: { position: true } });
    const tag = await this.prisma.tag.create({ data: { tenantId: u.tenantId, position: (last._max.position ?? -1) + 1, ...dto } });
    this.gateway.emitKanban(u.tenantId);
    return tag;
  }

  /**
   * Em massa (antes das rotas `:id`). Sempre filtrado pelo tenant: id de outro cliente no
   * payload simplesmente não casa. Mesmas regras do individual.
   */
  @Post('bulk')
  @RequirePermission('tags.manage')
  async bulkCreate(@CurrentUser() u: AuthUser, @Body() dto: BulkCreateDto) {
    // repetida no próprio lote: vale a primeira (com a cor dela)
    const porNome = new Map<string, string | undefined>();
    for (const i of dto.items) {
      const name = i.name.trim();
      if (name && !porNome.has(name)) porNome.set(name, i.color ?? dto.color);
    }
    const names = [...porNome.keys()];
    if (!names.length) return { created: 0, skipped: 0 };
    const last = await this.prisma.tag.aggregate({ where: { tenantId: u.tenantId }, _max: { position: true } });
    const start = (last._max.position ?? -1) + 1;
    const r = await this.prisma.tag.createMany({
      data: names.map((name, i) => ({ tenantId: u.tenantId, name, position: start + i, isKanban: dto.isKanban ?? false, showOnWon: dto.showOnWon ?? false, showOnLost: dto.showOnLost ?? false, ...(porNome.get(name) && { color: porNome.get(name) }) })),
      skipDuplicates: true,
    });
    this.gateway.emitKanban(u.tenantId);
    return { created: r.count, skipped: names.length - r.count };
  }

  @Patch('bulk')
  @RequirePermission('tags.manage')
  async bulkUpdate(@CurrentUser() u: AuthUser, @Body() dto: BulkUpdateDto) {
    const { ids, ...data } = dto;
    const r = await this.prisma.$transaction(async (tx) => {
      const res = await tx.tag.updateMany({ where: { tenantId: u.tenantId, id: { in: ids } }, data });
      // deixou de ser etapa: quem a tinha como principal volta para "Sem etapa" (continua como tag)
      if (data.isKanban === false) await tx.conversationTag.updateMany({ where: { tagId: { in: ids }, isPrimary: true, tag: { tenantId: u.tenantId } }, data: { isPrimary: false } });
      return res;
    });
    this.gateway.emitKanban(u.tenantId);
    return { updated: r.count };
  }

  /** Reordenar arrastando: `position` = índice na lista. Também é a ordem das colunas do Kanban. */
  @Patch('order')
  @RequirePermission('tags.manage')
  async order(@CurrentUser() u: AuthUser, @Body() dto: OrderDto) {
    await this.prisma.$transaction(dto.ids.map((id, position) => this.prisma.tag.updateMany({ where: { id, tenantId: u.tenantId }, data: { position } })));
    this.gateway.emitKanban(u.tenantId);
    return { ok: true };
  }

  @Post('bulk-delete')
  @RequirePermission('tags.manage')
  async bulkDelete(@CurrentUser() u: AuthUser, @Body() dto: BulkIdsDto) {
    const r = await this.prisma.tag.deleteMany({ where: { tenantId: u.tenantId, id: { in: dto.ids } } });
    this.gateway.emitKanban(u.tenantId);
    return { deleted: r.count };
  }

  @Patch(':id')
  @RequirePermission('tags.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<TagDto>) {
    const tag = await this.prisma.tag.update({ where: { id, tenantId: u.tenantId }, data: dto });
    // deixou de ser etapa: quem a tinha como principal volta para "Sem etapa" (continua como tag)
    if (dto.isKanban === false) await this.prisma.conversationTag.updateMany({ where: { tagId: id, isPrimary: true }, data: { isPrimary: false } });
    this.gateway.emitKanban(u.tenantId);
    return tag;
  }

  @Delete(':id')
  @RequirePermission('tags.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const tag = await this.prisma.tag.delete({ where: { id, tenantId: u.tenantId } });
    this.gateway.emitKanban(u.tenantId);
    return tag;
  }
}

@Module({ imports: [AuthModule, ConversationsModule], controllers: [TagsController] })
export class TagsModule {}
