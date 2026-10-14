'use client';
import { useEffect, useState } from 'react';
import { OVERRIDABLE_LIMITS, OVERRIDABLE_LIMIT_LABEL, PLAN_FEATURES, PLAN_FEATURE_LABEL, type OverridableLimit, type PlanFeature, type PlanLimits, type PlanLimitsOverride } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { usePlanOverride, useSavePlanOverride, useDeletePlanOverride, usePromotions, useApplyPromotion } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** "AAAA-MM-DD" no horário de Brasília (o input de data e a API falam assim). */
const diaSP = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Valor do plano para leitura: ausente nos limites de quantidade = ilimitado; conversas ausentes = 0. */
function valorDoPlano(limits: PlanLimits, k: OverridableLimit): string {
  const v = limits[k];
  if (k === 'includedConversationsMonth' && v === undefined) return '0';
  if (k === 'includedAiInteractionsMonth') return String(v ?? 0);
  return v == null ? 'Ilimitado' : Number(v).toLocaleString('pt-BR');
}

/**
 * Personalizar o plano de UM cliente (só o dono): valor, limites e vigência por cima do plano
 * base. Ver docs/05-planos-e-cobranca.md#personalização-por-cliente.
 */
export function PlanOverrideDialog({ tenantId, tenantName, onClose }: { tenantId: string; tenantName: string; onClose: () => void }) {
  const q = usePlanOverride(tenantId);
  const save = useSavePlanOverride(tenantId);
  const del = useDeletePlanOverride(tenantId);
  const promos = usePromotions();
  const aplicar = useApplyPromotion(tenantId);
  const [promoId, setPromoId] = useState('');
  const [preco, setPreco] = useState('');
  /** texto do % enquanto o dono digita nele; null = calculado a partir do valor */
  const [pctTexto, setPctTexto] = useState<string | null>(null);
  const [lim, setLim] = useState<PlanLimitsOverride>({});
  const [comFeatures, setComFeatures] = useState(false);
  const [features, setFeatures] = useState<PlanFeature[]>([]);
  const [ate, setAte] = useState('');
  const [notes, setNotes] = useState('');
  const [pronto, setPronto] = useState(false);

  // carrega o que já existe uma vez (refetch não pode apagar o que o dono está digitando)
  useEffect(() => {
    if (!q.data || pronto) return;
    const o = q.data.override;
    const base = q.data.subscription?.plan.limits;
    if (o) {
      setPreco(o.priceMonth != null ? String(o.priceMonth).replace('.', ',') : '');
      const { features: f, ...resto } = o.limits;
      setLim(resto);
      setComFeatures(!!f);
      setFeatures(f ?? base?.features ?? []);
      setAte(o.expiresAt ? diaSP(o.expiresAt) : '');
      setNotes(o.notes ?? '');
    } else setFeatures(base?.features ?? []);
    setPronto(true);
  }, [q.data, pronto]);

  const sub = q.data?.subscription;
  const o = q.data?.override;
  const plano = sub?.plan;
  const stripe = sub?.gateway === 'stripe';
  // percentual equivalente ao valor digitado (e vice-versa): mudar um recalcula o outro
  const valorDigitado = Number(preco.trim().replace(/\./g, '').replace(',', '.'));
  const pct = pctTexto ?? (plano && preco.trim() && valorDigitado > 0 && valorDigitado < plano.priceMonth ? String(Math.round((1 - valorDigitado / plano.priceMonth) * 10000) / 100).replace('.', ',') : '');
  function aplicarPct(texto: string) {
    setPctTexto(texto);
    const v = Number(texto.replace(',', '.'));
    if (!plano || !texto.trim()) return setPreco('');
    if (!Number.isFinite(v) || v <= 0 || v >= 100) return;
    setPreco((Math.round(plano.priceMonth * (1 - v / 100) * 100) / 100).toFixed(2).replace('.', ','));
  }

  async function salvar() {
    const texto = preco.trim().replace(/\./g, '').replace(',', '.');
    const priceMonth = texto ? Number(texto) : null;
    if (priceMonth !== null && (!Number.isFinite(priceMonth) || priceMonth <= 0)) return toast.err(new Error('Valor inválido.'));
    try {
      await save.mutateAsync({ priceMonth, limits: { ...lim, ...(comFeatures && { features }) }, expiresAt: ate || null, notes: notes.trim() || null });
      toast.ok('Plano personalizado');
      onClose();
    } catch (err) { toast.err(err); }
  }
  async function aplicarPromocao() {
    const p = promos.data?.find((x) => x.id === promoId);
    if (!p) return;
    if (o && !confirm(`Aplicar "${p.name}" substitui a personalização atual (valor, limites e vigência). Continuar?`)) return;
    try {
      await aplicar.mutateAsync(p.id);
      toast.ok(`Promoção ${p.name} aplicada`);
      setPromoId('');
      setPctTexto(null);
      setPronto(false); // recarrega o formulário com o que a promoção gravou
    } catch (err) { toast.err(err); }
  }
  async function remover() {
    if (!confirm('Remover a personalização? Limites voltam aos do plano na hora e o valor volta ao de tabela.')) return;
    try { await del.mutateAsync(); toast.ok('Personalização removida'); onClose(); } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title={`Personalizar plano — ${tenantName}`} width="max-w-2xl">
      {q.isLoading && <SkeletonRows rows={4} />}
      {q.data && !sub && <p className="text-sm text-muted">Cliente sem assinatura: escolha um plano antes de personalizar.</p>}
      {q.data && sub && plano && (
        <form onSubmit={(e) => { e.preventDefault(); void salvar(); }} className="space-y-4">
          <div className="rounded-lg bg-field px-3 py-2 text-[13px] text-muted">
            Plano base: <b className="text-ink">{plano.name}</b> · {plano.isFree ? 'Gratuito' : `${brl(plano.priceMonth)}/mês`}
            {sub.units > 1 && <> · grupo × {sub.units}</>}
            <div className="text-[12px] mt-0.5">Vale só enquanto o cliente estiver neste plano. Trocar de plano desliga a personalização; voltar a ele religa (se ainda estiver na vigência).</div>
          </div>
          {o && !q.data.active && (
            <div className="rounded-lg bg-warn-soft text-warn-ink px-3 py-2 text-[13px]">
              {q.data.inactiveReason === 'expired'
                ? `Personalização expirada em ${new Date(o.expiresAt!).toLocaleDateString('pt-BR')} — o cliente está com valor e limites do plano. Salve com uma data nova para reativar.`
                : 'Personalização feita para outro plano — não vale no plano atual. Salvar aqui passa a valer para este plano.'}
            </div>
          )}

          {/* promoção só para este cliente: exceção do dono — vale fora da janela e do plano da promoção */}
          {!plano.isFree && !stripe && !!promos.data?.length && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line px-3 py-2">
              <Field label="Aplicar promoção a este cliente" hint="O desconto vale sobre o preço deste plano por N meses a partir de hoje, mesmo que a promoção já tenha terminado ou seja de outro plano. Fica registrado no Financeiro.">
                <select className={cn(inputCls, 'sm:w-80')} value={promoId} onChange={(e) => setPromoId(e.target.value)}>
                  <option value="">Escolha…</option>
                  {promos.data.map((p) => {
                    const preco = Math.round(plano.priceMonth * (1 - p.discountPercent / 100) * 100) / 100;
                    return <option key={p.id} value={p.id}>{p.name} · {p.discountPercent.toLocaleString('pt-BR')}% por {p.durationMonths}m → {brl(preco)}{!p.isActive || new Date(p.endsAt) <= new Date() ? ' (encerrada)' : ''}</option>;
                  })}
                </select>
              </Field>
              <Button type="button" size="sm" className="mb-5" disabled={!promoId} loading={aplicar.isPending} onClick={() => void aplicarPromocao()}>Aplicar</Button>
            </div>
          )}
          {o?.promotion && (
            <div className="rounded-lg bg-accent-soft text-accent-ink px-3 py-2 text-[13px]">Veio da promoção <b>{o.promotion.name}</b>. Editar aqui muda só este cliente.</div>
          )}
          <div className="grid sm:grid-cols-2 gap-3 items-start">
            <Field
              label="Mensalidade personalizada"
              hint={plano.isFree ? 'Plano gratuito não tem mensalidade.' : stripe ? 'Assinatura no Stripe: o valor é o do catálogo. Personalize só os limites.' : `Vazio = ${brl(plano.priceMonth)} do plano.${plano.billingCycle === 'yearly' ? ' Plano anual: informe o equivalente mensal (cobra × 12).' : ''}${sub.units > 1 ? ' Por empresa (× unidades).' : ''}${sub.gateway === 'asaas' ? ' Vai para o Asaas nas próximas cobranças.' : ''}`}
            >
              <div className="flex items-center gap-2">
                <input className={cn(inputCls, (plano.isFree || stripe) && 'opacity-50')} inputMode="decimal" placeholder={plano.isFree ? '—' : String(plano.priceMonth).replace('.', ',')} value={preco} onChange={(e) => { setPreco(e.target.value); setPctTexto(null); }} disabled={plano.isFree || stripe} />
                {/* atalho: digita o desconto e o valor sai do preço do plano; o que fica gravado é o valor */}
                <div className={cn('flex items-center gap-1 shrink-0', (plano.isFree || stripe) && 'opacity-50')} title="Desconto sobre o preço do plano">
                  <input className={cn(inputCls, 'w-16 text-right')} inputMode="decimal" placeholder="0" value={pct} disabled={plano.isFree || stripe} onChange={(e) => aplicarPct(e.target.value)} aria-label="Desconto em %" />
                  <span className="text-[13px] text-muted">% off</span>
                </div>
              </div>
            </Field>
            <Field label="Vigência" hint={ate ? 'Vale até o fim deste dia (horário de Brasília). Depois, valor e limites do plano voltam sozinhos.' : 'Sem data: vale enquanto o cliente estiver neste plano.'}>
              <div className="flex items-center gap-2">
                <input type="date" className={cn(inputCls, 'sm:w-48')} value={ate} min={diaSP(new Date().toISOString())} onChange={(e) => setAte(e.target.value)} />
                {ate && <Button type="button" size="sm" variant="ghost" onClick={() => setAte('')}>Sem data</Button>}
              </div>
            </Field>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Limites</div>
            <div className="rounded-lg border border-line divide-y divide-line">
              {OVERRIDABLE_LIMITS.map((k) => {
                const on = k in lim;
                const v = lim[k];
                const ilimitado = on && v === null;
                const semIlimitado = k === 'includedAiInteractionsMonth';
                return (
                  <div key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                    <label className="flex items-center gap-2 min-w-[14rem] flex-1">
                      <input type="checkbox" checked={on} onChange={(e) => setLim((l) => { const n = { ...l }; if (e.target.checked) n[k] = plano.limits[k] ?? (semIlimitado ? 0 : null); else delete n[k]; return n; })} />
                      <span className={cn(on ? 'text-ink' : 'text-muted')}>{OVERRIDABLE_LIMIT_LABEL[k]}</span>
                    </label>
                    <span className="text-[12px] text-faint w-28">plano: {valorDoPlano(plano.limits, k)}</span>
                    {on ? (
                      <div className="flex items-center gap-2">
                        <input className={cn(inputCls, 'w-28 py-1', ilimitado && 'opacity-50')} inputMode="numeric" disabled={ilimitado} value={ilimitado ? '∞' : String(v ?? 0)} onChange={(e) => setLim((l) => ({ ...l, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 }))} />
                        {!semIlimitado && (
                          <label className="flex items-center gap-1 text-[12px] text-muted">
                            <input type="checkbox" checked={ilimitado} onChange={(e) => setLim((l) => ({ ...l, [k]: e.target.checked ? null : 0 }))} /> Ilimitado
                          </label>
                        )}
                      </div>
                    ) : <span className="text-[12px] text-faint w-[10.5rem]">herda do plano</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-[13px] mb-2">
              <input type="checkbox" checked={comFeatures} onChange={(e) => setComFeatures(e.target.checked)} />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Personalizar funcionalidades</span>
            </label>
            {comFeatures && (
              <div className="grid sm:grid-cols-2 gap-1.5 rounded-lg border border-line px-3 py-2">
                {PLAN_FEATURES.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={features.includes(f)} onChange={(e) => setFeatures((l) => (e.target.checked ? [...l, f] : l.filter((x) => x !== f)))} />
                    {PLAN_FEATURE_LABEL[f]}
                    {plano.limits.features?.includes(f) && <span className="text-[11px] text-faint">(no plano)</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <Field label="Observações" hint="Motivo ou acordo. Só você vê."><textarea className={cn(inputCls, 'min-h-[3.5rem]')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>

          <div className="flex items-center gap-2 pt-1">
            {o && <Button type="button" variant="subtle" onClick={remover} loading={del.isPending}>Remover personalização</Button>}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button type="submit" loading={save.isPending} loadingText="Salvando…">Salvar</Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
