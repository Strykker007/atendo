import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { FINANCE_FREQUENCIES, FINANCE_PAYMENT_METHODS, FINANCE_SECTIONS, FINANCE_TAX_BASES } from '@atendo/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FinanceClosingService } from './finance-closing.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** categoria = id de `finance_categories` (as de fábrica têm id legível: `das`, `infra`…) */
const CATEGORY = /^[a-z0-9_-]{2,40}$/i;
const NULLABLE = (_: unknown, v: unknown) => v !== null;

class EntryDto {
  @Matches(CATEGORY) category: string;
  @IsString() @MinLength(1) @MaxLength(160) description: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) amount: number;
  /** vencimento (saída) ou dia do recebimento (entrada) */
  @Matches(DATE) date: string;
  /** competência; padrão = mês do `date` */
  @IsOptional() @Matches(PERIOD) period?: string;
  @IsOptional() @ValidateIf(NULLABLE) @Matches(DATE) paidAt?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsIn(FINANCE_PAYMENT_METHODS) paymentMethod?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(80) documentNumber?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() supplierId?: string | null;
  /** entrada recebida de um cliente do sistema */
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() tenantId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(60) installments?: number;
}
class UpdateEntryDto {
  @IsOptional() @Matches(CATEGORY) category?: string;
  @IsOptional() @IsString() @MaxLength(160) description?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) amount?: number;
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @Matches(PERIOD) period?: string;
  @IsOptional() @ValidateIf(NULLABLE) @Matches(DATE) paidAt?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsIn(FINANCE_PAYMENT_METHODS) paymentMethod?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(80) documentNumber?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() supplierId?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() tenantId?: string | null;
  /** fixo/imposto que não houve no mês */
  @IsOptional() @IsBoolean() skipped?: boolean;
}
class PayDto {
  /** dia do pagamento; null desfaz a baixa */
  @IsOptional() @ValidateIf(NULLABLE) @Matches(DATE) date?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) amount?: number;
  @IsOptional() @ValidateIf(NULLABLE) @IsIn(FINANCE_PAYMENT_METHODS) paymentMethod?: string | null;
}
class CategoryDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsIn(FINANCE_SECTIONS) section: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class SupplierDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(20) document?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(120) pixKey?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class TaxRuleDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @Matches(CATEGORY) categoryId: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100) percent: number;
  @IsOptional() @IsIn(FINANCE_TAX_BASES) base?: string;
  @IsOptional() @IsInt() @Min(1) @Max(31) dueDay?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Matches(PERIOD) startPeriod?: string;
}
class ReceiveDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) amount?: number;
  @IsOptional() @Matches(DATE) date?: string;
}
class PartnerDto {
  /** sem conta vinculada; com `userId`, o nome vem da conta */
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  /** conta do sócio no sistema (dono do sistema) */
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() userId?: string | null;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) sharePercent: number;
  @IsOptional() @IsString() @MaxLength(120) pixKey?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class RecurringDto {
  @Matches(CATEGORY) category: string;
  @IsString() @MinLength(1) @MaxLength(160) description: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) amount: number;
  /** 29–31 em mês curto cai no último dia */
  @IsOptional() @IsInt() @Min(1) @Max(31) dayOfMonth?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Matches(PERIOD) startPeriod?: string;
  @IsOptional() @ValidateIf(NULLABLE) @Matches(PERIOD) endPeriod?: string | null;
  @IsOptional() @IsIn(FINANCE_FREQUENCIES) frequency?: string;
  @IsOptional() @IsBoolean() autoPaid?: boolean;
  @IsOptional() @ValidateIf(NULLABLE) @IsIn(FINANCE_PAYMENT_METHODS) paymentMethod?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() supplierId?: string | null;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(1000) notes?: string | null;
}
class SettingsDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) reservePercent?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-10_000_000) @Max(10_000_000) openingBalance?: number;
  @IsOptional() @Matches(DATE) openingDate?: string | null;
}
class CloseDto {
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
class PayoutDto {
  @IsBoolean() paid: boolean;
  /** dia em que o sócio recebeu; sem ele, hoje */
  @IsOptional() @Matches(DATE) date?: string;
}

/** Fechamento financeiro — só o dono do sistema (docs/36-fechamento-financeiro.md). */
@Controller('billing/closing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class FinanceClosingController {
  constructor(private readonly closing: FinanceClosingService) {}

  @Get('month/:period') @NoTenantOk()
  month(@Param('period') period: string) { return this.closing.month(period); }

  @Post('month/:period/close') @HttpCode(200) @NoTenantOk()
  close(@CurrentUser() u: AuthUser, @Param('period') period: string, @Body() dto: CloseDto) { return this.closing.close(period, u.id, dto.notes); }

  @Post('month/:period/reopen') @HttpCode(200) @NoTenantOk()
  reopen(@Param('period') period: string) { return this.closing.reopen(period); }

  @Put('month/:period/payouts/:partnerId') @NoTenantOk()
  payout(@Param('period') period: string, @Param('partnerId', ParseUUIDPipe) partnerId: string, @Body() dto: PayoutDto) { return this.closing.markPayout(period, partnerId, dto.paid, dto.date); }

  @Get('overdue') @NoTenantOk()
  overdue() { return this.closing.overdue(); }

  @Post('receive/:tenantId') @HttpCode(200) @NoTenantOk()
  receive(@CurrentUser() u: AuthUser, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: ReceiveDto) { return this.closing.receive(tenantId, u.id, dto); }

  @Post('entries') @NoTenantOk()
  createEntry(@CurrentUser() u: AuthUser, @Body() dto: EntryDto) { return this.closing.createEntry(u.id, dto); }

  @Patch('entries/:id') @NoTenantOk()
  updateEntry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEntryDto) { return this.closing.updateEntry(id, dto); }

