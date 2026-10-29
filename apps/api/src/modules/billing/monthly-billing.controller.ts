import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { env } from '../../config/env';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { MonthlyBillingService } from './monthly-billing.service';
import { qrSignatureOk } from './monthly-billing';

class EnrollDto {
  /** só a prévia: quem entraria, com que valor e vencimento, e quem fica de fora e por quê */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

class DocumentDto {
  @IsString() @MaxLength(20) cpfCnpj: string;
}

/** Mensalidade por Pix no Asaas (docs/05-planos-e-cobranca.md#migração-para-o-asaas). */
@Controller('billing/monthly')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class MonthlyBillingController {
  constructor(private readonly monthly: MonthlyBillingService) {}

  /** Dono do sistema: migra para o Asaas quem paga sem gateway. Comece com `dryRun: true`. */
  @Post('enroll')
  @HttpCode(200)
  @NoTenantOk()
  @Roles('super_admin')
  enroll(@Body() dto: EnrollDto) {
    return this.monthly.enrollAll({ dryRun: dto.dryRun ?? true });
  }

  /** Admin do cliente: informa o CPF/CNPJ pelo aviso do painel e entra na cobrança automática. */
  @Post('document')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  document(@CurrentUser() u: AuthUser, @Body() dto: DocumentDto) {
    return this.monthly.setDocumentAndEnroll(u.tenantId, dto.cpfCnpj);
  }
}

/**
 * QR Pix do e-mail de lembrete. Público (o e-mail não tem sessão), mas a URL é assinada por
 * cobrança: sem a assinatura certa é 404, e o id da cobrança sozinho não abre nada.
 */
@Controller('billing/pix')
export class PixQrController {
  constructor(private readonly monthly: MonthlyBillingService) {}

  @Get(':paymentId/qr.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'private, max-age=86400')
  async qr(@Param('paymentId') paymentId: string, @Query('s') sig?: string) {
    if (!qrSignatureOk(env.ENCRYPTION_KEY, paymentId, sig)) throw new NotFoundException();
    const png = await this.monthly.qrPng(paymentId).catch(() => null);
    if (!png) throw new NotFoundException();
    return new StreamableFile(png);
  }
}
