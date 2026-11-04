import { Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PAYOUT_PIX_KEY_TYPES, type PartnerCommissionKind, type PayoutPixKeyType } from '@atendo/shared';
import { env } from '../../config/env';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk, PartnerOk } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PartnersService } from './partners.service';
import { PartnerPayoutsService } from './partner-payouts.service';
import { PartnerPortalService } from './partner-portal.service';
import { PayoutSecurityService, actorOf } from './payout-security.service';

// ---------- DTOs ----------

class LoginDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsEmail() @MaxLength(120) email: string;
}
class PartnerDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(20) document?: string | null;
  @IsOptional() @IsString() @MaxLength(120) email?: string | null;
  @IsOptional() @IsString() @MaxLength(20) phone?: string | null;
  /** % da instalação só deste parceiro; null = padrão do programa */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) setupRate?: number | null;
  @IsOptional() @IsIn(['active', 'suspended', 'ended']) status?: 'active' | 'suspended' | 'ended';
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}
class CreatePartnerDto extends PartnerDto {
  // obrigatório aqui (opcional no PartnerDto); o '' inicial falha no MinLength se não vier no body
  @IsString() @MinLength(1) @MaxLength(120) override name = '';
  @IsOptional() @ValidateNested() @Type(() => LoginDto) login?: LoginDto;
}
class CodeDto {
  /** código de 6 dígitos do app autenticador */
  @Matches(/^\d{6}$/, { message: 'Código do autenticador: 6 dígitos.' }) code: string;
}
class PixKeyDto extends CodeDto {
  @IsString() @MinLength(3) @MaxLength(120) pixKey: string;
  @IsIn(PAYOUT_PIX_KEY_TYPES) pixKeyType: PayoutPixKeyType;
}
class TierDto {
  @IsInt() @Min(0) @Max(1_000_000) minClients: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) rate: number;
}
class TiersDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => TierDto) tiers: TierDto[];
}
class TenantPartnerDto {
  @IsOptional() @IsUUID() partnerId: string | null;
}
class LoginActiveDto {
  @IsBoolean() isActive: boolean;
}
class SettingsDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) setupRate?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) setupFee?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) minPayout?: number;
  @IsOptional() @IsInt() @Min(0) @Max(720) pixKeyCooldownHours?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) secondApprovalAbove?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) dailyLimit?: number | null;
  @IsOptional() @Matches(/^\d{6}$/) code?: string;
}
class PasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}
class DisableTotpDto extends CodeDto {
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}
class ApurarDto {
  @IsIn(['recurring', 'setup']) kind: PartnerCommissionKind;
  /** `AAAA-MM` (mensalidades) ou `AAAA-Wss` (instalações); ausente = último ciclo terminado */
  @IsOptional() @IsString() @MaxLength(10) period?: string;
}
class ApproveDto extends CodeDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('4', { each: true }) ids: string[];
}
class RetryDto extends CodeDto {
  @IsOptional() @IsBoolean() confirmNotSent?: boolean;
}
class ManualPaidDto extends CodeDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}
class NewClientDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @Matches(/^[a-z0-9-]{3,40}$/, { message: 'Identificador: 3 a 40 letras minúsculas, números ou hífen.' }) slug: string;
  @IsUUID() planId: string;
  @IsEmail() adminEmail: string;
  @IsString() @MinLength(1) @MaxLength(80) adminName: string;
  /** Modelo de perfil (Farmácia, Clínica…); ausente = o padrão; null = nenhum */
  @IsOptional() @IsUUID() templateId?: string | null;
}
class ActivationDto {
  @IsOptional() @IsString() @MaxLength(20) document?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
}

// ---------- dono do sistema ----------

/** Cadastro de parceiros (docs/37-vogopartners.md). Só o dono do sistema. */
@Controller('partners')
@UseGuards(JwtAuthGuard, RolesGuard)
@NoTenantOk()
@Roles('super_admin')
export class PartnersAdminController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  list() {
    return this.partners.list();
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePartnerDto) {
    return this.partners.create(dto, actorOf(u));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.partners.get(id);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PartnerDto) {
    return this.partners.update(id, dto, actorOf(u));
  }

  @Put(':id/pix-key')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  pixKey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PixKeyDto, @Req() req: Request) {
    return this.partners.setPixKey(id, dto, actorOf(u), req.ip);
  }

  /** Faixas próprias; lista vazia = volta às padrão do programa. */
  @Put(':id/tiers')
  tiers(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TiersDto) {
    return this.partners.setTiers(id, dto.tiers, actorOf(u));
  }

  @Post(':id/logins')
  addLogin(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LoginDto) {
    return this.partners.addLogin(id, dto, actorOf(u));
  }

  @Post(':id/logins/:userId/invite-link')
  @HttpCode(200)
  inviteLink(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.partners.loginInviteLink(id, userId);
  }

  @Patch(':id/logins/:userId')
  loginActive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: LoginActiveDto) {
    return this.partners.setLoginActive(id, userId, dto.isActive, actorOf(u));
  }
}

/** Programa: configuração, faixas padrão, vínculo de clientes, autenticador e auditoria. */
@Controller('partner-program')
@UseGuards(JwtAuthGuard, RolesGuard)
@NoTenantOk()
@Roles('super_admin')
export class PartnerProgramController {
  constructor(private readonly partners: PartnersService, private readonly security: PayoutSecurityService) {}

  @Get('settings')
  settings() {
    return this.partners.settingsView();
  }

  @Put('settings')
  updateSettings(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto, @Req() req: Request) {
    return this.partners.updateSettings(dto, actorOf(u), req.ip);
  }

