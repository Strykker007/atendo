import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AppointmentStatus, AppointmentSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';

const TZ_DEFAULT = 'America/Sao_Paulo';

/** Partes de uma data num fuso, independente do fuso da máquina. */
function partsIn(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), hh: Number(get('hour')) % 24, mm: Number(get('minute')), weekday };
}
/** Offset (ms) do fuso naquele instante: quanto somar ao "relógio local lido como UTC" para obter o instante real. */
function tzOffsetMs(date: Date, tz: string) {
  const p = partsIn(date, tz);
  return date.getTime() - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, 0);
}
/** Data local (no fuso do tenant) + "HH:MM" → instante UTC. */
function localToUtc(dateYmd: string, hm: string, tz: string) {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // offset avaliado no próprio instante (lida com horário de verão)
  return new Date(naive + tzOffsetMs(new Date(naive), tz));
}
const WEEKDAY_PT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
function toLocal(date: Date, tz: string) {
  const p = partsIn(date, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { ymd: `${p.y}-${pad(p.m)}-${pad(p.d)}`, hm: `${pad(p.hh)}:${pad(p.mm)}`, weekday: p.weekday, label: `${WEEKDAY_PT[p.weekday]} ${pad(p.d)}/${pad(p.m)} ${pad(p.hh)}:${pad(p.mm)}` };
}

export interface Slot { startAt: Date; endAt: Date; label: string }

@Injectable()
export class SchedulingService {
  private readonly log = new Logger(SchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly gateway: ConversationsGateway,
  ) {}

  // ---------- preferências ----------

  async settings(tenantId: string) {
    return this.prisma.schedulingSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
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
    const slots: Slot[] = [];
    const notBefore = new Date(Math.max(from.getTime(), Date.now())); // nunca oferece horário no passado
    const durMs = service.durationMin * 60_000;
    const stepMs = settings.slotMinutes * 60_000;
    // percorre dia a dia no fuso do tenant
    for (let dayOffset = 0; dayOffset <= horizon && slots.length < limit; dayOffset++) {
      const dayRef = new Date(from.getTime() + dayOffset * 86_400_000);
      const { ymd, weekday } = toLocal(dayRef, tz);
      for (const h of pro.hours.filter((x) => x.weekday === weekday)) {
        let cursor = localToUtc(ymd, h.start, tz);
        const end = localToUtc(ymd, h.end, tz);
        while (cursor.getTime() + durMs <= end.getTime() && slots.length < limit) {
          const s = cursor, e = new Date(cursor.getTime() + durMs);
          const collides = busy.some((b) => b.startAt < e && b.endAt > s);
          if (s > notBefore && !collides) slots.push({ startAt: s, endAt: e, label: toLocal(s, tz).label });
          cursor = new Date(cursor.getTime() + stepMs);
        }
      }
    }
    return slots;
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
      const tz = s.timezone || TZ_DEFAULT;
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
    const text = soon
      ? `Olá ${a.contact.name ?? ''}! Lembrete: seu horário de *${a.service.name}* com ${a.professional.name} é hoje às ${when.hm}. Até já! 💈`
      : `Olá ${a.contact.name ?? ''}! Você tem *${a.service.name}* com ${a.professional.name} marcado para ${when.label}.\n\nResponda *1* para confirmar ou *2* para remarcar.`;
    await this.conversations.sendToContact(a.tenantId, a.contactId, text);
  }

  private async sendProReminder(a: Prisma.AppointmentGetPayload<{ include: { contact: true; service: true; professional: true } }>, tz: string) {
    const when = toLocal(a.startAt, tz);
    const hist = await this.contactHistory(a.contactId);
    const histText = hist.visits ? `Cliente há ${hist.visits} visita${hist.visits > 1 ? 's' : ''}${hist.last ? `, última em ${toLocal(hist.last.startAt, tz).label} (${hist.last.service.name})` : ''}.` : 'Primeira visita.';
    const text = `💈 Próximo: *${a.contact.name ?? a.contact.phone}* às ${when.hm} — ${a.service.name} (${a.service.durationMin} min).\n${histText}${a.notes ? `\nObs.: ${a.notes}` : ''}${a.status === 'confirmed' ? '\n✅ Confirmado pelo cliente.' : ''}`;
    await this.conversations.sendToPhone(a.tenantId, a.professional.phone!, text, { closeAfter: true, contactName: a.professional.name });
  }

  /** Resposta do cliente ao lembrete ("1" confirma, "2" remarcar). Chamado pelo InboundProcessor. */
  async onInbound(tenantId: string, contactId: string, conversationId: string, text: string) {
    const t = text.trim();
    if (t !== '1' && t !== '2') return false;
    const a = await this.prisma.appointment.findFirst({
      where: { tenantId, contactId, status: 'scheduled', startAt: { gt: new Date() }, NOT: { clientRemindersSent: { equals: [] } } },
      orderBy: { startAt: 'asc' },
      include: { service: true, professional: true },
    });
    if (!a) return false;
    const settings = await this.settings(tenantId);
    const when = toLocal(a.startAt, settings.timezone || TZ_DEFAULT);
    if (t === '1') {
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
    this.gateway.server?.to(`tenant:${tenantId}`).emit('appointment', { id: appointmentId });
  }
}
