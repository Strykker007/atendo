import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ActivationService, type ActivationItemKind } from './activation.service';

class ActivationItemDto {
  @IsString() @MaxLength(120) description: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) value: number;
  /** setup = instalação; first_month = 1ª mensalidade; other = treinamento, número extra… */
  @IsIn(['setup', 'first_month', 'other']) kind: ActivationItemKind;
}

class CreateActivationDto {
  @ValidateNested({ each: true }) @Type(() => ActivationItemDto) @ArrayMinSize(1) @ArrayMaxSize(20) items: ActivationItemDto[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) discount?: number;
  /** `AAAA-MM-DD` (Brasília); ausente = hoje */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  /** CPF/CNPJ do cliente, se ainda não estiver no cadastro — vai para o cadastro */
  @IsOptional() @IsString() @MaxLength(20) document?: string;
}

/** Cobrança de ativação — só o dono do sistema (docs/05-planos-e-cobranca.md#cobrança-de-ativação). */
@Controller('billing/activation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivationController {
  constructor(private readonly activation: ActivationService) {}

  @Get(':tenantId')
  @NoTenantOk()
  @Roles('super_admin')
  get(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.activation.get(tenantId);
  }

  @Post(':tenantId')
  @NoTenantOk()
  @Roles('super_admin')
  create(@CurrentUser() u: AuthUser, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CreateActivationDto) {
    return this.activation.create(tenantId, u.id, dto);
  }

  @Post(':tenantId/:id/cancel')
  @HttpCode(200)
  @NoTenantOk()
  @Roles('super_admin')
  cancel(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.activation.cancel(tenantId, id);
  }

  @Post(':tenantId/:id/paid')
  @HttpCode(200)
  @NoTenantOk()
  @Roles('super_admin')
  markPaid(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.activation.markPaid(tenantId, id);
  }
}
