import { Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class FolderDto {
  @IsString() @MaxLength(60) name: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
}
class ReplyDto {
  @IsUUID() folderId: string;
  @IsString() @MaxLength(80) title: string;
  @IsString() @MaxLength(4096) body: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

/** Painel direito: pastas -> mensagens pré-configuradas. */
@Controller('quick-replies')
@UseGuards(JwtAuthGuard)
class QuickRepliesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  tree(@CurrentUser() u: AuthUser) {
    return this.prisma.quickReplyFolder.findMany({
      where: { tenantId: u.tenantId },
      orderBy: { position: 'asc' },
      include: { replies: { orderBy: { position: 'asc' } } },
    });
  }

  @Post('folders')
  createFolder(@CurrentUser() u: AuthUser, @Body() dto: FolderDto) {
    return this.prisma.quickReplyFolder.create({ data: { tenantId: u.tenantId, ...dto } });
  }
  @Patch('folders/:id')
  updateFolder(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<FolderDto>) {
    return this.prisma.quickReplyFolder.update({ where: { id, tenantId: u.tenantId }, data: dto });
  }
  @Delete('folders/:id')
  deleteFolder(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.quickReplyFolder.delete({ where: { id, tenantId: u.tenantId } });
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() dto: ReplyDto) {
    await this.prisma.quickReplyFolder.findFirstOrThrow({ where: { id: dto.folderId, tenantId: u.tenantId } });
    return this.prisma.quickReply.create({ data: dto });
  }
  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<ReplyDto>) {
    return this.prisma.quickReply.update({ where: { id, folder: { tenantId: u.tenantId } }, data: dto });
  }
  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.quickReply.delete({ where: { id, folder: { tenantId: u.tenantId } } });
  }
}

@Module({ imports: [AuthModule], controllers: [QuickRepliesController] })
export class QuickRepliesModule {}
