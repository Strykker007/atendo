'use client';
import { useMemo, useState } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, Eye, RotateCcw, Send, Undo2, Wallet } from 'lucide-react';
import { PARTNER_KIND_LABEL, PARTNER_PAYOUT_STATUS_LABEL, lastClosedPeriod, periodLabel, type PartnerCommissionKind, type PartnerPayoutStatus } from '@atendo/shared';
import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Page';
import { Field, Modal, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import {
  useApprovePayouts, useApurar, useCancelPayout, useManualPaidPayout, usePartnerPayout, usePartnerPayouts, useRetryPayout, useTotpStatus, type PartnerPayout,
} from '@/lib/hooks';
import { CodeDialog, brl, cardCls, dataBR, dataHoraBR, pct, tabCls } from './shared';

const STATUS_CLS: Record<PartnerPayoutStatus, string> = {
  draft: 'bg-field text-muted', awaiting_second: 'bg-warn-soft text-warn-ink', approved: 'bg-accent-soft text-accent-ink',
  processing: 'bg-accent-soft text-accent-ink', paid: 'bg-ok-soft text-ok', failed: 'bg-danger-soft text-danger-ink',
};
const FILTROS: [string, string][] = [['pendentes', 'A autorizar'], ['andamento', 'Em andamento'], ['paid', 'Pagos'], ['', 'Todos']];
const AUTORIZAVEL: PartnerPayoutStatus[] = ['draft', 'awaiting_second'];

/**
 * Aba Pagamentos: apurar o ciclo terminado, conferir, autorizar em lote com UM código do
 * autenticador e acompanhar o Pix (docs/37-vogopartners.md#pagamento).
 */
export function AdminPayouts() {
  const [filtro, setFiltro] = useState('pendentes');
  const all = usePartnerPayouts();
  const totp = useTotpStatus();
  const apurar = useApurar();
  const approve = useApprovePayouts();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [autorizando, setAutorizando] = useState(false);
  const [vendo, setVendo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ id: string; status: string; error?: string }[] | null>(null);

  const rows = useMemo(() => (all.data ?? []).filter((p) =>
    filtro === 'pendentes' ? AUTORIZAVEL.includes(p.status) : filtro === 'andamento' ? ['approved', 'processing', 'failed'].includes(p.status) : filtro ? p.status === filtro : true,
  ), [all.data, filtro]);
  const escolhidos = (all.data ?? []).filter((p) => sel.has(p.id));
  const total = escolhidos.reduce((s, p) => s + p.amount, 0);

  async function rodarApuracao(kind: PartnerCommissionKind) {
    try {
      const r = await apurar.mutateAsync({ kind });
      const n = r.results.filter((x) => x.payoutId && !x.skipped).length;
      toast.ok(n ? `${PARTNER_KIND_LABEL[kind]} de ${periodLabel(kind, r.period)}: ${n} pagamento(s) para conferir` : `Nada a pagar em ${periodLabel(kind, r.period)}`);
      setFiltro('pendentes');
    } catch (err) { toast.err(err); }
  }

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-4">
      {totp.data && !totp.data.enabled && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Para autorizar pagamentos, ative o autenticador na aba <b>Segurança</b>. Sem ele, nenhum Pix sai — nem com a sua senha.</span>
        </div>
      )}

      <div className={cn(cardCls, 'p-4 flex flex-wrap items-center gap-3')}>
        <Calculator size={18} className="text-muted" />
        <div className="flex-1 min-w-[14rem] text-sm">
          <p className="font-medium">Apurar o ciclo que terminou</p>
          <p className="text-[12px] text-muted">Junta as comissões em aberto de cada parceiro. Dá para apurar de novo enquanto ninguém autorizou.</p>
        </div>
        <Button variant="ghost" loading={apurar.isPending && apurar.variables?.kind === 'recurring'} onClick={() => void rodarApuracao('recurring')}>Mensalidades · {periodLabel('recurring', lastClosedPeriod('recurring'))}</Button>
        <Button variant="ghost" loading={apurar.isPending && apurar.variables?.kind === 'setup'} onClick={() => void rodarApuracao('setup')}>Instalações · {periodLabel('setup', lastClosedPeriod('setup'))}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-field p-1 h-10 text-sm overflow-x-auto max-w-full">
          {FILTROS.map(([k, l]) => <button key={k} onClick={() => { setFiltro(k); setSel(new Set()); }} className={tabCls(filtro === k)}>{l}</button>)}
        </div>
        {sel.size > 0 && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted">{sel.size} selecionado(s) · <b className="text-ink tnum">{brl(total)}</b></span>
            <Button icon={<Send size={14} />} onClick={() => setAutorizando(true)} disabled={!totp.data?.enabled}>Autorizar e pagar</Button>
          </div>
        )}
      </div>

      {resultado && (
        <div className={cn(cardCls, 'p-3 text-sm space-y-1')}>
          <div className="flex justify-between"><p className="font-medium">Resultado da autorização</p><button className="text-muted text-[12px]" onClick={() => setResultado(null)}>fechar</button></div>
          {resultado.map((r) => {
            const p = all.data?.find((x) => x.id === r.id);
            return <p key={r.id} className={cn(r.status === 'error' || r.status === 'failed' ? 'text-danger-ink' : 'text-ink')}>{p?.partner.name ?? r.id}: {r.error ?? STATUS_RESULT[r.status] ?? r.status}</p>;
          })}
        </div>
      )}

      {all.isLoading ? <SkeletonRows /> : !rows.length ? (
        <Empty icon={<Wallet size={28} />} title="Nada aqui" text={filtro === 'pendentes' ? 'Nenhum pagamento esperando autorização. Apure o ciclo que terminou.' : 'Nenhum pagamento neste filtro.'} />
      ) : (
        <div className={cn(cardCls, 'overflow-x-auto')}>
          <table className="w-full text-sm min-w-[820px]">
            <thead className="text-left text-[12px] text-muted border-b border-line">
              <tr><th className="pl-4 w-8" /><th className="px-3 py-2.5 font-medium">Parceiro</th><th className="px-3 font-medium">Ciclo</th><th className="px-3 font-medium">Base</th><th className="px-3 font-medium text-right">Valor</th><th className="px-3 font-medium">Situação</th><th className="px-4" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => {
                const pode = AUTORIZAVEL.includes(p.status) && !p.blocked;
                return (
                  <tr key={p.id} className="align-top">
                    <td className="pl-4 py-3"><input type="checkbox" disabled={!pode} checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Selecionar ${p.partner.name}`} /></td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{p.partner.name}</p>
                      <p className="text-[11.5px] text-faint font-mono truncate max-w-[16rem]">{p.pixKey ?? p.partner.pixKey ?? 'sem chave Pix'}</p>
                    </td>
                    <td className="px-3 py-2.5"><p>{PARTNER_KIND_LABEL[p.kind]}</p><p className="text-[11.5px] text-faint">{p.periodLabel}</p></td>
                    <td className="px-3 py-2.5 text-[12.5px]">
                      {brl(p.baseTotal)} · {p.lines} pagamento(s)
                      {p.kind === 'recurring' && p.rate !== null && <p className="text-faint">{pct(p.rate)} · {p.activeClients} clientes ativos</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tnum">{brl(p.amount)}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-medium', STATUS_CLS[p.status])}>{PARTNER_PAYOUT_STATUS_LABEL[p.status]}</span>
                      {p.approvals.length > 0 && <p className="text-[11px] text-faint mt-1">por {p.approvals.map((a) => a.name).join(' e ')}</p>}
                      {p.paidAt && <p className="text-[11px] text-faint mt-1">{dataBR(p.paidAt)}{p.paidVia === 'manual' && ' · manual'}</p>}
                      {p.blocked && AUTORIZAVEL.includes(p.status) && <p className="text-[11px] text-warn-ink mt-1">{p.blocked}</p>}
                      {p.failureReason && <p className="text-[11px] text-danger-ink mt-1 max-w-[16rem]">{p.failureReason}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" icon={<Eye size={12} />} onClick={() => setVendo(p.id)}>Ver</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CodeDialog open={autorizando} title="Autorizar pagamentos" confirmLabel={`Autorizar ${brl(total)}`} busy={approve.isPending} onClose={() => setAutorizando(false)}
        onConfirm={async (code) => {
          try {
            const r = await approve.mutateAsync({ ids: [...sel], code });
            setResultado(r); setSel(new Set()); setAutorizando(false);
            const erros = r.filter((x) => x.status === 'error' || x.status === 'failed').length;
            erros ? toast.warn(`${r.length - erros} autorizado(s), ${erros} com problema — veja o resultado`) : toast.ok('Pagamentos autorizados');
          } catch (err) { toast.err(err); }
        }}>
        <div className="text-sm space-y-1">
          <p>Vai sair Pix para:</p>
          <ul className="rounded-lg bg-field/60 divide-y divide-line">
            {escolhidos.map((p) => <li key={p.id} className="flex justify-between gap-2 px-3 py-1.5"><span className="truncate">{p.partner.name} <span className="text-faint font-mono text-[11.5px]">{p.partner.pixKey}</span></span><b className="tnum">{brl(p.amount)}</b></li>)}
          </ul>
          <p className="text-[11.5px] text-faint">Acima do limite configurado, o pagamento espera a autorização de um segundo dono antes de sair.</p>
        </div>
      </CodeDialog>
      {vendo && <DetalhePagamento id={vendo} onClose={() => setVendo(null)} />}
    </div>
  );
}

const STATUS_RESULT: Record<string, string> = { paid: 'pago', processing: 'Pix enviado — aguardando o banco', approved: 'autorizado (pague pelo banco e dê baixa manual)', awaiting_second: 'falta a autorização de outro dono', failed: 'falhou — veja o motivo' };

function DetalhePagamento({ id, onClose }: { id: string; onClose: () => void }) {
  const q = usePartnerPayout(id);
  const retry = useRetryPayout();
  const manual = useManualPaidPayout();
  const cancel = useCancelPayout();
  const [acao, setAcao] = useState<'retry' | 'manual' | null>(null);
  const [confirmNotSent, setConfirmNotSent] = useState(false);
  const [data, setData] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  const p = q.data;
  const podeDesfazer = p && (['draft', 'awaiting_second', 'approved'].includes(p.status) || (p.status === 'failed' && p.transferStatus === 'REFUSED'));
  return (
    <Modal open onClose={onClose} title={p ? `${p.partner.name} — ${p.periodLabel}` : 'Pagamento'} width="max-w-3xl">
      {!p ? <SkeletonRows /> : (
        <div className="space-y-4 text-sm">
          <div className="grid sm:grid-cols-4 gap-3">
            <Info l="Valor" v={brl(p.amount)} />
            <Info l="Base" v={brl(p.baseTotal)} />
            <Info l={p.kind === 'recurring' ? 'Faixa' : 'Tipo'} v={p.kind === 'recurring' ? `${pct(p.rate ?? 0)} · ${p.activeClients} ativos` : 'Instalações'} />
            <Info l="Situação" v={PARTNER_PAYOUT_STATUS_LABEL[p.status]} />
          </div>
          {p.transferId && <p className="text-[12px] text-muted">Transferência Asaas <span className="font-mono">{p.transferId}</span> · {p.transferStatus}{p.sentAt && ` · enviada ${dataHoraBR(p.sentAt)}`}</p>}
          {p.failureReason && <p className="text-[12.5px] text-danger-ink">{p.failureReason}</p>}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[12.5px] min-w-[560px]">
              <thead className="text-left text-muted border-b border-line"><tr><th className="px-3 py-2 font-medium">Cliente</th><th className="px-3 font-medium">Pago em</th><th className="px-3 font-medium">Origem</th><th className="px-3 font-medium text-right">Pago pelo cliente</th><th className="px-3 font-medium text-right">%</th><th className="px-3 font-medium text-right">Comissão</th></tr></thead>
              <tbody className="divide-y divide-line">
                {p.lines.map((l) => (
                  <tr key={l.id} className={cn(l.baseAmount < 0 && 'text-danger-ink')}>
                    <td className="px-3 py-1.5">{l.tenant.name}</td>
                    <td className="px-3">{dataBR(l.paidAt)}</td>
                    <td className="px-3">{ORIGEM[l.sourceType] ?? l.sourceType}</td>
                    <td className="px-3 text-right tnum">{brl(l.baseAmount)}</td>
                    <td className="px-3 text-right tnum">{l.rate === null ? '—' : pct(l.rate)}</td>
                    <td className="px-3 text-right tnum">{l.amount === null ? '—' : brl(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {podeDesfazer && <Button variant="ghost" icon={<Undo2 size={13} />} loading={cancel.isPending} onClick={() => { if (window.confirm('Desfazer esta apuração? As comissões voltam para o próximo ciclo.')) cancel.mutateAsync(p.id).then(() => { toast.ok('Apuração desfeita'); onClose(); }).catch(toast.err); }}>Desfazer apuração</Button>}
            {p.status === 'failed' && <Button variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setAcao('retry')}>Tentar de novo</Button>}
            {(p.status === 'approved' || (p.status === 'failed' && p.transferStatus !== 'UNKNOWN')) && <Button variant="ghost" icon={<CheckCircle2 size={13} />} onClick={() => setAcao('manual')}>Paguei por fora</Button>}
          </div>
        </div>
      )}
      <CodeDialog open={acao === 'retry'} title="Tentar o Pix de novo" busy={retry.isPending} onClose={() => setAcao(null)}
        onConfirm={async (code) => { try { const r = await retry.mutateAsync({ id, code, confirmNotSent }); toast.ok(STATUS_RESULT[r.status] ?? r.status); setAcao(null); } catch (err) { toast.err(err); } }}>
        {p?.transferStatus === 'UNKNOWN' && (
          <label className="flex items-start gap-2 text-sm text-warn-ink"><input type="checkbox" className="mt-1" checked={confirmNotSent} onChange={(e) => setConfirmNotSent(e.target.checked)} /> Conferi no painel do Asaas: este Pix NÃO saiu.</label>
        )}
      </CodeDialog>
      <CodeDialog open={acao === 'manual'} title="Baixa manual" busy={manual.isPending} onClose={() => setAcao(null)}
        onConfirm={async (code) => { try { await manual.mutateAsync({ id, code, date: data }); toast.ok('Pagamento marcado como pago'); setAcao(null); } catch (err) { toast.err(err); } }}>
        <Field label="Data do Pix"><input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} /></Field>
        <p className="text-[12px] text-muted">Use quando o Pix foi feito pelo app do banco. Vira uma saída paga no fechamento financeiro.</p>
      </CodeDialog>
    </Modal>
  );
}

const ORIGEM: Record<string, string> = { invoice: 'Mensalidade', finance_entry: 'Recebido por fora', activation: 'Ativação', reversal: 'Estorno' };
const Info = ({ l, v }: { l: string; v: React.ReactNode }) => <div className="rounded-xl bg-field/60 p-3"><p className="text-[12px] text-muted">{l}</p><p className="font-semibold tnum">{v}</p></div>;
