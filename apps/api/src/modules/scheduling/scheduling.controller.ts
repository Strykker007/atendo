import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsHexColor, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { TemplateChoiceDto } from '../whatsapp/template.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { SchedulingService } from './scheduling.service';
import { normalizeReminderMinutes } from './slots';
import { deletionVerdict, type DeletionUsage } from './deletion';

class ProfessionalDto {
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @Matches(/^\+?[1-9]\d{7,14}$/) phone?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** [{weekday:1,start:"09:00",end:"18:00"}, …] — substitui todos */
  @IsOptional() @IsArray() hours?: { weekday: number; start: string; end: string }[];
}
/** Edição: todos opcionais, mas com validação (Partial<> desligaria o ValidationPipe). */
class UpdateProfessionalDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @Matches(/^(\+?[1-9]\d{7,14})?$/) phone?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() hours?: { weekday: number; start: string; end: string }[];
}
class ServiceDto {
  @IsString() @MaxLength(80) name: string;
  @IsInt() @Min(5) durationMin: number;
  @IsOptional() price?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateServiceDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(5) durationMin?: number;
  @IsOptional() price?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class SettingsDto {
  @IsOptional() @IsInt() @Min(5) slotMinutes?: number;
  /** minutos antes (a tela oferece "1 dia antes", "2 horas antes"…) */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsInt({ each: true }) @Min(1, { each: true }) clientReminderMinutes?: number[];
  @IsOptional() @IsInt() @Min(0) proReminderMinutes?: number;
  @IsOptional() @IsUUID() numberId?: string;
  @IsOptional() @IsInt() @Min(1) daysAhead?: number;
  /** template (Meta) do lembrete fora da janela de 24h; null = remover */
  @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => TemplateChoiceDto) reminderTemplate?: TemplateChoiceDto | null;
}
class CreateAppointmentDto {
  @IsUUID() professionalId: string;
  @IsUUID() serviceId: string;
  @IsUUID() contactId: string;
  @IsDateString() startAt: string;
  @IsOptional() @IsUUID() conversationId?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
class UpdateAppointmentDto {
  @IsOptional() @IsEnum(AppointmentStatus) status?: AppointmentStatus;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

/** Agendamento — funcionalidade plugável (`features: ['scheduling']`). */
@Controller('scheduling')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('scheduling')
export class SchedulingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
  ) {}

  // ----- preferências -----
  @Get('settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.scheduling.settings(u.tenantId);
  }
  @Patch('settings')
  @RequirePermission('agenda.manage')
  async updateSettings(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) {
    await this.scheduling.settings(u.tenantId);
    const { reminderTemplate, clientReminderMinutes, ...rest } = dto;
    // arquivo do cabeçalho do template: só do storage do próprio tenant
    if (reminderTemplate?.headerMediaKey && !reminderTemplate.headerMediaKey.startsWith(`media/${u.tenantId}/`)) throw new BadRequestException('Arquivo do cabeçalho inválido');
    const tpl = reminderTemplate === undefined ? {} : { reminderTemplate: reminderTemplate === null ? Prisma.DbNull : ({ ...reminderTemplate } as Prisma.InputJsonValue) };
    return this.prisma.schedulingSettings.update({ where: { tenantId: u.tenantId }, data: { ...rest, ...(clientReminderMinutes && { clientReminderMinutes: normalizeReminderMinutes(clientReminderMinutes) }), ...tpl } });
  }

  // ----- profissionais -----
  @Get('professionals')
  professionals(@CurrentUser() u: AuthUser) {
    return this.prisma.professional.findMany({ where: { tenantId: u.tenantId }, include: { hours: { orderBy: [{ weekday: 'asc' }, { start: 'asc' }] } }, orderBy: { name: 'asc' } });
  }
  @Post('professionals')
  @RequirePermission('agenda.manage')
  createProfessional(@CurrentUser() u: AuthUser, @Body() dto: ProfessionalDto) {
    const { hours, phone, ...rest } = dto;
    return this.prisma.professional.create({ data: { tenantId: u.tenantId, ...rest, phone: phone?.replace(/^\+/, '') || null, hours: { create: (hours ?? []).map((h) => ({ weekday: h.weekday, start: h.start, end: h.end })) } }, include: { hours: true } });
  }
  @Patch('professionals/:id')
  @RequirePermission('agenda.manage')
  async updateProfessional(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateProfessionalDto) {
    await this.prisma.professional.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const { hours, phone, ...rest } = dto;
    return this.prisma.professional.update({
      where: { id },
      data: { ...rest, ...(phone !== undefined && { phone: phone?.replace(/^\+/, '') || null }), ...(hours && { hours: { deleteMany: {}, create: hours.map((h) => ({ weekday: h.weekday, start: h.start, end: h.end })) } }) },
      include: { hours: true },
    });
  }
  /** Quantos agendamentos o profissional tem — a tela mostra antes de excluir. */
  @Get('professionals/:id/usage')
  async professionalUsage(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.professional.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    return this.usage({ professionalId: id });
  }
  /**
   * Exclusão definitiva (docs/13-agendamento.md#excluir). Desativar é o "Ativo" da edição.
   * Recusa com agendamento futuro; com só histórico, exige `?withHistory=true` (apaga junto).
   */
  @Delete('professionals/:id')
  @RequirePermission('agenda.manage')
  async deleteProfessional(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('withHistory') withHistory?: string) {
    await this.prisma.professional.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const verdict = deletionVerdict('profissional', await this.usage({ professionalId: id }), withHistory === 'true');
    if (!verdict.ok) throw new ConflictException({ code: verdict.code, message: verdict.message });
    // agendamentos e horários de trabalho caem em cascata (schema)
    await this.prisma.professional.delete({ where: { id } });
    return { ok: true };
  }

