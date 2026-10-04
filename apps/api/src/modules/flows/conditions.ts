import { bandKey, CONDITION_ELSE, CONDITION_OPERANDS, CONDITION_OPS, type ConditionBranch, type ConditionOperand, type ConditionRule } from '@atendo/shared';
import { interpolate, type InterpolateCtx } from './answer';

/**
 * Avaliador da Condição. Isolado (sem Nest/Prisma): o que precisa de banco ou de
 * configuração do cliente chega como função preguiçosa em `RuleEnv`, chamada só quando
 * uma regra usa aquele operando.
 */
export interface RuleEnv extends InterpolateCtx {
  now: Date;
  /** fuso do cliente (data/hora atual é sempre no fuso dele) */
  timezone: () => Promise<string>;
  /** texto da última mensagem recebida do contato */
  lastMessage: () => Promise<string>;
  hasTag: (tagId: string) => Promise<boolean>;
  isOpen: (hours?: ConditionRule['hours']) => Promise<boolean>;
  /** nome da faixa de horário atual do quadro da conversa ("Fechado" fora de qualquer intervalo) */
  currentBand: () => Promise<string>;
}

/** O que um operando entrega para os comparadores. */
type OperandValue = { kind: 'text'; value: string } | { kind: 'datetime'; weekday: number; minutes: number } | { kind: 'flag'; value: boolean };

/**
 * Registro de operandos. Operando novo = uma entrada aqui (+ o tipo no shared); os
 * comparadores já existentes servem para ele conforme o `kind` que devolver.
 */
const OPERANDS: Record<ConditionOperand, (rule: ConditionRule, env: RuleEnv) => Promise<OperandValue>> = {
  var: async (r, env) => ({ kind: 'text', value: env.vars[r.key ?? ''] ?? '' }),
  contact: async (r, env) => ({ kind: 'text', value: interpolate(`{{contact.${r.key ?? ''}}}`, env) }),
  message: async (_r, env) => ({ kind: 'text', value: await env.lastMessage() }),
  now: async (_r, env) => ({ kind: 'datetime', ...clockAt(env.now, await env.timezone()) }),
  tag: async (r, env) => ({ kind: 'flag', value: r.tagId ? await env.hasTag(r.tagId) : false }),
  business_hours: async (r, env) => ({ kind: 'flag', value: await env.isOpen(r.hours) }),
  schedule_band: async (r, env) => ({ kind: 'flag', value: !!r.band && sameBand(r.band, await env.currentBand()) }),
};

/** Faixa pelo nome, sem diferenciar maiúsculas/acentos; `closed` = Fechado. */
function sameBand(wanted: string, current: string) {
  return bandKey(wanted) === bandKey(current);
}

/** Remove acentos e caixa: "São Paulo" e "sao paulo" comparam iguais. */
export function fold(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Aceita "10,5" e "1.234,56" (pt-BR) além de "10.5". Vazio/inválido = NaN. */
export function toNumber(s: string) {
  const t = s.trim();
  if (!t) return NaN;
  const n = /,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  return Number(n);
}

/** "HH:MM" → minutos do dia; inválido = NaN. */
export function hhmm(s: string | undefined) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : NaN;
}

/** Dia da semana (0 = domingo) e minutos do dia no fuso informado. */
export function clockAt(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function compareText(rule: ConditionRule, raw: string, env: RuleEnv): boolean {
  const norm = (s: string) => (rule.caseSensitive ? s.trim() : fold(s.trim()));
  const a = norm(raw);
  const b = norm(interpolate(rule.value ?? '', env));
  switch (rule.op) {
    case 'eq': return a === b;
    case 'neq': return a !== b;
    case 'contains': return a.includes(b);
    case 'not_contains': return !a.includes(b);
    case 'starts_with': return a.startsWith(b);
    case 'ends_with': return a.endsWith(b);
    case 'empty': return a === '';
    case 'not_empty': return a !== '';
  }
  // numéricos: qualquer lado que não for número torna a regra falsa
  const x = toNumber(raw);
  const y = toNumber(interpolate(rule.value ?? '', env));
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  switch (rule.op) {
    case 'num_eq': return x === y;
    case 'num_neq': return x !== y;
    case 'gt': return x > y;
    case 'gte': return x >= y;
    case 'lt': return x < y;
    case 'lte': return x <= y;
  }
  return false;
}

function compareDatetime(rule: ConditionRule, v: { weekday: number; minutes: number }): boolean {
  if (rule.op === 'weekday_in') return (rule.days ?? []).includes(v.weekday);
  if (rule.op === 'time_between') {
    const from = hhmm(rule.from);
    const to = hhmm(rule.to);
    if (Number.isNaN(from) || Number.isNaN(to)) return false;
    // 22:00–06:00 atravessa a meia-noite
    return from <= to ? v.minutes >= from && v.minutes < to : v.minutes >= from || v.minutes < to;
  }
  return false;
}

export async function evaluateRule(rule: ConditionRule, env: RuleEnv): Promise<boolean> {
  const resolve = OPERANDS[rule.operand];
  if (!resolve) return false; // operando desconhecido (fluxo de versão mais nova): não casa
  const v = await resolve(rule, env);
  if (v.kind === 'text') return compareText(rule, v.value, env);
  if (v.kind === 'datetime') return compareDatetime(rule, v);
  return rule.op === 'is_false' ? !v.value : rule.op === 'is_true' ? v.value : false;
}

/** E/OU do ramo. Ramo sem regras nunca é escolhido. Avalia em curto-circuito, em ordem. */
export async function evaluateBranch(branch: ConditionBranch, env: RuleEnv): Promise<boolean> {
  if (!branch.rules?.length) return false;
  if (branch.match === 'any') {
    for (const r of branch.rules) if (await evaluateRule(r, env)) return true;
    return false;
  }
  for (const r of branch.rules) if (!(await evaluateRule(r, env))) return false;
  return true;
}

/** Saída escolhida: id do primeiro ramo verdadeiro, senão `CONDITION_ELSE`. */
export async function pickBranch(branches: ConditionBranch[], env: RuleEnv): Promise<string> {
  for (const b of branches) if (await evaluateBranch(b, env)) return b.id;
  return CONDITION_ELSE;
}

/** Comparadores válidos para o operando (usado na validação ao salvar). */
export function opFitsOperand(rule: ConditionRule) {
  const meta = CONDITION_OPERANDS[rule.operand];
  return !!meta && CONDITION_OPS[meta.kind].some((o) => o.op === rule.op);
}
