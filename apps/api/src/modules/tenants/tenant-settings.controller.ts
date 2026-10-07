import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { QUICK_REPLY_DELAY_MAX_SEC, type ScheduleConfig, type WelcomeMessage, type WelcomeMode } from '@atendo/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { assertOwnMedia, contentItemErrors } from '../flows/flow-validation';
import { TenantSettingsService } from './tenant-settings.service';
import { SchedulesService } from './schedules.service';

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
  @IsOptional() @IsUUID() noneFlowId?: string | null;
  @IsOptional() @IsUUID() defaultFlowId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(720) defaultFlowInactivityHours?: number;
  /** boas-vindas: cada uma é uma lista de mensagens no formato do Conteúdo */
  @IsOptional() @IsArray() @ArrayMaxSize(20) welcomeMessages?: WelcomeMessage[];
  @IsOptional() @IsIn(['random', 'sequential']) welcomeMode?: WelcomeMode;
  @IsOptional() @IsBoolean() welcomeEnabled?: boolean;
  /** respostas rápidas: segundos entre escolher e enviar (contagem com Cancelar); 0 = na hora */
  @IsOptional() @IsInt() @Min(0) @Max(QUICK_REPLY_DELAY_MAX_SEC) quickReplyDelaySec?: number;
  /** motivos de perda sugeridos no encerramento */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(200, { each: true }) lossReasons?: string[];
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
  ) {}

  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const [s, now] = await Promise.all([this.settings.get(u.tenantId), this.schedules.now(u.tenantId)]);
    return { ...s, isOpenNow: now.open, currentBand: now.band.name, nextOpenLabel: now.nextOpenLabel };
  }

  @Patch()
  @RequirePermission('settings.manage')
  update(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) {
    if (dto.timezone && !isTimezone(dto.timezone)) throw new BadRequestException('Fuso horário inválido.');
    // sem vazio e sem repetido (ignorando maiúsculas): repetido viraria duas barras iguais no relatório
    if (dto.lossReasons) dto.lossReasons = dto.lossReasons.map((m) => m.trim()).filter((m, i, l) => m && l.findIndex((x) => x.toLowerCase() === m.toLowerCase()) === i);
    if (dto.welcomeMessages) {
      const errors = dto.welcomeMessages.flatMap((w, i) => {
        if (!w || typeof w.id !== 'string' || !Array.isArray(w.items) || !w.items.length) return [`Boas-vindas ${i + 1}: adicione ao menos uma mensagem.`];
        assertOwnMedia(u.tenantId, w.items, `Boas-vindas ${i + 1}`);
        return contentItemErrors(w.items, `Boas-vindas ${i + 1}`);
      });
      if (errors.length) throw new BadRequestException(errors.join(' '));
    }
    return this.settings.update(u.tenantId, dto);
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
