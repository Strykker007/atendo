import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../../config/env';
import { AsaasService, type AsaasBillingType } from './asaas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class CustomerDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  /** CPF ou CNPJ, com ou sem máscara — o Asaas exige para emitir cobrança */
  @Matches(/^[\d.\-/ ]{11,20}$/, { message: 'CPF/CNPJ inválido' }) cpfCnpj: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(20) mobilePhone?: string;
}

class CardDto {
  @IsString() @MaxLength(80) holderName: string;
  @Matches(/^[\d ]{13,23}$/, { message: 'Número do cartão inválido' }) number: string;
  @Matches(/^(0?[1-9]|1[0-2])$/, { message: 'Mês inválido' }) expiryMonth: string;
  @Matches(/^\d{4}$/, { message: 'Ano inválido (use 4 dígitos)' }) expiryYear: string;
  @Matches(/^\d{3,4}$/, { message: 'CVV inválido' }) ccv: string;
}

class HolderDto {
  @IsString() @MaxLength(120) name: string;
  @IsEmail() email: string;
  @Matches(/^[\d.\-/ ]{11,20}$/, { message: 'CPF/CNPJ do titular inválido' }) cpfCnpj: string;
  @Matches(/^[\d-]{8,9}$/, { message: 'CEP inválido' }) postalCode: string;
  @IsString() @Length(1, 10) addressNumber: string;
  @IsString() @MaxLength(20) phone: string;
}

class AsaasCheckoutDto {
  @IsUUID() planId: string;
  @IsIn(['PIX', 'CREDIT_CARD']) billingType: AsaasBillingType;
  @ValidateNested() @Type(() => CustomerDto) customer: CustomerDto;
  @IsOptional() @ValidateNested() @Type(() => CardDto) card?: CardDto;
  @IsOptional() @ValidateNested() @Type(() => HolderDto) holder?: HolderDto;
}

/** Checkout e cobranças do Asaas (PIX + cartão) para o admin do tenant. */
@Controller('billing/asaas')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('billing.manage')
export class AsaasController {
  constructor(private readonly asaas: AsaasService) {}

  @Get('customer')
  customer(@CurrentUser() user: AuthUser) {
    return this.asaas.customerOf(user.tenantId);
  }

  /** Assina (ou troca de plano/forma de pagamento) e devolve a cobrança a pagar, com o PIX. */
  @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: AsaasCheckoutDto, @Req() req: Request) {
    return this.asaas.checkout(user.tenantId, { ...dto, remoteIp: req.ip ?? '0.0.0.0' });
  }

  /** Cobrança em aberto (renovação/atraso), para pagar sem refazer o checkout. */
  @Get('pending')
  pending(@CurrentUser() user: AuthUser) {
    return this.asaas.pendingPayment(user.tenantId);
  }

  /** Polling do modal: `pix=1` traz o QR; sem ele só a situação. */
  @Get('payments/:id')
  payment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('pix') pix?: string) {
    return this.asaas.paymentStatus(user.tenantId, id, pix === '1');
  }
}

/**
 * Webhook do Asaas. Autenticado pelo token cadastrado no painel (header `asaas-access-token`).
 * Responde 200 rápido: o Asaas pausa a fila de webhooks depois de falhas seguidas.
 */
@SkipThrottle()
@Controller('webhooks')
export class AsaasWebhookController {
  constructor(private readonly asaas: AsaasService) {}

  @Post('asaas')
  @HttpCode(200)
  async handle(@Body() body: Parameters<AsaasService['handle']>[0], @Headers('asaas-access-token') token?: string) {
    if (!env.ASAAS_WEBHOOK_TOKEN) throw new ServiceUnavailableException('ASAAS_WEBHOOK_TOKEN ausente');
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(env.ASAAS_WEBHOOK_TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('token inválido');
    await this.asaas.handle(body ?? {});
    return { received: true };
  }
}
