import type { ContentItem, FlowDefinition } from './flows.js';

/**
 * Quadro de horários (tarefa 2). Puro: trabalha em **hora local do quadro** (data YYYY-MM-DD +
 * minuto do dia) — a conversão de/para instante UTC fica na API, que conhece o fuso. Assim o
 * editor simula ("Simular") com o que está na tela, sem salvar e sem depender de fuso.
 *
 * Regras:
 * - Cada dia da semana (ou exceção por data) tem intervalos `start–end`, cada um ligado a uma faixa.
 * - `end <= start` atravessa a meia-noite: `22:00–02:00` vale até 02:00 do dia seguinte;
 *   `22:00–00:00` vai até a meia-noite; `00:00–00:00` é o dia inteiro (24h).
 * - Fora de qualquer intervalo vale a faixa fixa **Fechado** (`CLOSED_BAND_ID`).
 * - Exceção por data substitui a grade daquele dia (fechado o dia todo ou intervalos próprios).
 *   O pedaço depois da meia-noite de um intervalo do dia anterior continua valendo.
 * - Sobreposição: o intervalo do próprio dia ganha do que veio do dia anterior. Dentro do mesmo
 *   dia, `validateSchedule` recusa.
 */

/**
 * O que fazer quando chega mensagem numa faixa:
 * - `normal`: atendimento normal (fluxos, gatilhos), nada é enviado pela faixa.
 * - `notify_continue`: envia a resposta da faixa (uma vez por período) e segue o atendimento normal.
 * - `notify_stop`: envia a resposta da faixa (uma vez por período) e para — nenhum fluxo inicia
 *   nem recebe a mensagem.
 * - `notify_fallback`: segue o atendimento normal e só envia a resposta da faixa se nenhum fluxo
 *   respondeu. É o comportamento do antigo "aviso de fora do expediente" (usado na migração).
 */
export type BandBehavior = 'normal' | 'notify_continue' | 'notify_stop' | 'notify_fallback';
export const BAND_BEHAVIOR_LABEL: Record<BandBehavior, string> = {
  normal: 'Seguir o atendimento normal',
  notify_continue: 'Enviar a resposta e seguir',
  notify_stop: 'Enviar a resposta e parar',
  notify_fallback: 'Enviar a resposta só se nenhum fluxo responder',
};
/** Resposta da faixa: mensagens (formatos do Conteúdo) ou um fluxo. */
export type BandReplyKind = 'message' | 'flow';

export interface ScheduleBand {
  id: string;
  name: string;
  /** cor do chip no editor */
  color?: string;
  /** Conta como "horário de atendimento" (condição, Atraso "até o próximo horário", tempo limite). Fechado nunca conta. */
  open: boolean;
  behavior: BandBehavior;
  reply: BandReplyKind;
  /** reply = message */
  items: ContentItem[];
  /** reply = flow */
  flowId?: string | null;
}

export interface ScheduleInterval { id: string; start: string; end: string; bandId: string }
export interface ScheduleException {
  id: string;
  /** YYYY-MM-DD no fuso do quadro */
  date: string;
  label?: string;
  /** true = fechado o dia todo (ignora `intervals`) */
  closed: boolean;
  intervals: ScheduleInterval[];
}
export interface ScheduleConfig {
  /** faixas criadas pelo cliente (Fechado não entra aqui) */
  bands: ScheduleBand[];
  /** faixa fixa Fechado: só a resposta e o comportamento são configuráveis */
  closed: Pick<ScheduleBand, 'behavior' | 'reply' | 'items' | 'flowId'>;
  /** índice = dia da semana (0 = domingo) */
  week: ScheduleInterval[][];
  exceptions: ScheduleException[];
}

export const CLOSED_BAND_ID = 'closed';
export const CLOSED_BAND_NAME = 'Fechado';
export const SCHEDULE_MAX_BANDS = 20;
export const SCHEDULE_MAX_INTERVALS_PER_DAY = 12;
export const SCHEDULE_MAX_EXCEPTIONS = 200;
export const WEEKDAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

/** Faixa Fechado completa (id/nome fixos, nunca conta como atendimento). */
export function closedBand(cfg: ScheduleConfig): ScheduleBand {
  return { id: CLOSED_BAND_ID, name: CLOSED_BAND_NAME, open: false, color: '#94a3b8', ...cfg.closed, items: cfg.closed.items ?? [] };
}

