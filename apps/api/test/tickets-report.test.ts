import { describe, expect, it } from 'vitest';
import { computeTicketReport, type ReportEvent, type ReportTicket } from '../src/modules/tickets/tickets-report';

const H = 3_600_000;
const from = new Date('2026-11-01T03:00:00Z');
const to = new Date('2026-11-08T03:00:00Z');
const now = new Date('2026-11-10T12:00:00Z');
const at = (h: number) => new Date(from.getTime() + h * H);
const names = { departments: new Map([['d1', 'Manutenção']]), types: new Map<string, string>(), users: new Map([['ana', 'Ana'], ['bia', 'Bia']]) };
const opts = { from, to, now, timezone: 'America/Sao_Paulo', names, priorityLabel: { normal: 'Normal', urgent: 'Urgente' }, sourceLabel: { panel: 'Painel' } };
const base = (p: Partial<ReportTicket> & { id: string }): ReportTicket => ({
  status: 'open', priority: 'normal', departmentId: 'd1', typeId: null, source: 'panel', createdAt: at(0), resolvedAt: null, dueAt: null, createdById: 'bia', responsibleId: null, ...p,
});

describe('relatório de tickets (docs/tickets.md#relatório)', () => {
  it('1ª resposta ignora quem abriu; resolução líquida desconta a espera', () => {
    const t = base({ id: 't1', status: 'resolved', createdAt: at(0), resolvedAt: at(10), dueAt: at(12), responsibleId: 'ana' });
    const ev: ReportEvent[] = [
      { ticketId: 't1', type: 'comment', actorId: 'bia', data: null, createdAt: at(1) }, // quem abriu: não conta
      { ticketId: 't1', type: 'comment', actorId: 'ana', data: null, createdAt: at(2) },
      { ticketId: 't1', type: 'hold', actorId: 'ana', data: { reason: 'Peça' }, createdAt: at(3) },
      { ticketId: 't1', type: 'resume', actorId: 'ana', data: null, createdAt: at(7) },
      { ticketId: 't1', type: 'status', actorId: 'ana', data: { from: 'in_progress', to: 'resolved' }, createdAt: at(10) },
    ];
    const r = computeTicketReport([t], ev, opts);
    expect(r.totals.medianFirstResponseMin).toBe(120);
    expect(r.totals.medianResolutionMin).toBe(600);
    expect(r.totals.medianNetResolutionMin).toBe(360);
    expect(r.totals.onTimePct).toBe(100);
    expect(r.holdByReason).toEqual([{ reason: 'Peça', count: 1, totalMin: 240, avgMin: 240 }]);
    expect(r.byPerson[0]).toMatchObject({ name: 'Ana', resolved: 1 });
  });

  it('atrasado, para pegar e fora do prazo', () => {
    const r = computeTicketReport([
      base({ id: 'a', dueAt: at(5) }), // aberto, vencido, sem responsável
      base({ id: 'b', status: 'resolved', resolvedAt: at(30), dueAt: at(20), responsibleId: 'ana' }), // fora do prazo
      base({ id: 'c', createdAt: new Date('2026-10-01T00:00:00Z'), status: 'in_progress', responsibleId: 'ana' }), // antigo, pendente
    ], [], opts);
    expect(r.totals).toMatchObject({ created: 2, resolved: 1, active: 2, overdue: 1, toPick: 1, onTimePct: 0, resolvedWithDue: 1 });
    // a série cobre os 7 dias, mesmo os sem movimento
    expect(r.series).toHaveLength(7);
    expect(r.series[0]).toEqual({ day: '2026-11-01', created: 2, resolved: 0 });
  });
});
