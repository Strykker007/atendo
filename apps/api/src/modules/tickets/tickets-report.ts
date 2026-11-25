/**
 * Relatório de tickets (docs/tickets.md#relatório). Tudo sai do que já é gravado: datas do ticket
 * (`createdAt`, `resolvedAt`, `dueAt`) e a linha do tempo (`ticket_events`). Função pura: o serviço
 * busca, aqui só se conta — dá para testar sem banco.
 */

export interface ReportTicket {
  id: string;
  status: string;
  priority: string;
  departmentId: string | null;
  typeId: string | null;
  source: string;
  createdAt: Date;
  resolvedAt: Date | null;
  dueAt: Date | null;
  createdById: string | null;
  responsibleId: string | null;
}
export interface ReportEvent { ticketId: string; type: string; actorId: string | null; data: unknown; createdAt: Date }

export interface TicketReportRow {
  key: string;
  name: string;
  /** abertos no período */
  created: number;
  /** resolvidos no período */
  resolved: number;
  /** em aberto agora (aberto, em andamento, em espera) */
  active: number;
  /** em aberto agora com prazo vencido */
  overdue: number;
  /** minutos — mediana (o tempo "típico", que um ticket esquecido não distorce) */
  medianFirstResponseMin: number | null;
  medianResolutionMin: number | null;
  /** % dos resolvidos no período que tinham prazo e terminaram dentro dele */
  onTimePct: number | null;
}

export interface TicketReport {
  totals: {
    created: number; resolved: number; canceled: number;
    active: number; overdue: number; toPick: number; onHold: number;
    avgFirstResponseMin: number | null; medianFirstResponseMin: number | null;
    avgResolutionMin: number | null; medianResolutionMin: number | null;
    /** resolução sem contar o tempo parado em espera (o que dependia da equipe) */
    medianNetResolutionMin: number | null;
    onTimePct: number | null; resolvedWithDue: number;
  };
  /** por dia (no fuso do cliente): abertos × resolvidos */
  series: { day: string; created: number; resolved: number }[];
  byDepartment: TicketReportRow[];
  byType: TicketReportRow[];
  byPriority: TicketReportRow[];
  bySource: TicketReportRow[];
  /** responsável atual; resolvido sem responsável conta para quem resolveu */
  byPerson: TicketReportRow[];
  /** esperas que começaram no período */
  holdByReason: { reason: string; count: number; totalMin: number; avgMin: number }[];
}

const ATIVOS = new Set(['open', 'in_progress', 'on_hold']);
/** ações que contam como "alguém da equipe respondeu" */
const RESPOSTA = new Set(['comment', 'status', 'hold', 'transfer', 'participant_added']);

