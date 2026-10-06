import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { bandKey, defaultScheduleConfig, renameBandInDefinition, renamedBands, validateSchedule, type FlowDefinition, type ScheduleConfig } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertOwnMedia, contentItemErrors } from '../flows/flow-validation';
import { ALWAYS_OPEN, addOpenMinutes, nextOpenFrom, scheduleAt, type ScheduleSource } from './schedule-clock';

/**
 * Quadros de horários do cliente (docs/horarios.md). Um padrão por cliente; um número pode usar
 * outro. Cliente sem quadro = sempre aberto.
 */
@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.businessSchedule.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { numbers: { select: { id: true, label: true, phone: true } } },
    });
  }

  /** O primeiro quadro do cliente nasce padrão; os outros, não. */
  async create(tenantId: string, dto: { name: string; timezone?: string; config?: ScheduleConfig; copyFromId?: string }) {
    const [count, settings, base] = await Promise.all([
      this.prisma.businessSchedule.count({ where: { tenantId } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } }),
      dto.copyFromId ? this.prisma.businessSchedule.findFirst({ where: { id: dto.copyFromId, tenantId } }) : null,
    ]);
    if (count >= 20) throw new BadRequestException('No máximo 20 quadros de horários.');
    const config = dto.config ?? (base?.config as unknown as ScheduleConfig | undefined) ?? defaultScheduleConfig();
    await this.assertValid(tenantId, config);
    return this.prisma.businessSchedule.create({
      data: { tenantId, name: dto.name.trim(), timezone: dto.timezone ?? base?.timezone ?? settings?.timezone ?? 'America/Sao_Paulo', isDefault: count === 0, config: config as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Salva o quadro. Faixa renomeada → as condições "Faixa de horário atual" de todos os fluxos da
   * empresa que usavam o nome antigo passam a usar o novo (a menos que outro quadro ainda tenha
   * uma faixa com o nome antigo). Devolve quantas regras foram alteradas.
   */
  async update(tenantId: string, id: string, dto: { name?: string; timezone?: string; config?: ScheduleConfig }) {
    const before = await this.own(tenantId, id);
    if (dto.config) await this.assertValid(tenantId, dto.config);
    const schedule = await this.prisma.businessSchedule.update({
      where: { id },
      data: { ...(dto.name !== undefined && { name: dto.name.trim() }), ...(dto.timezone && { timezone: dto.timezone }), ...(dto.config && { config: dto.config as unknown as Prisma.InputJsonValue }) },
    });
    const renamedConditions = dto.config ? await this.renameInFlows(tenantId, before.config as unknown as ScheduleConfig, dto.config) : 0;
    return { ...schedule, renamedConditions };
  }

  private async renameInFlows(tenantId: string, before: ScheduleConfig, after: ScheduleConfig) {
    const renames = renamedBands(before, after);
    if (!renames.length) return 0;
    const all = await this.prisma.businessSchedule.findMany({ where: { tenantId }, select: { config: true } });
    const stillExists = new Set(all.flatMap((q) => (q.config as unknown as ScheduleConfig).bands.map((b) => bandKey(b.name))));
    const apply = renames.filter((r) => !stillExists.has(bandKey(r.from)));
    if (!apply.length) return 0;
    const flows = await this.prisma.flow.findMany({ where: { tenantId }, select: { id: true, definition: true } });
    let total = 0;
    for (const f of flows) {
      let def = f.definition as unknown as FlowDefinition;
      let count = 0;
      for (const r of apply) {
        const out = renameBandInDefinition(def, r.from, r.to);
        def = out.def;
        count += out.count;
      }
      if (!count) continue;
      // incrementa a versão: editor aberto com o fluxo antigo recebe 409 ao salvar, em vez de desfazer a troca
      await this.prisma.flow.update({ where: { id: f.id }, data: { definition: def as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      total += count;
    }
    return total;
  }

  /** O padrão não sai sem outro no lugar; números que usavam o quadro voltam para o padrão (FK SetNull). */
  async remove(tenantId: string, id: string) {
    const s = await this.own(tenantId, id);
    if (s.isDefault) throw new BadRequestException('Este é o quadro padrão. Defina outro como padrão antes de excluir.');
    await this.prisma.businessSchedule.delete({ where: { id } });
    return { ok: true };
  }

  async setDefault(tenantId: string, id: string) {
    await this.own(tenantId, id);
    await this.prisma.$transaction([
      this.prisma.businessSchedule.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } }),
      this.prisma.businessSchedule.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { ok: true };
  }

  /** Número passa a usar um quadro próprio (null = o padrão do cliente). */
  async setNumberSchedule(tenantId: string, numberId: string, scheduleId: string | null) {
    if (scheduleId) await this.own(tenantId, scheduleId);
    const n = await this.prisma.whatsAppNumber.updateMany({ where: { id: numberId, tenantId, deletedAt: null }, data: { scheduleId } });
    if (!n.count) throw new NotFoundException('Número não encontrado');
    return { ok: true };
  }

  // ---------- resolução (motor, campanhas, tela) ----------

  /** Quadro que vale para o número (o dele ou o padrão) + chave "atendimento ativo". */
  async source(tenantId: string, numberId?: string | null): Promise<ScheduleSource> {
    const [number, settings] = await Promise.all([
      numberId ? this.prisma.whatsAppNumber.findFirst({ where: { id: numberId, tenantId }, select: { schedule: true } }) : null,
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { attendanceActive: true, attendanceChangedAt: true } }),
    ]);
    const sched = number?.schedule ?? (await this.prisma.businessSchedule.findFirst({ where: { tenantId, isDefault: true } }));
    return {
      timezone: sched?.timezone ?? 'America/Sao_Paulo',
      config: (sched?.config as unknown as ScheduleConfig | undefined) ?? ALWAYS_OPEN,
      attendanceActive: settings?.attendanceActive ?? true,
      attendanceChangedAt: settings?.attendanceChangedAt,
    };
  }

  async now(tenantId: string, numberId?: string | null, at = new Date()) {
    return scheduleAt(await this.source(tenantId, numberId), at);
  }

  async isOpen(tenantId: string, numberId?: string | null, at = new Date()) {
    return (await this.now(tenantId, numberId, at)).open;
  }

  async nextOpen(tenantId: string, numberId: string | null | undefined, from: Date) {
    return nextOpenFrom(await this.source(tenantId, numberId), from);
  }

  async addOpenMinutes(tenantId: string, numberId: string | null | undefined, from: Date, minutes: number) {
    return addOpenMinutes(await this.source(tenantId, numberId), from, minutes);
  }

  // ---------- helpers ----------

  private async own(tenantId: string, id: string) {
    const s = await this.prisma.businessSchedule.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException('Quadro de horários não encontrado');
    return s;
  }

  /** Mesmas regras do editor + fluxo da resposta precisa ser deste cliente. */
  private async assertValid(tenantId: string, cfg: ScheduleConfig) {
    const issues = validateSchedule(cfg).map((i) => i.message);
    for (const b of [{ name: 'Fechado', ...cfg.closed }, ...cfg.bands]) {
      if (b.reply !== 'message') continue;
      issues.push(...contentItemErrors(b.items ?? [], `Faixa "${b.name}"`));
      assertOwnMedia(tenantId, b.items ?? [], `Faixa "${b.name}"`);
    }
    if (issues.length) throw new BadRequestException(issues.join(' '));
    const flowIds = [cfg.closed, ...cfg.bands].filter((b) => b.reply === 'flow' && b.flowId).map((b) => b.flowId!);
    if (flowIds.length) {
      const found = await this.prisma.flow.count({ where: { tenantId, id: { in: [...new Set(flowIds)] } } });
      if (found !== new Set(flowIds).size) throw new BadRequestException('Fluxo da resposta não encontrado.');
    }
  }
}