  /** `?all=1` numa parcela: apaga também as seguintes em aberto */
  @Delete('entries/:id') @NoTenantOk()
  deleteEntry(@Param('id', ParseUUIDPipe) id: string, @Query('all') all?: string) { return this.closing.deleteEntry(id, all === '1'); }

  @Post('entries/:id/pay') @HttpCode(200) @NoTenantOk()
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) { return this.closing.pay(id, dto); }

  @Get('payables') @NoTenantOk()
  payables() { return this.closing.payables(); }

  @Post('categories') @NoTenantOk()
  createCategory(@Body() dto: CategoryDto) { return this.closing.saveCategory(null, dto); }

  @Put('categories/:id') @NoTenantOk()
  updateCategory(@Param('id') id: string, @Body() dto: CategoryDto) { return this.closing.saveCategory(id, dto); }

  @Delete('categories/:id') @NoTenantOk()
  deleteCategory(@Param('id') id: string) { return this.closing.deleteCategory(id); }

  @Post('suppliers') @NoTenantOk()
  createSupplier(@Body() dto: SupplierDto) { return this.closing.saveSupplier(null, dto); }

  @Put('suppliers/:id') @NoTenantOk()
  updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierDto) { return this.closing.saveSupplier(id, dto); }

  @Delete('suppliers/:id') @NoTenantOk()
  deleteSupplier(@Param('id', ParseUUIDPipe) id: string) { return this.closing.deleteSupplier(id); }

  @Post('tax-rules') @NoTenantOk()
  createTaxRule(@Body() dto: TaxRuleDto) { return this.closing.saveTaxRule(null, dto); }

  @Put('tax-rules/:id') @NoTenantOk()
  updateTaxRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TaxRuleDto) { return this.closing.saveTaxRule(id, dto); }

  @Delete('tax-rules/:id') @NoTenantOk()
  deleteTaxRule(@Param('id', ParseUUIDPipe) id: string) { return this.closing.deleteTaxRule(id); }

  @Get('config') @NoTenantOk()
  config() { return this.closing.config(); }

  @Put('settings') @NoTenantOk()
  settings(@Body() dto: SettingsDto) { return this.closing.saveSettings(dto); }

  @Post('partners') @NoTenantOk()
  createPartner(@Body() dto: PartnerDto) { return this.closing.savePartner(null, dto); }

  @Put('partners/:id') @NoTenantOk()
  updatePartner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PartnerDto) { return this.closing.savePartner(id, dto); }

  @Post('recurring') @NoTenantOk()
  createRecurring(@Body() dto: RecurringDto) { return this.closing.saveRecurring(null, dto); }

  @Put('recurring/:id') @NoTenantOk()
  updateRecurring(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecurringDto) { return this.closing.saveRecurring(id, dto); }

  @Delete('recurring/:id') @NoTenantOk()
  deleteRecurring(@Param('id', ParseUUIDPipe) id: string) { return this.closing.deleteRecurring(id); }
}