  @Put('tiers')
  defaultTiers(@CurrentUser() u: AuthUser, @Body() dto: TiersDto) {
    return this.partners.setTiers(null, dto.tiers, actorOf(u));
  }

  @Get('tenants/unassigned')
  unassigned(@Query('q') q?: string) {
    return this.partners.unassignedTenants(q?.slice(0, 80));
  }

  @Put('tenants/:tenantId')
  setTenant(@CurrentUser() u: AuthUser, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: TenantPartnerDto) {
    return this.partners.setTenantPartner(tenantId, dto.partnerId ?? null, actorOf(u));
  }

  @Get('events')
  events() {
    return this.partners.events();
  }

  // ---- autenticador de quem autoriza pagamentos ----

  @Get('security/totp')
  totp(@CurrentUser() u: AuthUser) {
    return this.security.status(actorOf(u).id);
  }

  @Post('security/totp/setup')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  setup(@CurrentUser() u: AuthUser, @Body() dto: PasswordDto) {
    return this.security.setup(actorOf(u).id, dto.password);
  }

  @Post('security/totp/confirm')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  confirm(@CurrentUser() u: AuthUser, @Body() dto: CodeDto, @Req() req: Request) {
    return this.security.confirm(actorOf(u).id, dto.code, req.ip);
  }

  @Post('security/totp/disable')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  disable(@CurrentUser() u: AuthUser, @Body() dto: DisableTotpDto, @Req() req: Request) {
    return this.security.disable(actorOf(u).id, dto.password, dto.code, req.ip);
  }
}

/** Pagamentos aos parceiros: apurar, autorizar (com código), repetir, baixa manual, desfazer. */
@Controller('partner-payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@NoTenantOk()
@Roles('super_admin')
export class PartnerPayoutsController {
  constructor(private readonly payouts: PartnerPayoutsService) {}

  @Get()
  list(@Query('status') status?: string, @Query('kind') kind?: string, @Query('partnerId') partnerId?: string) {
    return this.payouts.list({ status, kind, partnerId });
  }

  @Post('apurar')
  @HttpCode(200)
  apurar(@CurrentUser() u: AuthUser, @Body() dto: ApurarDto) {
    return this.payouts.apurar(dto.kind, dto.period, actorOf(u));
  }

  @Post('approve')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  approve(@CurrentUser() u: AuthUser, @Body() dto: ApproveDto, @Req() req: Request) {
    return this.payouts.approve(dto.ids, dto.code, actorOf(u), req.ip);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.detail(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  retry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryDto, @Req() req: Request) {
    return this.payouts.retry(id, dto.code, !!dto.confirmNotSent, actorOf(u), req.ip);
  }

  @Post(':id/paid')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  paid(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualPaidDto, @Req() req: Request) {
    return this.payouts.markPaidManual(id, dto.code, dto.date, actorOf(u), req.ip);
  }

  @Delete(':id')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.payouts.cancel(id, actorOf(u), req.ip);
  }
}

// ---------- portal do parceiro ----------

/** Portal do VogoPartner: só o parceiro logado, só os dados dele (`partnerId` do token). */
@Controller('partner')
@UseGuards(JwtAuthGuard, RolesGuard)
@NoTenantOk()
@PartnerOk()
@Roles('partner')
export class PartnerPortalController {
  constructor(private readonly portal: PartnerPortalService) {}

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.portal.me(u.partnerId);
  }

  @Get('clients')
  clients(@CurrentUser() u: AuthUser) {
    return this.portal.clients(u.partnerId);
  }

  @Post('clients')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  createClient(@CurrentUser() u: AuthUser, @Body() dto: NewClientDto) {
    return this.portal.createClient(u.partnerId, { id: u.id, name: u.name }, dto);
  }

  @Get('plans')
  plans(@CurrentUser() u: AuthUser) {
    return this.portal.plans(u.partnerId);
  }

  @Get('templates')
  templates(@CurrentUser() u: AuthUser) {
    return this.portal.templates(u.partnerId);
  }

  @Get('clients/:id/activation')
  activation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.getActivation(u.partnerId, id);
  }

  @Post('clients/:id/activation')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  createActivation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActivationDto) {
    return this.portal.createActivation(u.partnerId, { id: u.id, name: u.name }, id, dto);
  }

  @Get('statement')
  statement(@CurrentUser() u: AuthUser, @Query('kind') kind?: string) {
    return this.portal.statement(u.partnerId, kind === 'recurring' || kind === 'setup' ? kind : undefined);
  }
}

// ---------- Asaas: validação de saque ----------

/**
 * "Mecanismo de validação de saque" do Asaas (docs/37-vogopartners.md#segurança): o Asaas pergunta
 * aqui antes de cada transferência sair. Autenticado pelo token cadastrado lá.
 */
@SkipThrottle()
@Controller('webhooks/asaas')
export class AsaasTransferValidationController {
  constructor(private readonly payouts: PartnerPayoutsService) {}

  @Post('transfer-validation')
  @HttpCode(200)
  validate(@Body() body: Parameters<PartnerPayoutsService['validateTransfer']>[0], @Headers('asaas-access-token') token?: string) {
    if (!env.ASAAS_TRANSFER_VALIDATION_TOKEN) throw new ServiceUnavailableException('ASAAS_TRANSFER_VALIDATION_TOKEN ausente');
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(env.ASAAS_TRANSFER_VALIDATION_TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('token inválido');
    return this.payouts.validateTransfer(body ?? {});
  }
}
