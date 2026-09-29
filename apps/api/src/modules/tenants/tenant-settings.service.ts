import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DEFAULT_HOURS, isOpenAt, type BusinessInterval } from './business-hours';

@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria na primeira leitura — cliente novo não precisa configurar nada para funcionar. */
  async get(tenantId: string) {
    const [settings, hours] = await Promise.all([
      this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} }),
      this.prisma.businessHour.findMany({ where: { tenantId }, orderBy: [{ weekday: 'asc' }, { start: 'asc' }] }),
    ]);
    return { ...settings, hours };
  }

  async update(tenantId: string, data: { timezone?: string; attendanceActive?: boolean; outsideHoursText?: string | null; welcomeFlowId?: string | null; closedFlowId?: string | null; defaultFlowId?: string | null; defaultFlowInactivityHours?: number }) {
    await this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    return this.get(tenantId);
  }

  /** Substitui o expediente inteiro — é como a tela edita (uma linha por intervalo). */
  async setHours(tenantId: string, hours: BusinessInterval[]) {
    await this.prisma.$transaction([
      this.prisma.businessHour.deleteMany({ where: { tenantId } }),
      this.prisma.businessHour.createMany({ data: hours.map((h) => ({ tenantId, weekday: h.weekday, start: h.start, end: h.end })) }),
    ]);
    return this.get(tenantId);
  }

  /** Fuso do cliente. Usado pela agenda, pelos fluxos e pelos relatórios. */
  async timezone(tenantId: string) {
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    return s?.timezone || 'America/Sao_Paulo';
  }

  /** O cliente está atendendo agora? */
  async isOpen(tenantId: string, now = new Date()) {
    const s = await this.get(tenantId);
    return isOpenAt({ now, timezone: s.timezone, hours: s.hours, attendanceActive: s.attendanceActive });
  }

  /** Sugestão para quem nunca configurou (botão "usar horário comercial"). */
  suggested() {
    return DEFAULT_HOURS;
  }
}
