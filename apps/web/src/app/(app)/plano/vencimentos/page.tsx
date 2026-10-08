'use client';
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CalendarClock, CornerDownRight, QrCode, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { AsaasCheckoutModal } from '@/components/billing/AsaasCheckoutModal';
import { useCan, useDues, usePayDues, fetchAsaasPayment, type AsaasPayment, type DueRow } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
type Filtro = 'todos' | 'a_vencer' | 'inadimplentes';

/** "Em dia", "A vencer em X dias", "Atrasado" — o que a coluna Status mostra. */
function situacao(r: DueRow): { label: string; cls: string } {
  if (r.status === 'suspended') return { label: 'Suspensa', cls: 'bg-danger-soft text-danger-ink' };
  if (r.status === 'canceled') return { label: 'Cancelada', cls: 'bg-field text-muted' };
  if (!r.state) return { label: '—', cls: 'bg-field text-muted' };
  if (r.state === 'free') return { label: 'Gratuito', cls: 'bg-field text-muted' };
  if (r.state === 'overdue') return { label: `Atrasado${r.daysToDue != null && r.daysToDue < 0 ? ` há ${-r.daysToDue} dia(s)` : ''}`, cls: 'bg-danger-soft text-danger-ink' };
  if (r.state === 'due_soon') return { label: r.daysToDue ? `A vencer em ${r.daysToDue} dia(s)` : 'Vence hoje', cls: 'bg-warn-soft text-warn-ink' };
  return { label: 'Em dia', cls: 'bg-ok-soft text-ok' };
}

/**
 * Painel de vencimentos do grupo (docs/empresas.md#cobrança): a assinatura do cliente, as
 * empresas que pagam junto com ela e as empresas com assinatura própria, numa lista só. Paga
 * uma, várias ou todas numa cobrança única do Asaas (boleto ou PIX).
 */