  // ----- serviços -----
  @Get('services')
  services(@CurrentUser() u: AuthUser) {
    return this.prisma.service.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
  }
  @Post('services')
  @RequirePermission('agenda.manage')
  createService(@CurrentUser() u: AuthUser, @Body() dto: ServiceDto) {
    return this.prisma.service.create({ data: { tenantId: u.tenantId, ...dto } });
  }
  @Patch('services/:id')
  @RequirePermission('agenda.manage')
  async updateService(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateServiceDto) {
    await this.prisma.service.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    return this.prisma.service.update({ where: { id }, data: dto });
  }
  @Get('services/:id/usage')
  async serviceUsage(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.service.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    return this.usage({ serviceId: id });
  }
  /** Exclusão definitiva, mesmas regras do profissional. */
  @Delete('services/:id')
  @RequirePermission('agenda.manage')
  async deleteService(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('withHistory') withHistory?: string) {
    await this.prisma.service.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const verdict = deletionVerdict('serviço', await this.usage({ serviceId: id }), withHistory === 'true');
    if (!verdict.ok) throw new ConflictException({ code: verdict.code, message: verdict.message });
    // a relação agendamento → serviço não tem cascata: apaga o histórico antes, na mesma transação
    await this.prisma.$transaction([
      this.prisma.appointment.deleteMany({ where: { serviceId: id, tenantId: u.tenantId } }),
      this.prisma.service.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  /** Agendamentos futuros ativos × o resto (histórico) de um profissional ou serviço. */
  private async usage(where: { professionalId: string } | { serviceId: string }): Promise<DeletionUsage> {
    const ativos = { status: { in: ['scheduled', 'confirmed'] as AppointmentStatus[] }, startAt: { gt: new Date() } };
    const [future, total] = await Promise.all([
      this.prisma.appointment.count({ where: { ...where, ...ativos } }),
      this.prisma.appointment.count({ where }),
    ]);
    return { future, past: total - future };
  }

  // ----- disponibilidade e agendamentos -----
  @Get('availability')
  availability(@CurrentUser() u: AuthUser, @Query('professionalId') professionalId: string, @Query('serviceId') serviceId: string, @Query('from') from?: string, @Query('days') days?: string) {
    return this.scheduling.availability(u.tenantId, professionalId, serviceId, from ? new Date(from) : new Date(), days ? Number(days) : undefined);
  }

  @Get('appointments')
  appointments(@CurrentUser() u: AuthUser, @Query('from') from: string, @Query('to') to: string, @Query('professionalId') professionalId?: string, @Query('contactId') contactId?: string) {
    return this.scheduling.list(u.tenantId, { from: new Date(from), to: new Date(to), professionalId: professionalId || undefined, contactId: contactId || undefined });
  }

  @Post('appointments')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAppointmentDto) {
    return this.scheduling.create(u.tenantId, { ...dto, startAt: new Date(dto.startAt), source: 'panel', createdById: u.id });
  }

  @Patch('appointments/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateAppointmentDto) {
    return this.scheduling.update(u.tenantId, id, { ...dto, startAt: dto.startAt ? new Date(dto.startAt) : undefined });
  }

  /** Ficha rápida do contato: visitas concluídas, último serviço, próximos horários. */
  @Get('contacts/:contactId')
  async contactCard(@CurrentUser() u: AuthUser, @Param('contactId') contactId: string) {
    await this.prisma.contact.findFirstOrThrow({ where: { id: contactId, tenantId: u.tenantId } });
    const [history, upcoming] = await Promise.all([
      this.scheduling.contactHistory(contactId),
      this.prisma.appointment.findMany({ where: { contactId, status: { in: ['scheduled', 'confirmed'] }, startAt: { gt: new Date() } }, orderBy: { startAt: 'asc' }, take: 3, include: { service: true, professional: { select: { name: true } } } }),
    ]);
    return { ...history, upcoming };
  }
}
