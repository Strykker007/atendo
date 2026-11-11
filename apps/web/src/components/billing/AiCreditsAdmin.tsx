'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useAiCreditsOverview, useGrantAiCredits, useSetAiMarkup, useTenants } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 4 : 2 });

/**
 * Saldo de IA no painel do dono (docs/15-ia.md#saldo-de-ia): a margem sobre o custo real, o que
 * foi vendido e consumido no mês, o lucro e o lançamento manual (cortesia, pagou por fora, correção).
 */
export function AiCreditsAdmin() {
  const q = useAiCreditsOverview();
  const setMarkup = useSetAiMarkup();
  const grant = useGrantAiCredits();
  const tenants = useTenants();
  const [margem, setMargem] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [valor, setValor] = useState('');
  const [nota, setNota] = useState('');
  const d = q.data;
  if (!d) return null;
  const pct = margem ?? String(d.markupPct);

  async function salvarMargem() {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0 || n > 1000) return toast.err('Margem entre 0% e 1000%.');
    try { await setMarkup.mutateAsync(n); setMargem(null); toast.ok('Margem atualizada: vale para as próximas respostas.'); } catch (e) { toast.err(e); }
  }
  async function lancar() {
    const v = Number(valor.replace(',', '.'));
    if (!tenantId || !Number.isFinite(v) || !v) return toast.err('Escolha o cliente e um valor (negativo tira saldo).');
    try { await grant.mutateAsync({ tenantId, amountBrl: v, note: nota || undefined }); setValor(''); setNota(''); toast.ok('Saldo lançado'); } catch (e) { toast.err(e); }
  }

  const cards: [string, string, string?][] = [
    ['Vendido no mês (Pix)', brl(d.soldBrl), `${d.soldCount} compra(s)`],
    ['Consumido pelos clientes', brl(d.consumedBrl), `${d.consumedInteractions.toLocaleString('pt-BR')} respostas`],
    ['Custo real da IA', brl(d.costBrl), 'o que o fornecedor cobra'],
    ['Lucro no consumo', brl(d.profitBrl), d.costBrl > 0 ? `${Math.round((d.profitBrl / d.costBrl) * 100)}% sobre o custo` : undefined],
    ['Saldo em aberto', brl(d.outstandingBrl), 'já recebido, ainda não usado'],
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-panel border border-line p-4 space-y-3">
        <h2 className="font-display font-semibold text-ink">Margem do saldo de IA</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Margem sobre o custo real (%)">
            <input className={cn(inputCls, 'w-32')} inputMode="numeric" value={pct} onChange={(e) => setMargem(e.target.value)} />
          </Field>
          <Button onClick={() => void salvarMargem()} loading={setMarkup.isPending} disabled={margem === null}>Salvar</Button>
        </div>
        <p className="text-xs text-muted">
          Custo médio de uma resposta: <b>{brl(d.avgCostBrl)}</b> → o cliente paga em média <b>{brl(d.avgPriceBrl)}</b>. 100% = cobra o dobro do custo. O cliente vê só o saldo e quantas respostas ele rende, nunca a margem. Muda só as próximas respostas.
        </p>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map(([l, v, h]) => (
          <div key={l} className="rounded-2xl bg-panel border border-line p-4">
            <div className="text-[11px] text-muted">{l}</div>
            <div className="text-lg font-semibold text-ink">{v}</div>
            {h && <div className="text-xs text-muted">{h}</div>}
          </div>
        ))}
      </div>

      <section className="rounded-2xl bg-panel border border-line p-4 space-y-3">
        <h2 className="font-display font-semibold text-ink">Lançar saldo</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_2fr_auto] gap-3 items-end">
          <Field label="Cliente">
            <select className={inputCls} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              <option value="">Escolha…</option>
              {(tenants.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Valor (R$)">
            <input className={inputCls} inputMode="decimal" placeholder="ex.: 20 ou -5" value={valor} onChange={(e) => setValor(e.target.value)} />
          </Field>
          <Field label="Motivo">
            <input className={inputCls} placeholder="cortesia, pagou por fora…" value={nota} onChange={(e) => setNota(e.target.value)} />
          </Field>
          <Button onClick={() => void lancar()} loading={grant.isPending}>Lançar</Button>
        </div>
        <p className="text-xs text-muted">Não gera cobrança nem entra no faturado. Valor negativo tira saldo.</p>
      </section>

      {d.recent.length > 0 && (
        <section className="rounded-2xl bg-panel border border-line p-4">
          <h2 className="font-display font-semibold text-ink mb-2">Últimas compras e lançamentos</h2>
          <ul className="divide-y divide-line text-sm">
            {d.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{new Date(r.createdAt).toLocaleDateString('pt-BR')} · <b>{r.tenantName}</b> · {brl(r.amountBrl)}{r.note ? <span className="text-muted"> · {r.note}</span> : null}</span>
                <span className={cn('text-xs', r.status === 'paid' ? 'text-ok' : 'text-warn')}>{r.status === 'pending' ? 'aguardando Pix' : r.paidVia === 'manual' ? 'lançado' : 'pago'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
