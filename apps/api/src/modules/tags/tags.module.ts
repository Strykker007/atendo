import { Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsHexColor, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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
  /** ordem da coluna; para reordenar várias de uma vez use PATCH /kanban/columns */
  @IsOptional() @IsInt() @Min(0) position?: number;
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
