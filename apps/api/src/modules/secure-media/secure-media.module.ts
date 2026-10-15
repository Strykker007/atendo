import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { randomBytes } from 'node:crypto';
import type { SecureMedia } from '@prisma/client';
import { SECURE_MEDIA_DEFAULT_HOURS, SECURE_MEDIA_MAX_HOURS, SECURE_MEDIA_MIMES, type PublicSecureMedia, type SecureMediaStatus } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationScopeGuard } from '../conversations/conversation-scope.guard';

const newHash = () => randomBytes(16).toString('base64url');
const HASH_RE = /^[A-Za-z0-9_-]{22}$/;
/** a página pede a mídia de novo a cada abertura: URL assinada curta, que não serve para repassar */
const SIGNED_TTL_S = 10 * 60;

class CreateSecureMediaDto {
  /** chave devolvida pelo upload do painel (`media/<tenant>/…`) */
  @IsString() @MaxLength(300) @Matches(/^media\//) mediaKey!: string;
  @IsIn(SECURE_MEDIA_MIMES as unknown as string[]) mimeType!: string;
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  /** vai só para a página — nunca para o WhatsApp */
  @IsOptional() @IsString() @MaxLength(1000) caption?: string;
  @IsOptional() @IsInt() @Min(1) @Max(SECURE_MEDIA_MAX_HOURS) validHours?: number;
}

const statusOf = (m: Pick<SecureMedia, 'expiresAt' | 'revokedAt'>): SecureMediaStatus =>
  m.revokedAt ? 'revoked' : m.expiresAt.getTime() <= Date.now() ? 'expired' : 'active';

/**
 * Foto protegida (docs/foto-protegida.md). Nada aqui envia mensagem: a API guarda a mídia
 * atrás de um link com validade e devolve o hash; o painel monta o texto e envia pelo caminho
 * normal do chat (quota, janela da Meta, `UsageService`).
 */
@Injectable()
export class SecureMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(u: AuthUser, conversationId: string, dto: CreateSecureMediaDto) {
    // a chave tem que ser de um arquivo deste cliente: sem isto, quem conhecesse a chave de
    // outro tenant publicaria o arquivo dele numa página aberta
    if (!dto.mediaKey.startsWith(`media/${u.tenantId}/`)) throw new BadRequestException('Arquivo inválido');
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId: u.tenantId }, select: { contactId: true } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const validHours = dto.validHours ?? SECURE_MEDIA_DEFAULT_HOURS;
    const m = await this.prisma.secureMedia.create({
      data: {
        tenantId: u.tenantId,
        conversationId,
        contactId: conv.contactId,
        userId: u.id,
        userName: u.name,
        hash: newHash(),
        mediaKey: dto.mediaKey,
        mediaMime: dto.mimeType,
        mediaName: dto.fileName?.slice(0, 200),
        caption: dto.caption?.trim() || null,
        validHours,
        expiresAt: new Date(Date.now() + validHours * 3_600_000),
      },
    });
    return this.present(m);
  }

  async list(tenantId: string, conversationId: string) {
    const rows = await this.prisma.secureMedia.findMany({ where: { tenantId, conversationId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((m) => this.present(m));
  }

  /** Tira do ar antes da validade (mandou a foto errada, para a pessoa errada). */
  async revoke(u: AuthUser, conversationId: string, id: string) {
    const r = await this.prisma.secureMedia.updateMany({ where: { id, conversationId, tenantId: u.tenantId, revokedAt: null }, data: { revokedAt: new Date(), revokedById: u.id } });
    if (!r.count) throw new NotFoundException('Link não encontrado ou já revogado');
    return this.present(await this.prisma.secureMedia.findUniqueOrThrow({ where: { id } }));
  }

  // ---- público (sem login): o hash é a credencial ----

  async publicView(hash: string): Promise<PublicSecureMedia> {
    const m = HASH_RE.test(hash) ? await this.prisma.secureMedia.findUnique({ where: { hash } }) : null;
    if (!m) throw new NotFoundException('Link não encontrado');
    const status = statusOf(m);
    const [tenant, contact] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: m.tenantId }, select: { name: true } }),
      this.prisma.contact.findUnique({ where: { id: m.contactId }, select: { name: true } }),
    ]);
    if (status === 'active') {
      await this.prisma.secureMedia.update({ where: { id: m.id }, data: { viewCount: { increment: 1 }, ...(!m.firstViewedAt && { firstViewedAt: new Date() }) } });
    }
    return {
      tenantName: tenant?.name ?? '',
      contactFirstName: contact?.name?.trim().split(/\s+/)[0] || null,
      agentName: m.userName.trim().split(/\s+/)[0] ?? '',
      status,
      expiresAt: m.expiresAt.toISOString(),
      // expirado/revogado: nem a legenda (pode citar o remédio)
      caption: status === 'active' ? m.caption : null,
      media: status === 'active' ? { url: this.storage.signedUrl(m.mediaKey, SIGNED_TTL_S), mimeType: m.mediaMime, fileName: m.mediaName } : null,
    };
  }

  private present(m: SecureMedia) {
    return {
      id: m.id,
      hash: m.hash,
      status: statusOf(m),
      mimeType: m.mediaMime,
      fileName: m.mediaName,
      caption: m.caption,
      validHours: m.validHours,
      expiresAt: m.expiresAt,
      revokedAt: m.revokedAt,
      firstViewedAt: m.firstViewedAt,
      viewCount: m.viewCount,
      createdAt: m.createdAt,
      user: { id: m.userId, name: m.userName },
      /** a equipe continua vendo a foto no painel, mesmo depois de expirar para o contato */
      url: this.storage.signedUrl(m.mediaKey),
    };
  }
}

/** `:id` = conversa — o ConversationScopeGuard barra número/departamento de fora. */
@Controller('conversations/:id/secure-media')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard, ConversationScopeGuard)
class SecureMediaController {
  constructor(private readonly media: SecureMediaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.media.list(u.tenantId, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreateSecureMediaDto) {
    return this.media.create(u, id, dto);
  }

  @Post(':mediaId/revoke')
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('mediaId') mediaId: string) {
    return this.media.revoke(u, id, mediaId);
  }
}

/** Página pública /f/:hash. Sem login; limite por IP mais apertado que o padrão. */
@Controller('secure-media/public/:hash')
class PublicSecureMediaController {
  constructor(private readonly media: SecureMediaService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  view(@Param('hash') hash: string) {
    return this.media.publicView(hash);
  }
}

@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [SecureMediaController, PublicSecureMediaController],
  providers: [SecureMediaService],
})
export class SecureMediaModule {}
