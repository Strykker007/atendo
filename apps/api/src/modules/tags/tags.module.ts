import { Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsHexColor, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class TagDto {
  @IsString() @MaxLength(40) name: string;
  @IsOptional() @IsHexColor() color?: string;
}

/** Tags são criadas dinamicamente em configurações e viram filtros/relatórios. */
@Controller('tags')
@UseGuards(JwtAuthGuard, RolesGuard)
class TagsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.tag.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' }, include: { _count: { select: { conversations: true } } } });
  }

  @Post()
  @Roles('tenant_admin', 'super_admin')
  create(@CurrentUser() u: AuthUser, @Body() dto: TagDto) {
    return this.prisma.tag.create({ data: { tenantId: u.tenantId, ...dto } });
  }

  @Patch(':id')
  @Roles('tenant_admin', 'super_admin')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<TagDto>) {
    return this.prisma.tag.update({ where: { id, tenantId: u.tenantId }, data: dto });
  }

  @Delete(':id')
  @Roles('tenant_admin', 'super_admin')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.tag.delete({ where: { id, tenantId: u.tenantId } });
  }
}

@Module({ imports: [AuthModule], controllers: [TagsController] })
export class TagsModule {}
