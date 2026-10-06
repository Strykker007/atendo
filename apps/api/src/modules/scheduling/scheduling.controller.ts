import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsHexColor, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
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
  @IsOptional() @IsArray() clientReminderMinutes?: number[];
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
    const { reminderTemplate, ...rest } = dto;
    const tpl = reminderTemplate === undefined ? {} : { reminderTemplate: reminderTemplate === null ? Prisma.DbNull : ({ ...reminderTemplate } as Prisma.InputJsonValue) };
    return this.prisma.schedulingSettings.update({ where: { tenantId: u.tenantId }, data: { ...rest, ...tpl } });
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
  @Delete('professionals/:id')
  @RequirePermission('agenda.manage')
  async deleteProfessional(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.professional.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    await this.prisma.professional.update({ where: { id }, data: { isActive: false } }); // preserva histórico
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
  @Delete('services/:id')
  @RequirePermission('agenda.manage')
  async deleteService(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.service.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    await this.prisma.service.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
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
