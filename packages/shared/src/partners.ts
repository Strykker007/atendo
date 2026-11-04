/**
 * VogoPartners (docs/37-vogopartners.md): regras puras usadas pela API e pela tela.
 *
 * - Mensalidade: % por FAIXA de clientes ativos (ex.: 0+ → 20%, 75+ → 25%). A faixa alcançada vale
 *   para todos os clientes do parceiro naquele mês. Paga por mês.
 * - Instalação: % fixo (padrão do programa ou do parceiro). Paga por semana.
 */

export interface PartnerTierRule { minClients: number; rate: number }

export type PartnerCommissionKind = 'recurring' | 'setup';
export const PARTNER_KIND_LABEL: Record<PartnerCommissionKind, string> = { recurring: 'Mensalidades', setup: 'Instalações' };

export type PartnerStatus = 'active' | 'suspended' | 'ended';
export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = { active: 'Ativo', suspended: 'Suspenso', ended: 'Encerrado' };

export type PartnerPayoutStatus = 'draft' | 'awaiting_second' | 'approved' | 'processing' | 'paid' | 'failed';
export const PARTNER_PAYOUT_STATUS_LABEL: Record<PartnerPayoutStatus, string> = {
  draft: 'Apurado',
  awaiting_second: 'Falta 2ª autorização',
  approved: 'Autorizado',
  processing: 'Enviando Pix',
  paid: 'Pago',
  failed: 'Falhou',
};

/** Tipos de chave Pix aceitos pelo Asaas na transferência. */
export const PAYOUT_PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'] as const;
export type PayoutPixKeyType = (typeof PAYOUT_PIX_KEY_TYPES)[number];
export const PAYOUT_PIX_KEY_TYPE_LABEL: Record<PayoutPixKeyType, string> = { CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'E-mail', PHONE: 'Telefone', EVP: 'Chave aleatória' };

/** Normaliza e valida a chave pelo tipo. Devolve null quando não serve. */
export function normalizePayoutPixKey(type: PayoutPixKeyType, raw: string): string | null {
  const v = raw.trim();
  switch (type) {
    case 'CPF': { const d = v.replace(/\D/g, ''); return d.length === 11 ? d : null; }
    case 'CNPJ': { const d = v.replace(/\D/g, ''); return d.length === 14 ? d : null; }
    case 'EMAIL': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
    case 'PHONE': {
      // o Asaas espera DDD + número (sem +55)
      let d = v.replace(/\D/g, '');
      if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
      return d.length === 10 || d.length === 11 ? d : null;
    }
    case 'EVP': return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;
  }
}

/** Faixas em ordem crescente, sem `minClients` repetido. */
export function sortTiers(tiers: PartnerTierRule[]): PartnerTierRule[] {
  return [...tiers].sort((a, b) => a.minClients - b.minClients);
}

/** % da mensalidade para quem tem `activeClients`: a maior faixa alcançada (sem faixa alcançada = 0). */
export function tierRate(tiers: PartnerTierRule[], activeClients: number): number {
  let rate = 0;
  for (const t of sortTiers(tiers)) if (activeClients >= t.minClients) rate = t.rate;
  return rate;
}

/** Próxima faixa (para o parceiro ver quanto falta), ou null se já está na última. */
export function nextTier(tiers: PartnerTierRule[], activeClients: number): (PartnerTierRule & { missing: number }) | null {
  const t = sortTiers(tiers).find((x) => x.minClients > activeClients);
  return t ? { ...t, missing: t.minClients - activeClients } : null;
}

/**
 * Patentes dos VogoPartners: Vogo Start → Pro → Prime → Elite → Legend. A patente é a POSIÇÃO na
 * escada de faixas do próprio parceiro (as faixas são personalizáveis), não um número fixo de
 * clientes: a primeira faixa é sempre Start e a última, sempre Legend.
 */
export const PARTNER_RANKS = [
  { key: 'start', name: 'Vogo Start', motto: 'o começo da jornada como parceiro' },
  { key: 'pro', name: 'Vogo Pro', motto: 'carteira em crescimento' },
  { key: 'prime', name: 'Vogo Prime', motto: 'parceiro de destaque' },
  { key: 'elite', name: 'Vogo Elite', motto: 'entre os maiores da rede' },
] as const;
export const PARTNER_RANK_TOP = { key: 'legend', name: 'Vogo Legend', motto: 'o topo do programa' } as const;
export const PARTNER_RANK_DOCK = { key: 'pending', name: 'Em ativação', motto: 'falta alcançar a primeira faixa' } as const;
export type PartnerRankKey = (typeof PARTNER_RANKS)[number]['key'] | 'legend' | 'pending';

