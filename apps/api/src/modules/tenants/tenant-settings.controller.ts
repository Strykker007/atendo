import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { type ScheduleConfig, type WelcomeMessage, type WelcomeMode } from '@atendo/shared';
import { StorageService } from '../../common/storage/storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsService } from '../auth/permissions.service';
import { assertOwnMedia, contentItemErrors } from '../flows/flow-validation';
import { TenantSettingsService } from './tenant-settings.service';
import { SchedulesService } from './schedules.service';
import { DEFAULT_DEPARTMENT_TRANSFER_TEXT, DEFAULT_TRANSFER_TEXT } from '../conversations/transfer-message';
import { DEFAULT_CLOSE_TEXT } from '../conversations/close-message';

const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

class SettingsDto {
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsBoolean() attendanceActive?: boolean;
  // fluxos padrão: null limpa a configuração
  @IsOptional() @IsUUID() welcomeFlowId?: string | null;
  @IsOptional() @IsUUID() closedFlowId?: string | null;
  /** disparado quando o atendente encerra */
  @IsOptional() @IsUUID() onCloseFlowId?: string | null;
  /** padrão por desfecho do encerramento; pré-seleciona no modal e ganha de `onCloseFlowId` */
  @IsOptional() @IsUUID() wonFlowId?: string | null;
  @IsOptional() @IsUUID() lostFlowId?: string | null;
  /** "Comprou" exige valor */
  @IsOptional() @IsBoolean() requireSaleValue?: boolean;
  /** encerramento com venda (valor/itens); desligado = só resultado, motivo e tags */
  @IsOptional() @IsBoolean() salesEnabled?: boolean;
  /** separar também equipe, planilha de contatos e transmissões por empresa — só o admin da conta */
  @IsOptional() @IsBoolean() companyIsolation?: boolean;
  /** assinatura do atendente obrigatória nas mensagens */
  @IsOptional() @IsBoolean() requireSignature?: boolean;
  /** motivo de encerramento obrigatório em "Comprou" / "Não comprou" (cada um separado) */
  @IsOptional() @IsBoolean() requireReasonOnWon?: boolean;
  @IsOptional() @IsBoolean() requireReasonOnLost?: boolean;
  /** pesos da pontuação do ranking (0–100 cada); normalizados no serviço. `null` = padrão */
  @IsOptional() @IsObject() rankingWeights?: Record<string, number> | null;
  /** nome dos resultados do encerramento ("Fechou venda", "Perdido"…) — vazio volta ao padrão */
  @IsOptional() @IsString() @MaxLength(30) wonLabel?: string;
  @IsOptional() @IsString() @MaxLength(30) lostLabel?: string;
  @IsOptional() @IsUUID() defaultFlowId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(720) defaultFlowInactivityHours?: number;
  /** boas-vindas: cada uma é uma lista de mensagens no formato do Conteúdo */
  @IsOptional() @IsArray() @ArrayMaxSize(20) welcomeMessages?: WelcomeMessage[];
  @IsOptional() @IsIn(['random', 'sequential']) welcomeMode?: WelcomeMode;
  @IsOptional() @IsBoolean() welcomeEnabled?: boolean;
  /** frase da foto protegida; sem {{link}}, ele é acrescentado no final; vazio/null = a padrão */
  @IsOptional() @IsString() @MaxLength(500) secureMediaText?: string | null;
  /** logo das páginas públicas: chave do upload do painel; null = a marca do painel */
  @IsOptional() @IsString() @MaxLength(300) publicLogoKey?: string | null;
  /** mensagem ao cliente na transferência; textos vazios/null = os padrões (transfer-message.ts) */
  @IsOptional() @IsBoolean() transferMessageEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) transferMessageText?: string | null;
  @IsOptional() @IsString() @MaxLength(500) departmentTransferMessageText?: string | null;
  /** aviso ao cliente quando o atendente encerra; texto vazio/null = o padrão (close-message.ts) */
  @IsOptional() @IsBoolean() closeMessageEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) closeMessageText?: string | null;
}
class ScheduleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  /** ScheduleConfig — validado por `validateSchedule` (shared) no serviço */
  @IsOptional() @IsObject() config?: ScheduleConfig;
}
class CreateScheduleDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsObject() config?: ScheduleConfig;
  /** começa como cópia de outro quadro */
  @IsOptional() @IsUUID() copyFromId?: string;
}
class NumberScheduleDto {
  /** null = volta para o quadro padrão */
  @IsOptional() @IsUUID() scheduleId?: string | null;
}

