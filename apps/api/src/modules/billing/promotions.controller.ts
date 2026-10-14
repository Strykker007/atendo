import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { PromotionsService } from './promotions.service';
import { PlanOverridesService } from './plan-overrides.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class PromotionDto {
  @IsString() @MinLength(2) @MaxLength(60) name: string;
  /** até 99%: mensalidade zerada é plano gratuito, não promoção */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99) discountPercent: number;
  @IsInt() @Min(1) @Max(60) durationMonths: number;
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) planIds: string[];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startsAt?: string | null;
  /** último dia para assinar com a promoção */
  @Matches(/^\d{4}-\d{2}-\d{2}$/) endsAt: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Promoções de entrada — só o dono (docs/05-planos-e-cobranca.md#promoções). */
@Controller('billing/promotions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromotionsController {
  constructor(
    private readonly promotions: PromotionsService,
    private readonly overrides: PlanOverridesService,
  ) {}

  @Get()
  @NoTenantOk()
  @Roles('super_admin')
  list() {
    return this.promotions.list();
  }

  @Post()
  @NoTenantOk()
  @Roles('super_admin')
  create(@Body() dto: PromotionDto) {
    return this.promotions.create(dto);
  }

  @Patch(':id')
  @NoTenantOk()
  @Roles('super_admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PromotionDto) {
    return this.promotions.update(id, dto);
  }

  /** Aplica a todos os clientes que assinam hoje um dos planos da promoção → `{applied, skipped[{tenant, reason}]}`. */
  @Post(':id/apply-all')
  @NoTenantOk()
  @Roles('super_admin')
  applyAll(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.overrides.applyPromotionToAll(id, user);
  }

  @Delete(':id')
  @NoTenantOk()
  @Roles('super_admin')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.promotions.remove(id);
  }
}
