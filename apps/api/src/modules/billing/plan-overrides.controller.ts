import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PLAN_FEATURES, type PlanFeature } from '@atendo/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PlanOverridesService } from './plan-overrides.service';

/** Espelha `PlanLimitsOverride` (packages/shared). Ausente = herda do plano; `null` = ilimitado. */
class OverrideLimitsDto {
  @IsOptional() @IsInt() @Min(0) @Max(1000) maxNumbers?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) maxAgents?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) maxFlows?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) maxQuickReplies?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) maxCompanies?: number | null;
  @IsOptional() @IsInt() @Min(0) includedMessagesMonth?: number | null;
  @IsOptional() @IsInt() @Min(0) includedConversationsMonth?: number | null;
  @IsOptional() @IsInt() @Min(0) includedTemplatesMonth?: number | null;
  @IsOptional() @IsInt() @Min(0) includedAiInteractionsMonth?: number | null;
  /** substitui a lista de funcionalidades do plano inteira */
  @IsOptional() @IsArray() @IsIn(PLAN_FEATURES, { each: true }) features?: PlanFeature[];
}

class PlanOverrideDto {
  /** mensalidade negociada; null = preço do plano */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99_999) priceMonth?: number | null;
  @IsOptional() @ValidateNested() @Type(() => OverrideLimitsDto) limits?: OverrideLimitsDto;
  /** último dia de vigência (`AAAA-MM-DD`); null = enquanto durar a assinatura neste plano */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresAt?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

class ApplyPromotionDto {
  @IsUUID() promotionId: string;
}

/** Personalização do plano por cliente — só o dono (docs/05-planos-e-cobranca.md#personalização-por-cliente). */
@Controller('billing/overrides')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlanOverridesController {
  constructor(private readonly overrides: PlanOverridesService) {}

  @Get(':tenantId')
  @NoTenantOk()
  @Roles('super_admin')
  get(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.overrides.get(tenantId);
  }

  @Put(':tenantId')
  @NoTenantOk()
  @Roles('super_admin')
  async save(@CurrentUser() user: AuthUser, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: PlanOverrideDto) {
    await this.overrides.save(tenantId, dto, user);
    return this.overrides.get(tenantId);
  }

  /** Aplica uma promoção só a este cliente (exceção do dono: vale fora da janela e do plano da promoção). */
  @Post(':tenantId/promotion')
  @NoTenantOk()
  @Roles('super_admin')
  async applyPromotion(@CurrentUser() user: AuthUser, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: ApplyPromotionDto) {
    await this.overrides.applyPromotion(tenantId, dto.promotionId, 'manual', user);
    return this.overrides.get(tenantId);
  }

  @Delete(':tenantId')
  @NoTenantOk()
  @Roles('super_admin')
  remove(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.overrides.remove(tenantId);
  }
}
