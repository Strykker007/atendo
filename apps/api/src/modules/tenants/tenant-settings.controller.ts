import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { TenantSettingsService } from './tenant-settings.service';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

class HourDto {
  @IsInt() @Min(0) @Max(6) weekday: number;
  @Matches(HM, { message: 'horário deve ser HH:MM' }) start: string;
  @Matches(HM, { message: 'horário deve ser HH:MM' }) end: string;
}
class HoursDto {
  @IsArray() @ArrayMaxSize(42) @ValidateNested({ each: true }) @Type(() => HourDto) hours: HourDto[];
}
class SettingsDto {
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsBoolean() attendanceActive?: boolean;
  @IsOptional() @IsString() @MaxLength(600) outsideHoursText?: string;
}

/** Configurações do cliente: fuso, expediente e chave de atendimento ativo. */
@Controller('settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class TenantSettingsController {
  constructor(private readonly settings: TenantSettingsService) {}

  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const s = await this.settings.get(u.tenantId);
    return { ...s, isOpenNow: await this.settings.isOpen(u.tenantId), suggested: this.settings.suggested() };
  }

  @Patch()
  @Roles('tenant_admin', 'manager', 'super_admin')
  update(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) {
    return this.settings.update(u.tenantId, dto);
  }

  @Put('business-hours')
  @Roles('tenant_admin', 'manager', 'super_admin')
  setHours(@CurrentUser() u: AuthUser, @Body() dto: HoursDto) {
    return this.settings.setHours(u.tenantId, dto.hours);
  }
}