/** Configurações do cliente: fuso, chave de atendimento ativo, fluxos padrão, boas-vindas e quadros de horários. */
@Controller('settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard)
export class TenantSettingsController {
  constructor(
    private readonly settings: TenantSettingsService,
    private readonly schedules: SchedulesService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const [s, now] = await Promise.all([this.settings.get(u.tenantId), this.schedules.now(u.tenantId)]);
    return { ...s, publicLogoUrl: s.publicLogoKey ? this.storage.signedUrl(s.publicLogoKey) : null, isOpenNow: now.open, currentBand: now.band.name, nextOpenLabel: now.nextOpenLabel, transferDefaults: { agent: DEFAULT_TRANSFER_TEXT, department: DEFAULT_DEPARTMENT_TRANSFER_TEXT }, closeDefault: DEFAULT_CLOSE_TEXT };
  }

  @Patch()
  @RequirePermission('settings.manage')
  async update(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) {
    // quem configura (gerente de contrato, gerente de filial) não pode desligar a própria restrição
    if (dto.companyIsolation !== undefined && u.role !== 'tenant_admin' && u.role !== 'super_admin' && !u.impersonatorId) {
      throw new ForbiddenException('Só o administrador da conta muda a separação por empresa.');
    }
    if (dto.timezone && !isTimezone(dto.timezone)) throw new BadRequestException('Fuso horário inválido.');
    // sem {{link}} o contato receberia a frase e nenhum jeito de abrir a foto: o link vai no final
    const frase = dto.secureMediaText?.trim();
    if (frase && !/\{\{\s*link\s*\}\}/.test(frase)) dto.secureMediaText = `${frase} {{link}}`;
    // a logo vai numa página aberta: só arquivo deste cliente
    if (dto.publicLogoKey && !dto.publicLogoKey.startsWith(`media/${u.tenantId}/`)) throw new BadRequestException('Imagem inválida.');
    if (dto.welcomeMessages) {
      const errors = dto.welcomeMessages.flatMap((w, i) => {
        if (!w || typeof w.id !== 'string' || !Array.isArray(w.items) || !w.items.length) return [`Boas-vindas ${i + 1}: adicione ao menos uma mensagem.`];
        assertOwnMedia(u.tenantId, w.items, `Boas-vindas ${i + 1}`);
        return contentItemErrors(w.items, `Boas-vindas ${i + 1}`);
      });
      if (errors.length) throw new BadRequestException(errors.join(' '));
    }
    const saved = await this.settings.update(u.tenantId, dto);
    // o guard lê a separação do cache de empresas: sem isto valeria só em 15 s
    if (dto.companyIsolation !== undefined) this.permissions.invalidate();
    return saved;
  }

  // ---------- quadros de horários ----------

  @Get('schedules')
  listSchedules(@CurrentUser() u: AuthUser) {
    return this.schedules.list(u.tenantId);
  }

  @Post('schedules')
  @RequirePermission('settings.manage')
  createSchedule(@CurrentUser() u: AuthUser, @Body() dto: CreateScheduleDto) {
    if (dto.timezone && !isTimezone(dto.timezone)) throw new BadRequestException('Fuso horário inválido.');
    return this.schedules.create(u.tenantId, dto);
  }

  @Put('schedules/:id')
  @RequirePermission('settings.manage')
  updateSchedule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ScheduleDto) {
    if (dto.timezone && !isTimezone(dto.timezone)) throw new BadRequestException('Fuso horário inválido.');
    return this.schedules.update(u.tenantId, id, dto);
  }

  @Delete('schedules/:id')
  @RequirePermission('settings.manage')
  removeSchedule(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.schedules.remove(u.tenantId, id);
  }

  @Post('schedules/:id/default')
  @RequirePermission('settings.manage')
  setDefaultSchedule(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.schedules.setDefault(u.tenantId, id);
  }

  /** Quadro próprio de um número (conexão). */
  @Put('numbers/:numberId/schedule')
  @RequirePermission('settings.manage')
  setNumberSchedule(@CurrentUser() u: AuthUser, @Param('numberId') numberId: string, @Body() dto: NumberScheduleDto) {
    return this.schedules.setNumberSchedule(u.tenantId, numberId, dto.scheduleId ?? null);
  }
}
