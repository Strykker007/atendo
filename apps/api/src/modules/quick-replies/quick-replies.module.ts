import { BadRequestException, Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { copyName } from '@atendo/shared';
import { parsePortableReplyFile, toPortableReply, toReplyBundle, type PortableQuickReply } from './portable';

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

class ReorderItemDto {
  @IsUUID() id: string;
  @IsInt() @Min(0) position: number;
  /** só para respostas: arrastar para outra pasta */
  @IsOptional() @IsUUID() folderId?: string;
}
class ReorderDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReorderItemDto) items: ReorderItemDto[];
}
class IdsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids: string[];
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
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { replies: { orderBy: { position: 'asc' } } },
    });
    return folders.map((f) => ({ ...f, replies: f.replies.map((r) => this.present(r)) }));
  }

  @Post('folders')
  @RequirePermission('quick_replies.manage')
  async createFolder(@CurrentUser() u: AuthUser, @Body() dto: FolderDto) {
    // pasta nova entra no fim — com todas em 0 ela cairia em qualquer lugar da lista
    const last = await this.prisma.quickReplyFolder.aggregate({ where: { tenantId: u.tenantId }, _max: { position: true } });
    return this.prisma.quickReplyFolder.create({ data: { tenantId: u.tenantId, position: (last._max.position ?? -1) + 1, ...dto } });
  }
  /** Ordem das pastas após arrastar. Declarado antes de `folders/:id` para a rota não ser engolida. */
  @Patch('folders/reorder')
  @RequirePermission('quick_replies.manage')
  async reorderFolders(@CurrentUser() u: AuthUser, @Body() dto: ReorderDto) {
    await this.prisma.$transaction(
      dto.items.map((it) => this.prisma.quickReplyFolder.updateMany({ where: { id: it.id, tenantId: u.tenantId }, data: { position: it.position } })),
    );
    return { ok: true };
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
    const last = await this.prisma.quickReply.aggregate({ where: { folderId: dto.folderId }, _max: { position: true } });
    return this.present(await this.prisma.quickReply.create({ data: { position: (last._max.position ?? -1) + 1, ...dto } }));
  }
  /**
   * Ordem das respostas após arrastar — inclusive para outra pasta (`folderId`). Antes de
   * `:id` para a rota não ser engolida.
   */
  @Patch('reorder')
  @RequirePermission('quick_replies.manage')
  async reorder(@CurrentUser() u: AuthUser, @Body() dto: ReorderDto) {
    const destinos = [...new Set(dto.items.flatMap((it) => (it.folderId ? [it.folderId] : [])))];
    if (destinos.length) {
      const own = await this.prisma.quickReplyFolder.count({ where: { id: { in: destinos }, tenantId: u.tenantId } });
      if (own !== destinos.length) throw new BadRequestException('Pasta inválida');
    }
    await this.prisma.$transaction(
      dto.items.map((it) => this.prisma.quickReply.updateMany({
        where: { id: it.id, folder: { tenantId: u.tenantId } },
        data: { position: it.position, ...(it.folderId && { folderId: it.folderId }) },
      })),
    );
    return { ok: true };
  }
  // ---------- duplicar / exportar / importar (mesmo comportamento dos fluxos) ----------

  /** Cópias na mesma pasta, com "(cópia)" no título. Mesmo cliente: o anexo continua valendo. */
  @Post('duplicate')
  @RequirePermission('quick_replies.manage')
  async duplicate(@CurrentUser() u: AuthUser, @Body() dto: IdsDto) {
    const src = await this.ownReplies(u.tenantId, dto.ids);
    const created = [];
    for (const r of src) {
      const taken = (await this.prisma.quickReply.findMany({ where: { folderId: r.folderId }, select: { title: true } })).map((x) => x.title);
      const last = await this.prisma.quickReply.aggregate({ where: { folderId: r.folderId }, _max: { position: true } });
      created.push(await this.prisma.quickReply.create({
        data: { folderId: r.folderId, title: copyName(r.title, taken), body: r.body, mediaKey: r.mediaKey, mediaType: r.mediaType, mediaName: r.mediaName, mediaMime: r.mediaMime, position: (last._max.position ?? -1) + 1 },
      }));
    }
    return { replies: created.map((r) => this.present(r)) };
  }

  @Get(':id/export')
  @RequirePermission('quick_replies.manage')
  async exportOne(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const [r] = await this.ownReplies(u.tenantId, [id]);
    return toPortableReply(r, r.folder.name);
  }

  /** Várias respostas num arquivo: a lista de itens no mesmo formato da exportação individual. */
  @Post('export')
  @RequirePermission('quick_replies.manage')
  async exportBatch(@CurrentUser() u: AuthUser, @Body() dto: IdsDto) {
    const src = await this.ownReplies(u.tenantId, dto.ids);
    const out = src.map((r) => toPortableReply(r, r.folder.name));
    return { bundle: toReplyBundle(out.map((o) => o.portable)), warnings: out.flatMap((o) => o.warnings) };
  }

  /**
   * Arquivo individual ou lote. A pasta é achada pelo nome (ou criada); título repetido na
   * mesma pasta ganha "(cópia)". Tudo ou nada: item inválido recusa o arquivo antes de gravar.
   */
  @Post('import')
  @RequirePermission('quick_replies.manage')
  async import(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    let items: PortableQuickReply[];
    try {
      items = parsePortableReplyFile((body as { portable?: unknown })?.portable ?? body);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Arquivo inválido.');
    }
    return this.prisma.$transaction(async (tx) => {
      const folders = await tx.quickReplyFolder.findMany({ where: { tenantId: u.tenantId }, include: { replies: { select: { title: true, position: true } } } });
      const byName = new Map(folders.map((f) => [f.name, { id: f.id, titles: f.replies.map((r) => r.title), next: Math.max(-1, ...f.replies.map((r) => r.position)) + 1 }]));
      let nextFolderPos = Math.max(-1, ...folders.map((f) => f.position)) + 1;
      const created = [];
      for (const it of items) {
        let f = byName.get(it.folder);
        if (!f) {
          const nf = await tx.quickReplyFolder.create({ data: { tenantId: u.tenantId, name: it.folder, position: nextFolderPos++ } });
          f = { id: nf.id, titles: [], next: 0 };
          byName.set(it.folder, f);
        }
        const title = f.titles.includes(it.title) ? copyName(it.title, f.titles) : it.title;
        f.titles.push(title);
        created.push(await tx.quickReply.create({ data: { folderId: f.id, title, body: it.body, position: f.next++ } }));
      }
      return { replies: created.map((r) => this.present(r)), warnings: [] as string[] };
    });
  }

  /** Respostas do tenant, com a pasta; recusa se algum id não for dele. */
  private async ownReplies(tenantId: string, ids: string[]) {
    const rows = await this.prisma.quickReply.findMany({
      where: { id: { in: ids }, folder: { tenantId } },
      include: { folder: { select: { name: true, position: true } } },
      orderBy: [{ folder: { position: 'asc' } }, { position: 'asc' }],
    });
    if (rows.length !== new Set(ids).size) throw new BadRequestException('Resposta não encontrada.');
    return rows;
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
