import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { SendDelayProfile, WhatsAppProvider as ProviderKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { NumbersService } from './numbers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PlanLimitGuard, RequireLimit } from '../billing/plan-limit.guard';
import { SendPacer } from './send-pacer';

class CreateNumberDto {
  @Matches(/^\+?[1-9]\d{7,14}$/) phone: string;
  @IsString() label: string;
  @IsEnum(ProviderKind) provider: ProviderKind;
  @IsObject() config: Record<string, unknown>;
}
class SwitchProviderDto {
  @IsEnum(ProviderKind) provider: ProviderKind;
  @IsObject() config: Record<string, unknown>;
}
class UpdateNumberDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** proteção contra bloqueio: ritmo de envio e teto diário */
  @IsOptional() @IsEnum(SendDelayProfile) sendDelay?: SendDelayProfile;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) sendDailyLimit?: number;
}

@Controller('numbers')
@UseGuards(JwtAuthGuard, RolesGuard)
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
      select: { id: true, phone: true, label: true, provider: true, status: true, isActive: true, createdAt: true, sendDelay: true, sendDailyLimit: true, warmupStartedAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post()
  @Roles('tenant_admin', 'super_admin')
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
        provider: dto.provider,
        externalId,
        providerConfig: this.crypto.encryptJson(config),
      },
    });
    return this.numbers.switchProvider(n.id, dto.provider, config as any);
  }

  /** A troca oficial <-> não-oficial. */
  @Put(':id/provider')
  @Roles('tenant_admin', 'super_admin')
  async switchProvider(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SwitchProviderDto) {
    await this.prisma.whatsAppNumber.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    return this.numbers.switchProvider(id, dto.provider, dto.config as any);
  }

  @Patch(':id')
  @Roles('tenant_admin', 'super_admin')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateNumberDto) {
    return this.prisma.whatsAppNumber.update({
      where: { id, tenantId: user.tenantId },
      data: dto,
      select: { id: true, label: true, isActive: true, sendDelay: true, sendDailyLimit: true },
    });
  }

  /** Quanto este número já enviou hoje e qual o teto (considerando o aquecimento). */
  @Get(':id/sending')
  async sending(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const n = await this.prisma.whatsAppNumber.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      select: { id: true, sendDelay: true, sendDailyLimit: true, warmupStartedAt: true },
    });
    const status = await this.pacer.dailyStatus(n);
    return { ...status, sendDelay: n.sendDelay, warmupStartedAt: n.warmupStartedAt };
  }

  /** Remove o número do provider e do banco (conversas vão junto — cascade). */
  @Delete(':id')
  @Roles('tenant_admin', 'super_admin')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.whatsAppNumber.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    await this.numbers.remove(id);
    return { ok: true };
  }

  /** Reconecta (gera QR novo na Evolution, revalida token na Meta). */
  @Post(':id/connect')
  @Roles('tenant_admin', 'super_admin')
  async connect(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const n = await this.prisma.whatsAppNumber.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    const ctx = await this.numbers.context(n.id);
    return this.numbers.switchProvider(n.id, n.provider, ctx.config as any);
  }
}
