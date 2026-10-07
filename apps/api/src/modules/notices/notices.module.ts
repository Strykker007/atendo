import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SystemNoticeType } from '@prisma/client';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';

class CreateNoticeDto {
  @IsString() @IsNotEmpty() @MaxLength(120) title: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) message: string;
  @IsOptional() @IsEnum(SystemNoticeType) type?: SystemNoticeType;
}
class UpdateNoticeDto {
  @IsBoolean() active: boolean;
}

/** quantos avisos o sino mostra — é histórico recente, não arquivo */
const ACTIVE_LIMIT = 30;

/**
 * Avisos globais do dono do sistema (docs/avisos.md). Não são de tenant: valem para todo
 * cliente logado, chegam ao vivo pelo socket (`system_notice`) e ficam no sino enquanto ativos.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
class NoticesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Avisos ativos — qualquer usuário logado (cliente ou dono). */
  @Get('notices/active')
  @NoTenantOk()
  active() {
    return this.prisma.systemNotice.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' }, take: ACTIVE_LIMIT });
  }

  @Get('super-admin/notices')
  @NoTenantOk()
  @Roles('super_admin')
  list() {
    return this.prisma.systemNotice.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Post('super-admin/notices')
  @NoTenantOk()
  @Roles('super_admin')
  async create(@Body() dto: CreateNoticeDto) {
    const notice = await this.prisma.systemNotice.create({ data: { title: dto.title.trim(), message: dto.message.trim(), type: dto.type ?? 'INFO' } });
    this.gateway.emitSystemNotice(notice);
    return notice;
  }

  /** Desativar tira do sino de todos (não reenvia o popup ao reativar). */
  @Patch('super-admin/notices/:id')
  @NoTenantOk()
  @Roles('super_admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNoticeDto) {
    return this.prisma.systemNotice.update({ where: { id }, data: { active: dto.active } });
  }
}

@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [NoticesController],
})
export class NoticesModule {}
