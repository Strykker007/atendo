import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AppointmentStatus, AppointmentSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { TZ_DEFAULT, toLocal } from '../../common/time';
import { TenantSettingsService } from '../tenants/tenant-settings.service';
import { computeSlots, type Slot } from './slots';
import { REMINDER_OPTIONS, reminderChoice } from './reminder-reply';

export type { Slot };


@Injectable()
export class SchedulingService {
  private readonly log = new Logger(SchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly gateway: ConversationsGateway,
    private readonly tenantSettings: TenantSettingsService,
  ) {}

  // ---------- preferências ----------

  async settings(tenantId: string) {
    const [s, timezone] = await Promise.all([
      this.prisma.schedulingSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} }),
      this.tenantSettings.timezone(tenantId),
    ]);
    // o fuso é do cliente (Configurações), não do módulo de agendamento
    return { ...s, timezone };
  }

  // ---------- disponibilidade ----------

  /**
   * Horários livres de um profissional para um serviço, a partir de `from`, por `days` dias.
   * Regra: dentro dos intervalos de trabalho do dia, passo = slotMinutes, cabe a duração do serviço,
   * não colide com agendamento existente (exceto cancelados/faltas), e não é no passado.
   */
  async availability(tenantId: string, professionalId: string, serviceId: string, from = new Date(), days?: number, limit = 200): Promise<Slot[]> {
    const [settings, pro, service] = await Promise.all([
      this.settings(tenantId),
      this.prisma.professional.findFirst({ where: { id: professionalId, tenantId, isActive: true }, include: { hours: true } }),
      this.prisma.service.findFirst({ where: { id: serviceId, tenantId, isActive: true } }),
    ]);
    if (!pro) throw new NotFoundException('Profissional não encontrado');
    if (!service) throw new NotFoundException('Serviço não encontrado');
    const tz = settings.timezone || TZ_DEFAULT;
    const horizon = days ?? settings.daysAhead;
    const until = new Date(from.getTime() + horizon * 86_400_000);
    const busy = await this.prisma.appointment.findMany({
      where: { professionalId, status: { in: ['scheduled', 'confirmed'] }, startAt: { lt: until }, endAt: { gt: from } },
      select: { startAt: true, endAt: true },
    });
    return computeSlots({
      tz,
      hours: pro.hours,
      busy,
      durationMin: service.durationMin,
      slotMinutes: settings.slotMinutes,
      from,
      days: horizon,
      limit,
    });
  }

  // ---------- agendamentos ----------

  async create(tenantId: string, input: { professionalId: string; serviceId: string; contactId: string; startAt: Date; conversationId?: string; source: AppointmentSource; notes?: string; createdById?: string }) {
    const [service, pro] = await Promise.all([
      this.prisma.service.findFirst({ where: { id: input.serviceId, tenantId } }),
      this.prisma.professional.findFirst({ where: { id: input.professionalId, tenantId } }),
    ]);
    if (!service || !pro) throw new BadRequestException('Serviço ou profissional inválido');
    const endAt = new Date(input.startAt.getTime() + service.durationMin * 60_000);
    // conflito (mesmo profissional, horário sobreposto) — checado no banco na hora de gravar
    const clash = await this.prisma.appointment.findFirst({ where: { professionalId: pro.id, status: { in: ['scheduled', 'confirmed'] }, startAt: { lt: endAt }, endAt: { gt: input.startAt } } });
    if (clash) throw new ConflictException('Esse horário acabou de ser ocupado. Escolha outro.');
    const appt = await this.prisma.appointment.create({
      data: { tenantId, professionalId: pro.id, serviceId: service.id, contactId: input.contactId, conversationId: input.conversationId, startAt: input.startAt, endAt, source: input.source, notes: input.notes, createdById: input.createdById },
      include: { contact: true, service: true, professional: true },
    });
    this.emit(tenantId, appt.id);
    return appt;
  }

  async list(tenantId: string, q: { from: Date; to: Date; professionalId?: string; contactId?: string }) {
    return this.prisma.appointment.findMany({
      where: { tenantId, startAt: { gte: q.from, lt: q.to }, ...(q.professionalId && { professionalId: q.professionalId }), ...(q.contactId && { contactId: q.contactId }) },
      include: { contact: { select: { id: true, name: true, phone: true } }, service: true, professional: { select: { id: true, name: true, color: true } } },
      orderBy: { startAt: 'asc' },
    });
  }

  async update(tenantId: string, id: string, data: { status?: AppointmentStatus; startAt?: Date; professionalId?: string; serviceId?: string; notes?: string }) {
    const appt = await this.prisma.appointment.findFirst({ where: { id, tenantId }, include: { service: true } });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    const serviceId = data.serviceId ?? appt.serviceId;
    const service = serviceId === appt.serviceId ? appt.service : await this.prisma.service.findFirstOrThrow({ where: { id: serviceId, tenantId } });
    const startAt = data.startAt ?? appt.startAt;
    const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);
    const professionalId = data.professionalId ?? appt.professionalId;
    if (data.startAt || data.professionalId || data.serviceId) {
      const clash = await this.prisma.appointment.findFirst({ where: { id: { not: id }, professionalId, status: { in: ['scheduled', 'confirmed'] }, startAt: { lt: endAt }, endAt: { gt: startAt } } });
      if (clash) throw new ConflictException('Conflito com outro agendamento desse profissional.');
    }
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: data.status, startAt, endAt, professionalId, serviceId, notes: data.notes, rescheduleRequested: data.startAt ? false : undefined, ...(data.startAt && { clientRemindersSent: [], proReminderSentAt: null }) },
      include: { contact: true, service: true, professional: true },
    });
    this.emit(tenantId, id);
    return updated;
  }

  /** Histórico do contato (para o aviso ao barbeiro e para a ficha no chat). */
  async contactHistory(contactId: string) {
    const [count, last] = await Promise.all([
      this.prisma.appointment.count({ where: { contactId, status: 'done' } }),
      this.prisma.appointment.findFirst({ where: { contactId, status: 'done' }, orderBy: { startAt: 'desc' }, include: { service: true } }),
    ]);
    return { visits: count, last };
  }

  // ---------- lembretes (job a cada minuto) ----------

  async runReminders() {
    const now = Date.now();
    const settingsList = await this.prisma.schedulingSettings.findMany();
    for (const s of settingsList) {
      const tz = (await this.tenantSettings.timezone(s.tenantId)) || TZ_DEFAULT;
      const clientMins = (s.clientReminderMinutes as number[]) ?? [];
      const maxWindow = Math.max(s.proReminderMinutes, ...clientMins, 0);
      const upcoming = await this.prisma.appointment.findMany({
        where: { tenantId: s.tenantId, status: { in: ['scheduled', 'confirmed'] }, startAt: { gt: new Date(now), lte: new Date(now + (maxWindow + 1) * 60_000) } },
        include: { contact: true, service: true, professional: true },
      });
      for (const a of upcoming) {
        const minsLeft = (a.startAt.getTime() - now) / 60_000;
        // cliente: cada janela dispara uma vez, quando faltar <= X min
        const sent = (a.clientRemindersSent as number[]) ?? [];
        for (const m of clientMins) {
          if (minsLeft <= m && !sent.includes(m)) {
            await this.sendClientReminder(a, tz, m).catch((e) => this.log.warn(`lembrete cliente ${a.id}: ${e.message}`));
            sent.push(m);
            await this.prisma.appointment.update({ where: { id: a.id }, data: { clientRemindersSent: sent } });
          }
        }
        // profissional: uma vez, X min antes
        if (!a.proReminderSentAt && minsLeft <= s.proReminderMinutes && a.professional.phone) {
          await this.sendProReminder(a, tz).catch((e) => this.log.warn(`aviso profissional ${a.id}: ${e.message}`));
          await this.prisma.appointment.update({ where: { id: a.id }, data: { proReminderSentAt: new Date() } });
        }
      }
    }
  }

  private async sendClientReminder(a: Prisma.AppointmentGetPayload<{ include: { contact: true; service: true; professional: true } }>, tz: string, minutesBefore: number) {
    const when = toLocal(a.startAt, tz);
    const soon = minutesBefore <= 120;
    if (soon) {
      // lembrete de última hora: só avisa, não pede resposta
      await this.conversations.sendToContact(a.tenantId, a.contactId, `Olá ${a.contact.name ?? ''}! Lembrete: seu horário de *${a.service.name}* com ${a.professional.name} é hoje às ${when.hm}. Até já! 💈`, { idempotencyKey: `reminder-${a.id}-${minutesBefore}` });
      return;
    }
    await this.conversations.sendToContact(
      a.tenantId,
      a.contactId,
      `Olá ${a.contact.name ?? ''}! Você tem *${a.service.name}* com ${a.professional.name} marcado para ${when.label}.\n\nPosso confirmar?`,
      // chave por agendamento + antecedência: tick repetido do job não manda o lembrete duas vezes
      { interactive: { options: REMINDER_OPTIONS }, idempotencyKey: `reminder-${a.id}-${minutesBefore}` },
    );
  }

  private async sendProReminder(a: Prisma.AppointmentGetPayload<{ include: { contact: true; service: true; professional: true } }>, tz: string) {
    const when = toLocal(a.startAt, tz);
    const hist = await this.contactHistory(a.contactId);
    const histText = hist.visits ? `Cliente há ${hist.visits} visita${hist.visits > 1 ? 's' : ''}${hist.last ? `, última em ${toLocal(hist.last.startAt, tz).label} (${hist.last.service.name})` : ''}.` : 'Primeira visita.';
    const text = `💈 Próximo: *${a.contact.name ?? a.contact.phone}* às ${when.hm} — ${a.service.name} (${a.service.durationMin} min).\n${histText}${a.notes ? `\nObs.: ${a.notes}` : ''}${a.status === 'confirmed' ? '\n✅ Confirmado pelo cliente.' : ''}`;
    await this.conversations.sendToPhone(a.tenantId, a.professional.phone!, text, { closeAfter: true, contactName: a.professional.name, idempotencyKey: `pro-reminder-${a.id}` });
  }

  /**
   * Resposta do cliente ao lembrete: botão Confirmar/Remarcar, "1"/"2" ou o texto.
   * Chamado pelo InboundProcessor antes dos fluxos.
   */
  async onInbound(tenantId: string, contactId: string, conversationId: string, text: string, replyId?: string) {
    const choice = reminderChoice(text, replyId);
    if (!choice) return false;
    const a = await this.prisma.appointment.findFirst({
      where: { tenantId, contactId, status: 'scheduled', startAt: { gt: new Date() }, NOT: { clientRemindersSent: { equals: [] } } },
      orderBy: { startAt: 'asc' },
      include: { service: true, professional: true },
    });
    if (!a) return false;
    const settings = await this.settings(tenantId);
    const when = toLocal(a.startAt, settings.timezone || TZ_DEFAULT);
    if (choice === 'confirm') {
      await this.prisma.appointment.update({ where: { id: a.id }, data: { status: 'confirmed' } });
      await this.conversations.sendAsSystem(conversationId, `Confirmado! ${a.service.name} com ${a.professional.name}, ${when.label}. Até lá! 💈`);
    } else {
      await this.prisma.appointment.update({ where: { id: a.id }, data: { rescheduleRequested: true } });
      await this.conversations.sendAsSystem(conversationId, 'Sem problema! Já vamos te ajudar a remarcar. Um momento.');
      // entrega para humano com a orientação
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'waiting', assigneeId: null } });
      await this.prisma.message.create({ data: { conversationId, direction: 'out', type: 'text', status: 'delivered', internal: true, text: `Cliente pediu para REMARCAR: ${a.service.name} com ${a.professional.name} em ${when.label}. Abra a Agenda para escolher outro horário.` } });
    }
    this.emit(tenantId, a.id);
    return true;
  }

  private emit(tenantId: string, appointmentId: string) {
    this.gateway.emitAppointment(tenantId, appointmentId);
  }
}
