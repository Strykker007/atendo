'use client';
import { useState } from 'react';
import { Crown, Gem, Hourglass, Plus, Rocket, ShieldCheck, Star, Trash2, Zap, type LucideIcon } from 'lucide-react';
import { partnerRank, type PartnerRankKey, type PartnerTierRule } from '@atendo/shared';
import { Button } from '@/components/ui/Button';
import { Field, Modal, inputCls } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
export const dataBR = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
export const dataHoraBR = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');
export const tabCls = (on: boolean) => cn('h-8 px-3 rounded-md font-medium whitespace-nowrap', on ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink');
export const cardCls = 'rounded-2xl border border-line bg-panel';

/** Faixas em texto: "20% · 25% a partir de 75 clientes". */
export function tiersText(tiers: PartnerTierRule[]) {
  if (!tiers.length) return 'sem faixa';
  return [...tiers].sort((a, b) => a.minClients - b.minClients).map((t) => (t.minClients === 0 ? pct(t.rate) : `${pct(t.rate)} a partir de ${t.minClients}`)).join(' · ');
}

// ---------- Patentes (Vogo Start → Pro → Prime → Elite → Legend) ----------

const RANK_ICON: Record<PartnerRankKey, LucideIcon> = { pending: Hourglass, start: Rocket, pro: Star, prime: Zap, elite: Gem, legend: Crown };
const rankCls = (key: PartnerRankKey) => (key === 'legend' ? 'bg-ok-soft text-ok' : key === 'pending' ? 'bg-field text-muted' : 'bg-accent-soft text-accent-ink');
const clientes = (n: number) => `${n} cliente${n === 1 ? '' : 's'} ativo${n === 1 ? '' : 's'}`;

/** Selo da patente: ícone + nome. */
export function RankBadge({ rankKey, name, size = 'sm' }: { rankKey: PartnerRankKey; name: string; size?: 'sm' | 'md' }) {
  const Icon = RANK_ICON[rankKey];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap', rankCls(rankKey), size === 'md' ? 'px-2.5 py-1 text-[13px]' : 'px-2 py-0.5 text-[11.5px]')}>
      <Icon size={size === 'md' ? 14 : 12} aria-hidden /> {name}
    </span>
  );
}

/** Frase de quanto falta: "Faltam 3 clientes ativos para Vogo Prime (25%)". */
export function rankNextText(tiers: PartnerTierRule[], activeClients: number) {
  const r = partnerRank(tiers, activeClients);
  if (!r.next) return r.ladder.length > 1 ? 'No topo do programa' : 'Faixa única';
  return `Falta${r.next.missing === 1 ? '' : 'm'} ${clientes(r.next.missing)} para ${r.next.name} (${pct(r.next.rate)})`;
}