const min = (ms: number) => Math.max(0, Math.round(ms / 60_000));
const media = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
function mediana(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** Fatos de um ticket que todas as quebras usam. */
interface Fato {
  t: ReportTicket;
  criadoNoPeriodo: boolean;
  resolvidoNoPeriodo: boolean;
  canceladoNoPeriodo: boolean;
  ativo: boolean;
  atrasado: boolean;
  primeiraRespostaMin: number | null;
  resolucaoMin: number | null;
  resolucaoLiquidaMin: number | null;
  noPrazo: boolean | null;
  pessoa: string | null;
}

export function computeTicketReport(
  tickets: ReportTicket[],
  events: ReportEvent[],
  o: { from: Date; to: Date; now: Date; timezone: string; names: { departments: Map<string, string>; types: Map<string, string>; users: Map<string, string> }; priorityLabel: Record<string, string>; sourceLabel: Record<string, string> },
): TicketReport {
  const dentro = (d: Date | null) => !!d && d >= o.from && d < o.to;
  const porTicket = new Map<string, ReportEvent[]>();
  for (const e of events) (porTicket.get(e.ticketId) ?? porTicket.set(e.ticketId, []).get(e.ticketId)!).push(e);

  const esperas: { reason: string; ms: number; start: Date }[] = [];
  const fatos: Fato[] = tickets.map((t) => {
    const evs = (porTicket.get(t.id) ?? []).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    // 1ª resposta: primeira ação de alguém que não é quem abriu (ticket da automação: qualquer pessoa)
    const resp = evs.find((e) => RESPOSTA.has(e.type) && e.actorId && e.actorId !== t.createdById);
    // esperas: de cada "hold" até o próximo resume/status/hold (ou agora, se continua parado)
    let aberta: { reason: string; start: Date } | null = null;
    const minhas: { reason: string; start: Date; end: Date }[] = [];
    for (const e of evs) {
      if (aberta && (e.type === 'resume' || e.type === 'status' || e.type === 'hold')) { minhas.push({ ...aberta, end: e.createdAt }); aberta = null; }
      if (e.type === 'hold') aberta = { reason: String((e.data as { reason?: unknown } | null)?.reason ?? 'Sem motivo'), start: e.createdAt };
    }
    if (aberta) minhas.push({ ...aberta, end: o.now });
    for (const h of minhas) if (dentro(h.start)) esperas.push({ reason: h.reason, ms: h.end.getTime() - h.start.getTime(), start: h.start });

    const resolvido = t.status === 'resolved' && t.resolvedAt;
    const resolucaoMs = resolvido ? t.resolvedAt!.getTime() - t.createdAt.getTime() : null;
    const esperaAteResolver = resolvido ? minhas.reduce((a, h) => a + Math.max(0, Math.min(h.end.getTime(), t.resolvedAt!.getTime()) - h.start.getTime()), 0) : 0;
    const cancel = [...evs].reverse().find((e) => e.type === 'status' && (e.data as { to?: unknown } | null)?.to === 'canceled');
    const resolveu = [...evs].reverse().find((e) => e.type === 'status' && (e.data as { to?: unknown } | null)?.to === 'resolved');
    return {
      t,
      criadoNoPeriodo: dentro(t.createdAt),
      resolvidoNoPeriodo: !!resolvido && dentro(t.resolvedAt),
      canceladoNoPeriodo: t.status === 'canceled' && !!cancel && dentro(cancel.createdAt),
      ativo: ATIVOS.has(t.status),
      atrasado: (t.status === 'open' || t.status === 'in_progress') && !!t.dueAt && t.dueAt < o.now,
      primeiraRespostaMin: resp ? min(resp.createdAt.getTime() - t.createdAt.getTime()) : null,
      resolucaoMin: resolucaoMs === null ? null : min(resolucaoMs),
      resolucaoLiquidaMin: resolucaoMs === null ? null : min(resolucaoMs - esperaAteResolver),
      noPrazo: resolvido && t.dueAt ? t.resolvedAt! <= t.dueAt : null,
      pessoa: t.responsibleId ?? (resolvido ? resolveu?.actorId ?? null : null),
    };
  });

  const linha = (key: string, name: string, fs: Fato[]): TicketReportRow => {
    const resolvidos = fs.filter((f) => f.resolvidoNoPeriodo);
    const comPrazo = resolvidos.filter((f) => f.noPrazo !== null);
    return {
      key, name,
      created: fs.filter((f) => f.criadoNoPeriodo).length,
      resolved: resolvidos.length,
      active: fs.filter((f) => f.ativo).length,
      overdue: fs.filter((f) => f.atrasado).length,
      medianFirstResponseMin: mediana(fs.filter((f) => f.criadoNoPeriodo && f.primeiraRespostaMin !== null).map((f) => f.primeiraRespostaMin!)),
      medianResolutionMin: mediana(resolvidos.map((f) => f.resolucaoMin!)),
      onTimePct: pct(comPrazo.filter((f) => f.noPrazo).length, comPrazo.length),
    };
  };
  const quebra = (chave: (f: Fato) => string | null, nome: (k: string | null) => string) => {
    const grupos = new Map<string, Fato[]>();
    for (const f of fatos) {
      const k = chave(f) ?? '';
      (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(f);
    }
    return [...grupos.entries()]
      .map(([k, fs]) => linha(k || 'none', nome(k || null), fs))
      // só quem teve movimento no período ou tem algo pendente agora
      .filter((r) => r.created || r.resolved || r.active)
      .sort((a, b) => b.created + b.active - (a.created + a.active) || a.name.localeCompare(b.name));
  };

  // série diária no fuso do cliente, cobrindo o período inteiro (dia sem nada = zero)
  const diaDe = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: o.timezone });
  const series = new Map<string, { created: number; resolved: number }>();
  for (let d = new Date(o.from); d < o.to && series.size < 400; d = new Date(d.getTime() + 86_400_000)) series.set(diaDe(d), { created: 0, resolved: 0 });
  for (const f of fatos) {
    if (f.criadoNoPeriodo) { const s = series.get(diaDe(f.t.createdAt)); if (s) s.created++; }
    if (f.resolvidoNoPeriodo) { const s = series.get(diaDe(f.t.resolvedAt!)); if (s) s.resolved++; }
  }

  const criados = fatos.filter((f) => f.criadoNoPeriodo);
  const resolvidos = fatos.filter((f) => f.resolvidoNoPeriodo);
  const comPrazo = resolvidos.filter((f) => f.noPrazo !== null);
  const respostas = criados.filter((f) => f.primeiraRespostaMin !== null).map((f) => f.primeiraRespostaMin!);
  const resolucoes = resolvidos.map((f) => f.resolucaoMin!);

  const porMotivo = new Map<string, number[]>();
  for (const h of esperas) (porMotivo.get(h.reason) ?? porMotivo.set(h.reason, []).get(h.reason)!).push(h.ms);

  return {
    totals: {
      created: criados.length,
      resolved: resolvidos.length,
      canceled: fatos.filter((f) => f.canceladoNoPeriodo).length,
      active: fatos.filter((f) => f.ativo).length,
      overdue: fatos.filter((f) => f.atrasado).length,
      toPick: fatos.filter((f) => f.t.status === 'open' && !f.t.responsibleId).length,
      onHold: fatos.filter((f) => f.t.status === 'on_hold').length,
      avgFirstResponseMin: media(respostas),
      medianFirstResponseMin: mediana(respostas),
      avgResolutionMin: media(resolucoes),
      medianResolutionMin: mediana(resolucoes),
      medianNetResolutionMin: mediana(resolvidos.map((f) => f.resolucaoLiquidaMin!)),
      onTimePct: pct(comPrazo.filter((f) => f.noPrazo).length, comPrazo.length),
      resolvedWithDue: comPrazo.length,
    },
    series: [...series.entries()].map(([day, v]) => ({ day, ...v })),
    byDepartment: quebra((f) => f.t.departmentId, (k) => (k ? o.names.departments.get(k) ?? 'Setor removido' : 'Sem setor')),
    byType: quebra((f) => f.t.typeId, (k) => (k ? o.names.types.get(k) ?? 'Tipo removido' : 'Sem tipo')),
    byPriority: quebra((f) => f.t.priority, (k) => o.priorityLabel[k ?? ''] ?? k ?? '—'),
    bySource: quebra((f) => f.t.source, (k) => o.sourceLabel[k ?? ''] ?? k ?? '—'),
    byPerson: quebra((f) => f.pessoa, (k) => (k ? o.names.users.get(k) ?? 'Pessoa removida' : 'Sem responsável')),
    holdByReason: [...porMotivo.entries()]
      .map(([reason, ms]) => ({ reason, count: ms.length, totalMin: min(ms.reduce((a, b) => a + b, 0)), avgMin: min(ms.reduce((a, b) => a + b, 0) / ms.length) }))
      .sort((a, b) => b.totalMin - a.totalMin),
  };
}
