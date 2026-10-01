import { BadRequestException, Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class FolderDto {
  @IsString() @MaxLength(60) name: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
}
class ReplyDto {
  @IsUUID() folderId: string;
  @IsString() @MaxLength(80) title: string;
  /** com anexo, este texto vira a legenda */
  @IsString() @MaxLength(4096) body: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
  // anexo: `null` remove o que existia
  @IsOptional() @IsString() @MaxLength(300) mediaKey?: string | null;
  @IsOptional() @IsIn(['image', 'audio', 'video', 'document']) mediaType?: string | null;
  @IsOptional() @IsString() @MaxLength(200) mediaName?: string | null;
  @IsOptional() @IsString() @MaxLength(100) mediaMime?: string | null;
}

/** Painel direito: pastas -> mensagens pré-configuradas. */
@Controller('quick-replies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class QuickRepliesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** A chave do storage nunca sai crua: vira URL assinada e temporária. */
  private present<T extends { mediaKey: string | null }>(r: T) {
    return { ...r, mediaUrl: r.mediaKey ? this.storage.signedUrl(r.mediaKey) : null };
  }

  @Get()
  async tree(@CurrentUser() u: AuthUser) {
    const folders = await this.prisma.quickReplyFolder.findMany({
      where: { tenantId: u.tenantId },
      orderBy: { position: 'asc' },
      include: { replies: { orderBy: { position: 'asc' } } },
    });
    return folders.map((f) => ({ ...f, replies: f.replies.map((r) => this.present(r)) }));
  }

  @Post('folders')
  @RequirePermission('quick_replies.manage')
  createFolder(@CurrentUser() u: AuthUser, @Body() dto: FolderDto) {
    return this.prisma.quickReplyFolder.create({ data: { tenantId: u.tenantId, ...dto } });
  }
  @Patch('folders/:id')
  @RequirePermission('quick_replies.manage')
  updateFolder(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<FolderDto>) {
    return this.prisma.quickReplyFolder.update({ where: { id, tenantId: u.tenantId }, data: dto });
  }
  @Delete('folders/:id')
  @RequirePermission('quick_replies.manage')
  deleteFolder(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.quickReplyFolder.delete({ where: { id, tenantId: u.tenantId } });
  }

  @Post()
  @RequirePermission('quick_replies.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: ReplyDto) {
    await this.prisma.quickReplyFolder.findFirstOrThrow({ where: { id: dto.folderId, tenantId: u.tenantId } });
    this.assertOwnMedia(u.tenantId, dto.mediaKey);
    return this.present(await this.prisma.quickReply.create({ data: dto }));
  }
  @Patch(':id')
  @RequirePermission('quick_replies.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<ReplyDto>) {
    this.assertOwnMedia(u.tenantId, dto.mediaKey);
    return this.present(await this.prisma.quickReply.update({ where: { id, folder: { tenantId: u.tenantId } }, data: dto }));
  }

  /** Mídia de outro tenant não entra: a chave carrega o tenantId no caminho. */
  private assertOwnMedia(tenantId: string, key?: string | null) {
    if (key && !key.startsWith(`media/${tenantId}/`)) throw new BadRequestException('mediaKey inválida');
  }
  @Delete(':id')
  @RequirePermission('quick_replies.manage')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.quickReply.delete({ where: { id, folder: { tenantId: u.tenantId } } });
  }
}

@Module({ imports: [AuthModule], controllers: [QuickRepliesController] })
export class QuickRepliesModule {}
