import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Prisma, SendDelayProfile, WhatsAppProvider as ProviderKind } from '@prisma/client';
import { SEND_LIMIT_LABEL, SEND_LIMIT_RANGES, type SendLimits } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { NumbersService } from './numbers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PlanLimitGuard, RequireLimit } from '../billing/plan-limit.guard';
import { SendPacer } from './send-pacer';

class CreateNumberDto {
  @Matches(/^\+?[1-9]\d{7,14}$/) phone: string;
  @IsString() label: string;
  /** cor do canal no painel (#rrggbb) */
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsEnum(ProviderKind) provider: ProviderKind;
  @IsObject() config: Record<string, unknown>;
}
class SwitchProviderDto {
  @IsEnum(ProviderKind) provider: ProviderKind;
  @IsObject() config: Record<string, unknown>;
}
class UpdateNumberDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** proteção contra bloqueio: ritmo de envio e teto diário */
  @IsOptional() @IsEnum(SendDelayProfile) sendDelay?: SendDelayProfile;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) sendDailyLimit?: number;
  /** `true` encerra o aquecimento (chip antigo que só é novo no Atendo). Não dá para religar. */
  @IsOptional() @IsBoolean() endWarmup?: boolean;
  /** limites da fila de envio (`Partial<SendLimits>`); campo ausente/null = padrão do provider. null limpa tudo */
  @IsOptional() @IsObject() sendLimits?: Partial<SendLimits> | null;
  /**
   * Custo mensal desta linha (servidor, chip, taxa do provider). É o que faz a margem por
   * cliente deixar de ser chute. Só o dono do sistema altera — para o cliente, o custo da
   * operação não é informação dele, e deixá-lo editável permitiria "zerar" o próprio custo.
   */
  @IsOptional() @IsNumber() @Min(0) @Max(99_999) infraCostMonth?: number;
}

@Controller('numbers')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class NumbersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly numbers: NumbersService,
    private readonly pacer: SendPacer,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.whatsAppNumber.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, phone: true, label: true, color: true, provider: true, status: true, isActive: true, createdAt: true, sendDelay: true, sendDailyLimit: true, sendLimits: true, warmupStartedAt: true, infraCostMonth: true, scheduleId: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post()
  @RequirePermission('numbers.manage')
  @UseGuards(PlanLimitGuard)
  @RequireLimit('maxNumbers')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateNumberDto) {
    const externalId = String(dto.config.phoneNumberId ?? dto.config.instanceName ?? `atendo-${user.tenantId.slice(0, 8)}-${dto.phone}`);
    const config = dto.provider === 'evolution' ? { instanceName: externalId, ...dto.config } : dto.config;
    const n = await this.prisma.whatsAppNumber.create({
      data: {
        tenantId: user.tenantId,
        phone: dto.phone.replace(/^\+/, ''),
        label: dto.label,
        ...(dto.color && { color: dto.color }),
        provider: dto.provider,
        externalId,
        providerConfig: this.crypto.encryptJson(config),
      },
    });
    return this.numbers.switchProvider(n.id, dto.provider, config as any);
  }

  /** A troca oficial <-> não-oficial. */
  @Put(':id/provider')
  @RequirePermission('numbers.manage')
  async switchProvider(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SwitchProviderDto) {
    await this.prisma.whatsAppNumber.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    return this.numbers.switchProvider(id, dto.provider, dto.config as any);
  }

  @Patch(':id')
  @RequirePermission('numbers.manage')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateNumberDto) {
    const { infraCostMonth, sendLimits, endWarmup, ...resto } = dto;
    const limites = sendLimits === undefined ? {} : { sendLimits: sendLimits === null ? Prisma.DbNull : (cleanSendLimits(sendLimits) as Prisma.InputJsonValue) };
    // Chega no corpo mas é descartado para quem não é o dono: devolver 403 vazaria que o campo
    // existe, e ele não é assunto do cliente.
    // `impersonatorId` entra porque o dono edita isto **entrando como o cliente** — o token de
    // impersonação carrega papel de admin do cliente, então checar só o papel trancaria o
    // próprio dono para fora do único lugar onde o campo aparece.
    const ehDono = user.role === 'super_admin' || !!user.impersonatorId;
    const custo = ehDono && infraCostMonth !== undefined ? { infraCostMonth } : {};
    return this.prisma.whatsAppNumber.update({
      where: { id, tenantId: user.tenantId },
      data: { ...resto, ...custo, ...limites, ...(endWarmup && { warmupStartedAt: null }) },
      select: { id: true, label: true, color: true, isActive: true, sendDelay: true, sendDailyLimit: true, sendLimits: true, infraCostMonth: true, warmupStartedAt: true },
    });
  }

  /** Quanto este número já enviou hoje e qual o teto (considerando o aquecimento). */
  @Get(':id/sending')
  async sending(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const n = await this.prisma.whatsAppNumber.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      select: { id: true, provider: true, sendDelay: true, sendDailyLimit: true, warmupStartedAt: true },
    });
    const status = await this.pacer.dailyStatus(n);
    return { ...status, sendDelay: n.sendDelay, warmupStartedAt: n.warmupStartedAt };
  }

  /** Remove o número do provider e do banco (conversas vão junto — cascade). */
  @Delete(':id')
  @RequirePermission('numbers.manage')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.whatsAppNumber.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    await this.numbers.remove(id);
    return { ok: true };
  }

  /** Reconecta (gera QR novo na Evolution, revalida token na Meta). */
  @Post(':id/connect')
  @RequirePermission('numbers.manage')
  async connect(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const n = await this.prisma.whatsAppNumber.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    const ctx = await this.numbers.context(n.id);
    return this.numbers.switchProvider(n.id, n.provider, ctx.config as any);
  }
}

/** Só as chaves conhecidas, dentro da faixa — o resto 400. Guardar lixo faria o worker cair no padrão sem ninguém saber. */
function cleanSendLimits(input: Partial<SendLimits>): Partial<SendLimits> {
  const out: Partial<SendLimits> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === null || v === undefined) continue;
    const range = SEND_LIMIT_RANGES[k as keyof SendLimits];
    if (!range) throw new BadRequestException(`Limite desconhecido: ${k}`);
    if (typeof v !== 'number' || !Number.isInteger(v) || v < range[0] || v > range[1]) {
      throw new BadRequestException(`${SEND_LIMIT_LABEL[k as keyof SendLimits]}: use um número inteiro entre ${range[0]} e ${range[1]}.`);
    }
    out[k as keyof SendLimits] = v;
  }
  return out;
}