export default function VencimentosPage() {
  const isAdmin = useCan('billing.manage');
  const dues = useDues();
  const pay = usePayDues();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState<DueRow[] | null>(null);
  const [doc, setDoc] = useState('');
  const [pedirDoc, setPedirDoc] = useState(false);
  const [payment, setPayment] = useState<AsaasPayment | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  const rows = useMemo(() => dues.data?.rows ?? [], [dues.data]);
  // estável: o modal agenda o fechamento depois do pagamento e reagenda se isto mudar
  const fecharPagamento = useCallback(() => { setPayment(null); qc.invalidateQueries({ queryKey: ['dues'] }); }, [qc]);
  // empresas do grupo aparecem logo abaixo da linha do grupo e seguem o filtro dela
  const visiveis = useMemo(() => {
    const passa = (r: DueRow) => filtro === 'todos' || (filtro === 'a_vencer' ? r.state === 'due_soon' : r.state === 'overdue' || r.status === 'suspended' || r.status === 'past_due');
    const grupo = rows.find((r) => r.kind === 'group');
    const grupoPassa = !!grupo && passa(grupo);
    return rows.filter((r) => (r.kind === 'member' ? grupoPassa : passa(r)));
  }, [rows, filtro]);
  const pagaveis = visiveis.filter((r) => r.payable);
  const escolhidas = sel.size ? rows.filter((r) => sel.has(r.key) && r.payable) : pagaveis;
  const totalEscolhido = escolhidas.reduce((a, r) => a + r.amount, 0);

  if (!isAdmin) return <PageShell><PageHeader title="Vencimentos" /><p className="text-sm text-muted">Só quem gerencia o plano vê os vencimentos.</p></PageShell>;
  if (!dues.data) return (
    <PageShell width="max-w-6xl">
      <PageHeader title="Vencimentos" subtitle="Carregando…" />
      {dues.error ? <p className="text-sm text-danger-ink">{dues.error instanceof Error ? dues.error.message : String(dues.error)}</p> : <SkeletonCards count={3} />}
    </PageShell>
  );
  const { summary, online } = dues.data;

  const toggle = (k: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
  const todasMarcadas = pagaveis.length > 0 && pagaveis.every((r) => sel.has(r.key));

  async function emitir() {
    if (!confirmar) return;
    try {
      const r = await pay.mutateAsync({ keys: confirmar.map((x) => x.key), ...(doc.trim() && { cpfCnpj: doc.trim() }) });
      setConfirmar(null);
      setSel(new Set());
      setPayment(r.payment);
      qc.invalidateQueries({ queryKey: ['dues'] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'document_required') { setPedirDoc(true); toast.err(e.message); return; }
      toast.err(e);
    }
  }

  async function abrirCobranca(id: string) {
    setAbrindo(id);
    try { setPayment(await fetchAsaasPayment(id)); } catch (e) { toast.err(e); } finally { setAbrindo(null); }
  }

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Vencimentos"
        subtitle={dues.data.billingType === 'CONSOLIDATED_GROUP' ? 'Cobrança por grupo: a assinatura soma o plano de cada empresa ativa. Empresas com assinatura própria aparecem à parte.' : 'Assinatura da conta e das empresas com assinatura própria.'}
        action={<Link href="/plano" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Plano e uso</Link>}
      />

      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-panel border border-line p-4">
          <div className="flex items-center gap-2 text-xs text-muted"><Wallet size={14} /> Total a pagar no mês</div>
          <div className="text-2xl font-semibold text-ink tnum mt-1">{brl(summary.totalMonth)}</div>
          <div className="text-xs text-faint mt-0.5">Inclui o que está atrasado.</div>
        </div>
        <div className="rounded-2xl bg-panel border border-line p-4">
          <div className="flex items-center gap-2 text-xs text-muted"><CalendarClock size={14} /> Próximo vencimento</div>
          {summary.nextDue ? (
            <>
              <div className="text-2xl font-semibold text-ink tnum mt-1">{dia(summary.nextDue.dueDate)}</div>
              <div className="text-xs text-faint mt-0.5 truncate">{summary.nextDue.name} · {brl(summary.nextDue.amount)}{summary.nextDue.daysToDue != null && ` · em ${summary.nextDue.daysToDue} dia(s)`}</div>
            </>
          ) : <div className="text-2xl font-semibold text-faint mt-1">—</div>}
        </div>
        <div className={cn('rounded-2xl border p-4', summary.overdueCount ? 'bg-danger-soft border-danger/30' : 'bg-panel border-line')}>
          <div className={cn('flex items-center gap-2 text-xs', summary.overdueCount ? 'text-danger-ink' : 'text-muted')}><AlertTriangle size={14} /> Em atraso</div>
          <div className={cn('text-2xl font-semibold tnum mt-1', summary.overdueCount ? 'text-danger-ink' : 'text-ink')}>{brl(summary.overdueAmount)}</div>
          <div className="text-xs text-faint mt-0.5">{summary.overdueCount ? `${summary.overdueCount} vencimento(s)` : 'Nada atrasado'}</div>
        </div>
      </div>

      {!online && <p className="rounded-lg bg-field px-4 py-2 text-sm text-muted">Cobrança online não configurada — para pagar, fale com o suporte.</p>}

      {/* Filtros + ação em massa */}
      <div className="flex flex-wrap items-center gap-2">
        {([['todos', 'Todos'], ['a_vencer', 'A vencer nos próximos 7 dias'], ['inadimplentes', 'Inadimplentes']] as const).map(([k, l]) => (
          <button key={k} onClick={() => { setFiltro(k); setSel(new Set()); }} className={cn('rounded-full px-3 py-1 text-sm border', filtro === k ? 'bg-accent-soft border-accent text-accent-ink' : 'border-line text-muted hover:text-ink')}>{l}</button>
        ))}
        <Button className="ml-auto" icon={<QrCode size={15} />} disabled={!escolhidas.length} onClick={() => { setPedirDoc(false); setConfirmar(escolhidas); }}>
          {sel.size ? `Pagar ${escolhidas.length} selecionado(s)` : 'Pagar todos'} · {brl(totalEscolhido)} (boleto/PIX único)
        </Button>
      </div>

      {/* Tabela */}
      <section className="rounded-2xl bg-panel border border-line overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide">
            <tr>
              <th className="pl-4 py-2 w-8"><input type="checkbox" aria-label="Marcar todos" checked={todasMarcadas} disabled={!pagaveis.length} onChange={(e) => setSel(e.target.checked ? new Set(pagaveis.map((r) => r.key)) : new Set())} /></th>
              <th className="px-3 py-2">Empresa / unidade</th>
              <th className="px-3 py-2">Plano</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Vencimento</th>
              <th className="px-3 py-2 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visiveis.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">Nada neste filtro.</td></tr>}
            {visiveis.map((r) => {
              const st = situacao(r);
              const membro = r.kind === 'member';
              return (
                <tr key={r.key} className={cn(membro && 'bg-field/40')}>
                  <td className="pl-4 py-2.5">{!membro && <input type="checkbox" aria-label={`Selecionar ${r.name}`} checked={sel.has(r.key)} disabled={!r.payable} onChange={(e) => toggle(r.key, e.target.checked)} />}</td>
                  <td className="px-3 py-2.5">
                    <div className={cn('flex items-center gap-1.5 font-medium text-ink', membro && 'pl-3 font-normal text-muted')}>
                      {membro && <CornerDownRight size={13} className="text-faint shrink-0" />}
                      <span className="truncate">{r.name}</span>
                      {r.kind === 'group' && <span className="text-[10px] font-semibold uppercase tracking-wider text-muted bg-field rounded px-1.5 py-0.5">{r.units > 1 ? `Grupo · ${r.units} unidades` : 'Conta'}</span>}
                      {r.kind === 'company' && <span className="text-[10px] font-semibold uppercase tracking-wider text-muted bg-field rounded px-1.5 py-0.5">Assinatura própria</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{r.plan ?? '—'}{r.cycle === 'yearly' && <span className="text-[11px]"> (anual)</span>}</td>
                  <td className="px-3 py-2.5"><span className={cn('text-xs rounded-full px-2 py-0.5 whitespace-nowrap', st.cls)}>{st.label}</span></td>
                  <td className="px-3 py-2.5 text-right tnum">{membro ? (r.amount > 0 ? <span className="text-muted">{brl(r.amount)}</span> : <span className="text-faint">incluída</span>) : r.state === 'free' ? '—' : brl(r.amount)}</td>
                  <td className="px-3 py-2.5 tnum">{r.dueDate ? dia(r.dueDate) : '—'}</td>
                  <td className="px-3 py-2.5 text-right">
                    {r.openChargeId ? (
                      <Button size="sm" variant="ghost" loading={abrindo === r.openChargeId} onClick={() => abrirCobranca(r.openChargeId!)}>Ver cobrança</Button>
                    ) : r.payable ? (
                      <Button size="sm" variant={r.state === 'overdue' ? 'primary' : 'ghost'} onClick={() => { setPedirDoc(false); setConfirmar([r]); }}>Pagar</Button>
                    ) : (
                      <span className="text-xs text-faint">{r.reason}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <Modal open={!!confirmar} onClose={() => setConfirmar(null)} title={confirmar && confirmar.length > 1 ? 'Pagar vencimentos juntos' : 'Pagar vencimento'}>
        {confirmar && (
          <form onSubmit={(e) => { e.preventDefault(); void emitir(); }} className="space-y-3">
            <p className="text-sm text-muted">Uma cobrança única no Asaas: pague por PIX aqui mesmo ou pelo boleto no link da cobrança. Assim que o pagamento cair, cada item volta a ficar em dia.</p>
            <ul className="rounded-lg border border-line divide-y divide-line text-sm">
              {confirmar.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate">{r.name}{r.kind === 'group' && r.units > 1 && <span className="text-muted"> · {r.units} unidades</span>}</span>
                  <span className="tnum">{brl(r.amount)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between px-3 py-2 font-semibold"><span>Total</span><span className="tnum">{brl(confirmar.reduce((a, r) => a + r.amount, 0))}</span></li>
            </ul>
            {pedirDoc && (
              <Field label="CPF ou CNPJ de quem paga" hint="Exigido pelo Asaas para emitir a cobrança. Fica salvo para as próximas.">
                <input className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" placeholder="00.000.000/0000-00" required autoFocus />
              </Field>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setConfirmar(null)}>Cancelar</Button>
              <Button type="submit" loading={pay.isPending} loadingText="Gerando cobrança…">Gerar cobrança</Button>
            </div>
          </form>
        )}
      </Modal>

      <AsaasCheckoutModal payment={payment} onClose={fecharPagamento} />
    </PageShell>
  );
}
