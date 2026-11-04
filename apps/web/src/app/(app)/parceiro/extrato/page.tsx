'use client';
import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { PARTNER_KIND_LABEL, type PartnerCommissionKind } from '@atendo/shared';
import { Empty, PageHeader, PageShell } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { usePartnerStatement } from '@/lib/hooks';
import { brl, cardCls, dataBR, pct, tabCls } from '@/components/partners/shared';
import { cn } from '@/lib/utils';

/** Portal do parceiro — extrato: cada pagamento de cliente que gerou comissão e os Pix recebidos. */
export default function ParceiroExtrato() {
  const [kind, setKind] = useState<PartnerCommissionKind>('recurring');
  const q = usePartnerStatement(kind);
  const d = q.data;
  return (
    <PageShell width="max-w-5xl">
      <PageHeader title="Extrato" subtitle="Mensalidades são pagas uma vez por mês; instalações, toda semana." action={
        <div className="flex items-center gap-1 rounded-lg bg-field p-1 h-10 text-sm">
          {(['recurring', 'setup'] as PartnerCommissionKind[]).map((k) => <button key={k} onClick={() => setKind(k)} className={tabCls(kind === k)}>{PARTNER_KIND_LABEL[k]}</button>)}
        </div>
      } />
      {!d ? <SkeletonRows /> : (
        <>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Pagamentos</h3>
            {!d.payouts.filter((p) => p.kind === kind).length ? <p className="text-sm text-faint">Nenhum pagamento ainda.</p> : (
              <ul className={cn(cardCls, 'divide-y divide-line text-sm')}>
                {d.payouts.filter((p) => p.kind === kind).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-[12rem]"><p className="font-medium">{p.periodLabel}</p><p className="text-[11.5px] text-faint">sobre {brl(p.baseTotal)}{p.rate !== null && ` · ${pct(p.rate)} (${p.activeClients} ativos)`}</p></div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-medium', p.status === 'paid' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent-ink')}>{p.status === 'paid' ? `Pago ${dataBR(p.paidAt)}` : 'Em processamento'}</span>
                    <b className="tnum w-28 text-right">{brl(p.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Pagamentos dos clientes</h3>
            {!d.lines.length ? <Empty icon={<Receipt size={28} />} title="Nada ainda" text="Quando um cliente seu pagar, aparece aqui." /> : (
              <div className={cn(cardCls, 'overflow-x-auto')}>
                <table className="w-full text-[13px] min-w-[600px]">
                  <thead className="text-left text-[12px] text-muted border-b border-line"><tr><th className="px-4 py-2 font-medium">Cliente</th><th className="px-3 font-medium">Pago em</th><th className="px-3 font-medium">Ciclo</th><th className="px-3 font-medium text-right">Valor pago</th><th className="px-3 font-medium text-right">Comissão</th><th className="px-4 font-medium">Situação</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.lines.map((l) => (
                      <tr key={l.id} className={cn(l.reversal && 'text-danger-ink')}>
                        <td className="px-4 py-1.5">{l.client}{l.reversal && ' (estorno)'}</td>
                        <td className="px-3">{dataBR(l.paidAt)}</td>
                        <td className="px-3">{l.periodLabel}</td>
                        <td className="px-3 text-right tnum">{brl(l.base)}</td>
                        <td className="px-3 text-right tnum">{l.amount === null ? <span className="text-faint" title="A faixa do mês é aplicada quando o mês fecha">no fechamento</span> : brl(l.amount)}</td>
                        <td className="px-4 text-[12px] text-muted">{l.payoutStatus === 'paid' ? 'Pago' : l.payoutStatus ? 'Em processamento' : 'Aguardando o ciclo'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
