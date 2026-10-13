import { Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
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

class TagDto {
  @IsString() @MaxLength(40) name: string;
  @IsOptional() @IsHexColor() color?: string;
  /** vira coluna no Kanban */
  @IsOptional() @IsBoolean() isKanban?: boolean;
  /** aparece para escolha no encerramento (Comprou / Não comprou) */
  @IsOptional() @IsBoolean() showOnClose?: boolean;
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
  @IsOptional() @IsBoolean() showOnClose?: boolean;
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
  @IsOptional() @IsBoolean() showOnClose?: boolean;
}

/** Tags são criadas dinamicamente em configurações e viram filtros/relatórios. */
@Controller('tags')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
class TagsController {
  constructor(private readonly prisma: PrismaService, private readonly gateway: ConversationsGateway) {}

  // na ordem do Kanban: é a mesma lista que monta as colunas
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.tag.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { _count: { select: { conversations: true, contacts: true } } } });
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
      data: names.map((name, i) => ({ tenantId: u.tenantId, name, position: start + i, isKanban: dto.isKanban ?? false, showOnClose: dto.showOnClose ?? false, ...(porNome.get(name) && { color: porNome.get(name) }) })),
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
