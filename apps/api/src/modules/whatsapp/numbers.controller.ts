import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IsEnum, IsObject, IsString, Matches } from 'class-validator';
import { WhatsAppProvider as ProviderKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { NumbersService } from './numbers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PlanLimitGuard, RequireLimit } from '../billing/plan-limit.guard';

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

@Controller('numbers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NumbersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly numbers: NumbersService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.whatsAppNumber.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, phone: true, label: true, provider: true, status: true, isActive: true, createdAt: true },
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

  /** Reconecta (gera QR novo na Evolution, revalida token na Meta). */
  @Post(':id/connect')
  @Roles('tenant_admin', 'super_admin')
  async connect(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const n = await this.prisma.whatsAppNumber.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    const ctx = await this.numbers.context(n.id);
    return this.numbers.switchProvider(n.id, n.provider, ctx.config as any);
  }
}
