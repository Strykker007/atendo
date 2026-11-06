import { Body, Controller, Delete, Get, Injectable, NotFoundException, Put, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AI_KEY_PROVIDERS, AI_KEY_PROVIDER_IDS, type AiKeyProvider, type AiOwnKeyStatus } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/observability/app-logger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { UsageService } from '../billing/usage.service';
import { AiProviderRegistry } from './ai-provider.registry';

interface Credentials { apiKey: string }

/** Chave pronta para uma chamada. */
export interface OwnKey {
  provider: AiKeyProvider;
  apiKey: string;
  model: string;
  hadError: boolean;
}

/**
 * Chave de IA do próprio cliente (feature `ai_own_key`, docs/15-ia.md#chave-própria-do-cliente).
 * Com ela, a IA do tenant roda na conta dele no fornecedor: sai da cota de interações, do teto de
 * gasto e do orçamento da plataforma, mas continua no ledger (`ai_usage.ownKey`) para diagnóstico.
 */
@Injectable()
export class AiOwnKeyService {
  private readonly log = new AppLogger(AiOwnKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly usage: UsageService,
    private readonly registry: AiProviderRegistry,
  ) {}

  /** Chave em uso: gravada **e** o plano inclui. Perdeu o recurso = volta para a IA da plataforma. */
  async resolve(tenantId: string, features?: readonly string[]): Promise<OwnKey | null> {
    const cred = await this.prisma.aiCredential.findUnique({ where: { tenantId } });
    if (!cred) return null;
    const feats = features ?? (await this.usage.limits(tenantId))?.limits.features ?? [];
    if (!feats.includes('ai_own_key')) return null;
    const provider = cred.provider as AiKeyProvider;
    if (!AI_KEY_PROVIDERS[provider]) return null;
    return {
      provider,
      apiKey: this.crypto.decryptJson<Credentials>(cred.credentials).apiKey,
      model: cred.model || AI_KEY_PROVIDERS[provider].defaultModel,
      hadError: !!cred.lastError,
    };
  }

  /** Marca/limpa o último erro (chave revogada, sem crédito) para a tela mostrar. */
  async markError(tenantId: string, error: string | null) {
    await this.prisma.aiCredential
      .updateMany({ where: { tenantId }, data: { lastError: error?.slice(0, 300) ?? null, lastErrorAt: error ? new Date() : null } })
      .catch(() => undefined);
  }

  async status(tenantId: string): Promise<AiOwnKeyStatus> {
    const [plan, cred] = await Promise.all([this.usage.limits(tenantId), this.prisma.aiCredential.findUnique({ where: { tenantId } })]);
    const feature = !!plan?.limits.features?.includes('ai_own_key');
    if (!cred) return { feature, connected: false, inUse: false };
    return {
      feature,
      connected: true,
      inUse: feature,
      provider: cred.provider as AiKeyProvider,
      model: cred.model || AI_KEY_PROVIDERS[cred.provider as AiKeyProvider]?.defaultModel,
      keyLast4: cred.keyLast4,
      lastError: cred.lastError,
      lastErrorAt: cred.lastErrorAt?.toISOString() ?? null,
      updatedAt: cred.updatedAt.toISOString(),
    };
  }

  /** Valida no fornecedor (lista de modelos: não gasta token) antes de gravar. */
  async save(tenantId: string, userId: string, input: { provider: AiKeyProvider; apiKey: string; model?: string }) {
    const apiKey = input.apiKey.trim();
    const model = input.model?.trim() || null;
    await this.registry.of(input.provider).verify(apiKey, model ?? undefined);
    const data = {
      provider: input.provider,
      credentials: this.crypto.encryptJson({ apiKey } satisfies Credentials),
      model,
      keyLast4: apiKey.slice(-4),
      lastError: null,
      lastErrorAt: null,
      createdById: userId,
    };
    await this.prisma.aiCredential.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    this.log.log(`tenant ${tenantId}: chave de IA própria gravada (${input.provider})`);
    return this.status(tenantId);
  }

  async remove(tenantId: string) {
    const { count } = await this.prisma.aiCredential.deleteMany({ where: { tenantId } });
    if (!count) throw new NotFoundException('Nenhuma chave gravada');
    return this.status(tenantId);
  }
}

class SaveOwnKeyDto {
  @IsIn(AI_KEY_PROVIDER_IDS) provider: AiKeyProvider;
  @IsString() @MinLength(20) @MaxLength(400) apiKey: string;
  /** vazio = padrão do fornecedor; só letras, números, ponto, hífen, dois-pontos e barra */
  @IsOptional() @IsString() @MaxLength(100) @Matches(/^[\w.:\/-]*$/) model?: string;
}

/** Quem mexe na chave é quem cuida da conta e do pagamento: `billing.manage`. */
@Controller('ai/own-key')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard, FeatureGuard)
@RequirePermission('billing.manage')
export class AiOwnKeyController {
  constructor(private readonly keys: AiOwnKeyService) {}

  @Get()
  status(@CurrentUser() u: AuthUser) {
    return this.keys.status(u.tenantId);
  }

  @Put()
  @RequireFeature('ai_own_key')
  save(@CurrentUser() u: AuthUser, @Body() dto: SaveOwnKeyDto) {
    return this.keys.save(u.tenantId, u.id, dto);
  }

  /** Apagar é liberado mesmo sem o recurso: o cliente sempre pode tirar a chave dele daqui. */
  @Delete()
  remove(@CurrentUser() u: AuthUser) {
    return this.keys.remove(u.tenantId);
  }
}