export interface PartnerRankStep { key: PartnerRankKey; name: string; motto: string; minClients: number; rate: number }

/** Escada de patentes das faixas do parceiro (ordem crescente). */
export function partnerRankLadder(tiers: PartnerTierRule[]): PartnerRankStep[] {
  const ts = sortTiers(tiers);
  return ts.map((t, i) => {
    const r = ts.length > 1 && i === ts.length - 1 ? PARTNER_RANK_TOP : PARTNER_RANKS[Math.min(i, PARTNER_RANKS.length - 1)];
    // mais de 5 faixas: as do meio repetem Elite com número (Vogo Elite 2, Vogo Elite 3…)
    const extra = i >= PARTNER_RANKS.length && r !== PARTNER_RANK_TOP ? ` ${i - PARTNER_RANKS.length + 2}` : '';
    return { key: r.key, name: r.name + extra, motto: r.motto, minClients: t.minClients, rate: t.rate };
  });
}

export interface PartnerRank {
  current: PartnerRankStep;
  next: (PartnerRankStep & { missing: number }) | null;
  /** 0–1: caminho percorrido entre a patente atual e a próxima */
  progress: number;
  ladder: PartnerRankStep[];
  /** posição na escada (-1 = Em ativação) */
  level: number;
}

export function partnerRank(tiers: PartnerTierRule[], activeClients: number): PartnerRank {
  const ladder = partnerRankLadder(tiers);
  let level = -1;
  ladder.forEach((s, i) => { if (activeClients >= s.minClients) level = i; });
  const current: PartnerRankStep = level >= 0 ? ladder[level] : { ...PARTNER_RANK_DOCK, minClients: 0, rate: 0 };
  const nxt = ladder[level + 1];
  const next = nxt ? { ...nxt, missing: nxt.minClients - activeClients } : null;
  const from = level >= 0 ? current.minClients : 0;
  const progress = !next ? 1 : Math.max(0, Math.min(1, (activeClients - from) / Math.max(1, next.minClients - from)));
  return { current, next, progress, ladder, level };
}

/** Arredonda para centavos (meio para cima). */
export const cents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Comissão de uma linha: base × % / 100, em centavos. */
export const commissionOf = (base: number, rate: number) => cents((base * rate) / 100);

// ---- ciclos (horário de Brasília) ----

/** Data (`AAAA-MM-DD`) no horário de Brasília. */
const ymdSP = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Mês `AAAA-MM` de uma data, em Brasília. */
export const monthPeriodOf = (d: Date) => ymdSP(d).slice(0, 7);

/** Semana ISO `AAAA-Wss` (segunda a domingo) de uma data, em Brasília. */
export function weekPeriodOf(d: Date): string {
  const [y, m, day] = ymdSP(d).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  const dow = t.getUTCDay() || 7; // segunda = 1 … domingo = 7
  t.setUTCDate(t.getUTCDate() + 4 - dow); // quinta-feira da semana decide o ano ISO
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Segunda e domingo (`AAAA-MM-DD`) de uma semana ISO `AAAA-Wss`. */
export function weekRange(period: string): { start: string; end: string } {
  const [y, w] = period.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { start: f(monday), end: f(sunday) };
}

/** O ciclo já terminou (só ciclo terminado é apurado e pago). */
export function periodEnded(kind: PartnerCommissionKind, period: string, now = new Date()): boolean {
  return kind === 'recurring' ? period < monthPeriodOf(now) : weekRange(period).end < ymdSP(now);
}

/** Último ciclo terminado de cada tipo (o que o financeiro paga agora). */
export function lastClosedPeriod(kind: PartnerCommissionKind, now = new Date()): string {
  if (kind === 'recurring') {
    const [y, m] = monthPeriodOf(now).split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  return weekPeriodOf(new Date(now.getTime() - 7 * 86_400_000));
}

/** Mês de competência no fechamento: o próprio mês, ou o mês do domingo da semana. */
export const competenceMonth = (kind: PartnerCommissionKind, period: string) => (kind === 'recurring' ? period : weekRange(period).end.slice(0, 7));

/** "novembro de 2026" / "semana 02/11 a 08/11/2026". */
export function periodLabel(kind: PartnerCommissionKind, period: string): string {
  if (kind === 'recurring') {
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const { start, end } = weekRange(period);
  const br = (s: string) => s.split('-').reverse().join('/');
  return `semana ${br(start).slice(0, 5)} a ${br(end)}`;
}