/** Linha compacta para tabela: selo + % de hoje + barrinha e quanto falta. */
export function RankCompact({ tiers, activeClients }: { tiers: PartnerTierRule[]; activeClients: number }) {
  const r = partnerRank(tiers, activeClients);
  return (
    <div className="space-y-1 min-w-[11rem]">
      <div className="flex items-center gap-1.5"><RankBadge rankKey={r.current.key} name={r.current.name} /><span className="font-medium tnum">{pct(r.current.rate)}</span></div>
      {r.next && <div className="h-1 rounded-full bg-field overflow-hidden" aria-hidden><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(r.progress * 100)}%` }} /></div>}
      <p className="text-[11px] text-faint">{rankNextText(tiers, activeClients)}</p>
    </div>
  );
}

/**
 * Cartão completo: patente atual, barra até a próxima e a escada inteira (cada degrau com o
 * mínimo de clientes ativos e o %). `voce` troca o texto para o portal do parceiro.
 */
export function RankCard({ tiers, activeClients, voce }: { tiers: PartnerTierRule[]; activeClients: number; voce?: boolean }) {
  const r = partnerRank(tiers, activeClients);
  return (
    <section className={cn(cardCls, 'p-4 space-y-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[12px] text-muted">{voce ? 'Sua patente' : 'Patente'}</p>
          <div className="flex items-center gap-2"><RankBadge rankKey={r.current.key} name={r.current.name} size="md" /><span className="text-lg font-semibold tnum">{pct(r.current.rate)}</span><span className="text-[12px] text-muted">da mensalidade</span></div>
          <p className="text-[12px] text-faint">{r.current.motto}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold tnum">{clientes(activeClients)}</p>
          {r.next && <p className="text-[12px] text-muted">próximo degrau com {r.next.minClients}</p>}
        </div>
      </div>
      {r.next ? (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[12px]">
            <span className="text-ink font-medium">{rankNextText(tiers, activeClients)}</span>
            <span className="text-muted tnum">{activeClients}/{r.next.minClients}</span>
          </div>
          <div className="h-2 rounded-full bg-field overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)}>
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(r.progress * 100)}%` }} />
          </div>
          <p className="text-[11.5px] text-faint">{voce ? 'Ao chegar lá, o novo % vale para todos os seus clientes no mês.' : 'Ao chegar lá, o novo % vale para todos os clientes dele no mês.'}</p>
        </div>
      ) : r.ladder.length > 1 && <p className="text-[12px] text-ok font-medium">{voce ? 'Você é Vogo Legend: a maior faixa do programa.' : 'Vogo Legend: está na maior faixa.'}</p>}
      {r.ladder.length > 1 && (
        <ol className="flex gap-1.5 overflow-x-auto pb-1">
          {r.ladder.map((s, i) => {
            const Icon = RANK_ICON[s.key];
            const feito = i <= r.level;
            return (
              <li key={i} className={cn('flex-1 min-w-[5.5rem] rounded-xl border px-2.5 py-2 text-[11.5px]', i === r.level ? 'border-accent bg-accent-soft' : feito ? 'border-line bg-field/60' : 'border-dashed border-line')}>
                <p className={cn('flex items-center gap-1 font-medium', feito ? 'text-ink' : 'text-muted')}><Icon size={12} aria-hidden /> {s.name}</p>
                <p className="tnum text-ink">{pct(s.rate)}</p>
                <p className="text-faint">{s.minClients === 0 ? 'desde o início' : `${s.minClients}+ ativos`}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <div className={cn(cardCls, 'p-4 min-w-0')}>
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn('text-xl font-semibold tnum truncate', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn-ink')}>{value}</p>
      {hint && <p className="text-[11.5px] text-faint mt-0.5">{hint}</p>}
    </div>
  );
}

/** Editor de faixas: "com N clientes ou mais, X%". */
export function TiersEditor({ value, onChange }: { value: PartnerTierRule[]; onChange: (v: PartnerTierRule[]) => void }) {
  const set = (i: number, patch: Partial<PartnerTierRule>) => onChange(value.map((t, n) => (n === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-2">
      {value.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Com</span>
          <input type="number" min={0} step={1} className={cn(inputCls, 'w-24')} value={t.minClients} onChange={(e) => set(i, { minClients: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label="Clientes ativos a partir de" />
          <span className="text-muted">clientes ativos ou mais:</span>
          <input type="number" min={0} max={100} step={0.5} className={cn(inputCls, 'w-24')} value={t.rate} onChange={(e) => set(i, { rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} aria-label="Percentual" />
          <span className="text-muted">% da mensalidade</span>
          <button type="button" onClick={() => onChange(value.filter((_, n) => n !== i))} className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-field" title="Remover faixa" aria-label="Remover faixa"><Trash2 size={14} /></button>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => onChange([...value, { minClients: value.length ? Math.max(...value.map((t) => t.minClients)) + 25 : 0, rate: value.length ? value[value.length - 1].rate : 20 }])}>Adicionar faixa</Button>
      <p className="text-[11.5px] text-faint">A maior faixa alcançada vale para todos os clientes do parceiro naquele mês. Abaixo da primeira faixa, 0%.</p>
    </div>
  );
}

/** Pede o código de 6 dígitos do autenticador antes de uma ação sensível. */
export function CodeDialog({ open, title, children, confirmLabel = 'Confirmar', busy, onConfirm, onClose }: {
  open: boolean; title: string; children?: React.ReactNode; confirmLabel?: string; busy?: boolean;
  onConfirm: (code: string) => void | Promise<unknown>; onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const ok = /^\d{6}$/.test(code);
  return (
    <Modal open={open} onClose={() => { setCode(''); onClose(); }} title={title}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ok) void Promise.resolve(onConfirm(code)).finally(() => setCode('')); }}>
        {children}
        <Field label="Código do autenticador" hint="Os 6 dígitos que aparecem agora no app (Google Authenticator, Authy…). Cada código vale uma vez.">
          <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={cn(inputCls, 'tracking-[0.4em] text-center text-lg font-mono')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => { setCode(''); onClose(); }}>Cancelar</Button>
          <Button type="submit" icon={<ShieldCheck size={14} />} disabled={!ok} loading={busy}>{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