/** Quadro novo: seg–sex 08:00–18:00 "Aberto", Fechado sem mensagem. */
export function defaultScheduleConfig(): ScheduleConfig {
  const band: ScheduleBand = { id: 'open', name: 'Aberto', color: '#16a34a', open: true, behavior: 'normal', reply: 'message', items: [] };
  return {
    bands: [band],
    closed: { behavior: 'notify_continue', reply: 'message', items: [] },
    week: [0, 1, 2, 3, 4, 5, 6].map((d) => (d >= 1 && d <= 5 ? [{ id: `w${d}`, start: '08:00', end: '18:00', bandId: band.id }] : [])),
    exceptions: [],
  };
}

// ---------- datas locais ----------

const DAY = 1440;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "HH:MM" → minutos; inválido = NaN. */
export function hmToMinutes(hm: string): number {
  const m = HM.exec(hm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
export function minutesToHm(min: number): string {
  const m = ((min % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const ymdUtc = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmtYmd = (t: number) => new Date(t).toISOString().slice(0, 10);
export function addDays(ymd: string, n: number): string {
  return fmtYmd(ymdUtc(ymd) + n * 86_400_000);
}
export function weekdayOf(ymd: string): number {
  return new Date(ymdUtc(ymd)).getUTCDay();
}
export function isValidYmd(ymd: string): boolean {
  const m = YMD.exec(ymd ?? '');
  return !!m && fmtYmd(ymdUtc(ymd)) === ymd;
}

/** Ponto no relógio local do quadro. */
export interface LocalTime { ymd: string; minute: number }

// ---------- resolução ----------

interface Seg { from: number; to: number; bandId: string }

function intervalsOf(cfg: ScheduleConfig, ymd: string): ScheduleInterval[] {
  const ex = cfg.exceptions.find((e) => e.date === ymd);
  if (ex) return ex.closed ? [] : ex.intervals;
  return cfg.week[weekdayOf(ymd)] ?? [];
}

/** Trechos do dia vindos dos intervalos do próprio dia (o que passa da meia-noite é cortado aqui). */
function ownSegs(cfg: ScheduleConfig, ymd: string): Seg[] {
  return intervalsOf(cfg, ymd).flatMap((i) => {
    const s = hmToMinutes(i.start);
    const e = hmToMinutes(i.end);
    if (Number.isNaN(s) || Number.isNaN(e)) return [];
    return [{ from: s, to: e > s ? e : DAY, bandId: i.bandId }];
  });
}
/** Trechos do dia que vieram de intervalos do dia anterior que atravessam a meia-noite. */
function spillSegs(cfg: ScheduleConfig, ymd: string): Seg[] {
  return intervalsOf(cfg, addDays(ymd, -1)).flatMap((i) => {
    const s = hmToMinutes(i.start);
    const e = hmToMinutes(i.end);
    if (Number.isNaN(s) || Number.isNaN(e) || e > s) return [];
    // 00:00–00:00 / 08:00–08:00: 24h a partir do início → sobra `e` minutos no dia seguinte
    return e > 0 ? [{ from: 0, to: e, bandId: i.bandId }] : [];
  });
}

/** Id da faixa num ponto do relógio local (sem olhar "atendimento ativo"). */
export function bandIdAt(cfg: ScheduleConfig, t: LocalTime): string {
  const hit = (segs: Seg[]) => segs.find((s) => t.minute >= s.from && t.minute < s.to);
  const seg = hit(ownSegs(cfg, t.ymd)) ?? hit(spillSegs(cfg, t.ymd));
  // faixa apagada mas ainda referenciada: trata como fechado (a validação impede salvar assim)
  return seg && cfg.bands.some((b) => b.id === seg.bandId) ? seg.bandId : CLOSED_BAND_ID;
}

export function bandById(cfg: ScheduleConfig, id: string): ScheduleBand {
  return cfg.bands.find((b) => b.id === id) ?? closedBand(cfg);
}

/** Minutos do dia em que a faixa pode mudar. */
function boundaries(cfg: ScheduleConfig, ymd: string): number[] {
  const set = new Set<number>([0]);
  for (const s of [...ownSegs(cfg, ymd), ...spillSegs(cfg, ymd)]) {
    set.add(s.from);
    if (s.to < DAY) set.add(s.to);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Início do período atual da faixa: o momento em que ela começou a valer sem interrupção
 * (08:00–12:00 e 12:00–14:00 na mesma faixa são um período só; Fechado de sexta 22h a segunda
 * 08h também). Procura até `maxDays` para trás; não achou = faixa vale "desde sempre" (null).
 */
export function periodStartOf(cfg: ScheduleConfig, t: LocalTime, maxDays = 31): LocalTime | null {
  const band = bandIdAt(cfg, t);
  let ymd = t.ymd;
  let upTo = t.minute;
  for (let i = 0; i <= maxDays; i++) {
    const bs = boundaries(cfg, ymd).filter((b) => b <= upTo).reverse();
    for (const b of bs) {
      const before = b === 0 ? { ymd: addDays(ymd, -1), minute: DAY - 1 } : { ymd, minute: b - 1 };
      if (bandIdAt(cfg, before) !== band) return { ymd, minute: b };
    }
    ymd = addDays(ymd, -1);
    upTo = DAY - 1;
  }
  return null;
}

export interface ScheduleState {
  band: ScheduleBand;
  /** conta como horário de atendimento */
  open: boolean;
  /** início do período da faixa; null = sem início conhecido (faixa vale há mais de 31 dias) */
  periodStart: LocalTime | null;
  /**
   * Identifica o período: a resposta da faixa sai **uma vez por conversa** para cada chave.
   * Atendimento desativado vira um período próprio.
   */
  periodKey: string;
}

/**
 * Faixa valendo num ponto do relógio local. `attendanceActive: false` (botão de feriado/férias
 * em Configurações) força Fechado; `inactiveSince` diferencia um desligamento do outro.
 */
export function resolveSchedule(cfg: ScheduleConfig, t: LocalTime, opts?: { attendanceActive?: boolean; inactiveSince?: string }): ScheduleState {
  if (opts?.attendanceActive === false) {
    return { band: closedBand(cfg), open: false, periodStart: null, periodKey: `${CLOSED_BAND_ID}@off:${opts.inactiveSince ?? ''}` };
  }
  const band = bandById(cfg, bandIdAt(cfg, t));
  const periodStart = periodStartOf(cfg, t);
  const key = periodStart ? `${periodStart.ymd}T${minutesToHm(periodStart.minute)}` : 'always';
  return { band, open: band.id !== CLOSED_BAND_ID && band.open, periodStart, periodKey: `${band.id}@${key}` };
}

const bandOpen = (cfg: ScheduleConfig, t: LocalTime) => {
  const id = bandIdAt(cfg, t);
  return id !== CLOSED_BAND_ID && bandById(cfg, id).open;
};

/**
 * Primeiro ponto, a partir de `t`, em horário de atendimento (o próprio `t` se já estiver).
 * null = não abre nos próximos `maxDays` dias.
 */
export function nextOpenLocal(cfg: ScheduleConfig, t: LocalTime, maxDays = 14): LocalTime | null {
  if (bandOpen(cfg, t)) return t;
  let ymd = t.ymd;
  let after = t.minute;
  for (let i = 0; i <= maxDays; i++) {
    for (const b of boundaries(cfg, ymd)) {
      if (b <= after) continue;
      if (bandOpen(cfg, { ymd, minute: b })) return { ymd, minute: b };
    }
    ymd = addDays(ymd, 1);
    after = -1;
  }
  return null;
}

/**
 * Soma `minutes` contando só o tempo em horário de atendimento (tempo limite do Salvar/Menu
 * "só dentro do horário"). null = o horário não abre o suficiente em `maxDays`.
 */
export function addOpenMinutesLocal(cfg: ScheduleConfig, t: LocalTime, minutes: number, maxDays = 60): LocalTime | null {
  let left = Math.max(0, Math.round(minutes));
  let ymd = t.ymd;
  let pos = t.minute;
  for (let i = 0; i <= maxDays; i++) {
    const bs = boundaries(cfg, ymd);
    while (pos < DAY) {
      const nextB = bs.find((b) => b > pos) ?? DAY;
      if (bandOpen(cfg, { ymd, minute: pos })) {
        const take = Math.min(left, nextB - pos);
        left -= take;
        if (left === 0) return { ymd, minute: pos + take };
      }
      pos = nextB;
    }
    ymd = addDays(ymd, 1);
    pos = 0;
  }
  return null;
}

/** Normaliza o fim do dia (minuto 1440) para 00:00 do dia seguinte. */
export function normalizeLocal(t: LocalTime): LocalTime {
  return t.minute >= DAY ? { ymd: addDays(t.ymd, Math.floor(t.minute / DAY)), minute: t.minute % DAY } : t;
}

// ---------- validação ----------

export interface ScheduleIssue {
  /** onde mostrar: 'bands', 'closed', 'week.<dia>', 'exceptions.<id>' */
  path: string;
  message: string;
}

type Range = { from: number; to: number; label: string };
const rangeLabel = (i: ScheduleInterval) => `${i.start}–${i.end}`;

function overlaps(ranges: Range[]): [Range, Range] | null {
  const s = [...ranges].sort((a, b) => a.from - b.from);
  for (let i = 1; i < s.length; i++) if (s[i].from < s[i - 1].to) return [s[i - 1], s[i]];
  return null;
}

function checkIntervals(list: ScheduleInterval[], bandIds: Set<string>, where: string, path: string, issues: ScheduleIssue[]) {
  if (list.length > SCHEDULE_MAX_INTERVALS_PER_DAY) issues.push({ path, message: `${where}: no máximo ${SCHEDULE_MAX_INTERVALS_PER_DAY} intervalos.` });
  for (const i of list) {
    if (Number.isNaN(hmToMinutes(i.start)) || Number.isNaN(hmToMinutes(i.end))) issues.push({ path, message: `${where}: horário inválido (use HH:MM).` });
    else if (!bandIds.has(i.bandId)) issues.push({ path, message: `${where}: o intervalo ${rangeLabel(i)} está sem faixa.` });
  }
}

/** Trechos ocupados no dia (o que passa da meia-noite é cortado; `spill` = vindo do dia anterior). */
function dayRanges(list: ScheduleInterval[]): Range[] {
  return list.flatMap((i) => {
    const s = hmToMinutes(i.start);
    const e = hmToMinutes(i.end);
    return Number.isNaN(s) || Number.isNaN(e) ? [] : [{ from: s, to: e > s ? e : DAY, label: rangeLabel(i) }];
  });
}
function spillRanges(list: ScheduleInterval[]): Range[] {
  return list.flatMap((i) => {
    const s = hmToMinutes(i.start);
    const e = hmToMinutes(i.end);
    return Number.isNaN(s) || Number.isNaN(e) || e > s || e === 0 ? [] : [{ from: 0, to: e, label: `${rangeLabel(i)} (do dia anterior)` }];
  });
}

/**
 * Regras ao salvar (editor e API usam a mesma): faixas com nome único, resposta configurada,
 * intervalos válidos, **sem sobreposição no mesmo dia** (inclusive com o que vem da noite anterior).
 */
export function validateSchedule(cfg: ScheduleConfig): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  if (!cfg || !Array.isArray(cfg.bands) || !Array.isArray(cfg.week) || cfg.week.length !== 7 || !Array.isArray(cfg.exceptions) || !cfg.closed) {
    return [{ path: 'bands', message: 'Quadro de horários inválido.' }];
  }
  if (cfg.bands.length > SCHEDULE_MAX_BANDS) issues.push({ path: 'bands', message: `No máximo ${SCHEDULE_MAX_BANDS} faixas.` });
  const names = new Set<string>();
  const ids = new Set<string>();
  const reply = (b: Pick<ScheduleBand, 'behavior' | 'reply' | 'flowId'>, name: string, path: string) => {
    if (b.behavior !== 'normal' && b.reply === 'flow' && !b.flowId) issues.push({ path, message: `${name}: escolha o fluxo da resposta.` });
  };
  for (const b of cfg.bands) {
    const name = (b.name ?? '').trim();
    const key = name.toLowerCase();
    if (!name) issues.push({ path: 'bands', message: 'Toda faixa precisa de nome.' });
    else if (key === CLOSED_BAND_NAME.toLowerCase()) issues.push({ path: 'bands', message: '"Fechado" é a faixa fixa: escolha outro nome.' });
    else if (names.has(key)) issues.push({ path: 'bands', message: `Faixa "${name}" repetida.` });
    if (!b.id || b.id === CLOSED_BAND_ID || ids.has(b.id)) issues.push({ path: 'bands', message: `Faixa "${name}" com identificador inválido.` });
    names.add(key);
    ids.add(b.id);
    reply(b, name || 'Faixa', 'bands');
  }
  reply(cfg.closed, CLOSED_BAND_NAME, 'closed');

  cfg.week.forEach((list, d) => checkIntervals(list ?? [], ids, WEEKDAY_NAMES[d], `week.${d}`, issues));
  cfg.week.forEach((list, d) => {
    const prev = cfg.week[(d + 6) % 7] ?? [];
    const pair = overlaps([...dayRanges(list ?? []), ...spillRanges(prev)]);
    if (pair) issues.push({ path: `week.${d}`, message: `${WEEKDAY_NAMES[d]}: ${pair[0].label} e ${pair[1].label} se sobrepõem.` });
  });

  if (cfg.exceptions.length > SCHEDULE_MAX_EXCEPTIONS) issues.push({ path: 'exceptions', message: `No máximo ${SCHEDULE_MAX_EXCEPTIONS} exceções.` });
  const dates = new Set<string>();
  for (const ex of cfg.exceptions) {
    const path = `exceptions.${ex.id}`;
    const where = isValidYmd(ex.date) ? ex.date.split('-').reverse().join('/') : 'Exceção';
    if (!isValidYmd(ex.date)) issues.push({ path, message: 'Exceção com data inválida.' });
    else if (dates.has(ex.date)) issues.push({ path, message: `${where}: data repetida nas exceções.` });
    dates.add(ex.date);
    if (ex.closed) continue;
    checkIntervals(ex.intervals ?? [], ids, where, path, issues);
    const pair = overlaps(dayRanges(ex.intervals ?? []));
    if (pair) issues.push({ path, message: `${where}: ${pair[0].label} e ${pair[1].label} se sobrepõem.` });
  }
  return issues;
}

/** Variáveis disponíveis nas mensagens automáticas (boas-vindas e faixas), além de `{{contact.*}}`. */
export const AUTO_MESSAGE_VARS = [
  { key: 'faixa', label: 'Faixa de horário atual' },
  { key: 'proxima_abertura', label: 'Próxima abertura (ex.: "amanhã às 08:00")' },
] as const;

/** Texto da próxima abertura relativo a `now` (ambos no relógio local do quadro). */
export function describeNextOpen(now: LocalTime, next: LocalTime | null): string {
  if (!next) return '';
  const hm = minutesToHm(next.minute);
  if (next.ymd === now.ymd) return next.minute <= now.minute ? 'agora' : `hoje às ${hm}`;
  if (next.ymd === addDays(now.ymd, 1)) return `amanhã às ${hm}`;
  const diff = Math.round((ymdUtc(next.ymd) - ymdUtc(now.ymd)) / 86_400_000);
  if (diff < 7) return `${WEEKDAY_NAMES[weekdayOf(next.ymd)].toLowerCase()} às ${hm}`;
  return `${next.ymd.split('-').reverse().join('/')} às ${hm}`;
}

// ---------- boas-vindas ----------

export type WelcomeMode = 'random' | 'sequential';
export interface WelcomeMessage { id: string; items: ContentItem[] }

// ---------- faixas referenciadas nos fluxos ----------

/** Nome de faixa comparável: sem maiúsculas, acentos e espaços nas pontas (mesma regra da Condição). */
export function bandKey(name: string): string {
  return (name === CLOSED_BAND_ID ? CLOSED_BAND_NAME : name).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Faixas renomeadas entre duas versões de um quadro (mesmo id, nome diferente). `from`/`to` são
 * os nomes como estavam/ficaram.
 */
export function renamedBands(before: ScheduleConfig, after: ScheduleConfig): { from: string; to: string }[] {
  return after.bands.flatMap((b) => {
    const old = before.bands.find((x) => x.id === b.id);
    return old && old.name.trim() && b.name.trim() && bandKey(old.name) !== bandKey(b.name) ? [{ from: old.name.trim(), to: b.name.trim() }] : [];
  });
}

/**
 * Troca o nome da faixa nas regras "Faixa de horário atual" de um fluxo. Devolve a definição
 * nova (ou a mesma, se nada mudou) e quantas regras foram alteradas.
 */
export function renameBandInDefinition(def: FlowDefinition, from: string, to: string): { def: FlowDefinition; count: number } {
  let count = 0;
  const key = bandKey(from);
  const nodes = def.nodes.map((n) => {
    if (n.type !== 'condition' || !Array.isArray(n.data.branches)) return n;
    let changed = false;
    const branches = n.data.branches.map((b) => ({
      ...b,
      rules: (b.rules ?? []).map((r) => {
        if (r.operand !== 'schedule_band' || !r.band || bandKey(r.band) !== key) return r;
        changed = true;
        count++;
        return { ...r, band: to };
      }),
    }));
    return changed ? { ...n, data: { ...n.data, branches } } : n;
  });
  return count ? { def: { ...def, nodes } as FlowDefinition, count } : { def, count };
}
