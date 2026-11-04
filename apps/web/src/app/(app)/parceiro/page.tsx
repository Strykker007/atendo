'use client';
import Link from 'next/link';
import { Building2, KeyRound, TrendingUp } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { usePartnerMe } from '@/lib/hooks';
import { RankCard, Stat, brl, cardCls, pct, rankNextText, tiersText } from '@/components/partners/shared';
import { cn } from '@/lib/utils';

/** Portal do VogoPartner — resumo (docs/37-vogopartners.md#portal-do-parceiro). */
export default function ParceiroResumo() {
  const me = usePartnerMe();
  const d = me.data;
  if (me.isError) return <PageShell><p className="text-sm text-muted">{(me.error as Error).message}</p></PageShell>;
  return (
    <PageShell width="max-w-5xl">
      <PageHeader title={d ? `Olá, ${d.name}` : 'Painel do parceiro'} subtitle="Seus clientes, sua faixa de comissão e o que você tem a receber." />
      {!d ? <SkeletonRows /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Clientes ativos" value={d.activeClients} hint={`${d.clients} cadastrados`} />
            <Stat label="Sua faixa hoje" value={pct(d.rate)} hint={rankNextText(d.tiers, d.activeClients)} tone="ok" />
            <Stat label={`Mensalidades · ${d.month.label}`} value={brl(d.month.estimate)} hint={`previsão sobre ${brl(d.month.base)} já pagos`} />
            <Stat label={`Instalações · ${d.week.label}`} value={brl(d.week.amount)} hint={`${pct(d.setupRate)} de cada instalação`} />
          </div>
          <RankCard tiers={d.tiers} activeClients={d.activeClients} voce />
          <div className="grid sm:grid-cols-2 gap-3">
            <Stat label="A receber (apurado)" value={brl(d.toReceive)} hint="sai por Pix depois da conferência do financeiro" />
            <Stat label="Já recebido" value={brl(d.received)} />
          </div>
          <section className={cn(cardCls, 'p-5 space-y-3 text-sm')}>
            <h3 className="font-semibold flex items-center gap-2"><TrendingUp size={16} /> Como você ganha</h3>
            <ul className="space-y-1.5 text-muted">
              <li><b className="text-ink">Mensalidade:</b> {tiersText(d.tiers)} (clientes ativos). A faixa alcançada vale para todos os seus clientes no mês. Pago mensalmente, sobre o que o cliente pagou.</li>
              <li><b className="text-ink">Instalação:</b> {pct(d.setupRate)} da taxa de instalação{d.setupFee > 0 && ` (${brl(d.setupFee)} por cliente)`}. Pago semanalmente.</li>
              <li><b className="text-ink">Até o cancelamento:</b> o cliente que você cadastra fica com você enquanto pagar.</li>
            </ul>
          </section>
          <section className={cn(cardCls, 'p-5 flex flex-wrap items-center gap-3 text-sm')}>
            <KeyRound size={16} className="text-muted" />
            <p className="flex-1 min-w-[14rem]">Chave Pix: {d.pixKey ? <span className="font-mono">{d.pixKey}</span> : <span className="text-warn-ink">não cadastrada — fale com a equipe para receber</span>}. Por segurança, só a equipe troca a chave.</p>
            <Link href="/parceiro/clientes" className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-white px-3 py-2 font-medium"><Building2 size={14} /> Meus clientes</Link>
          </section>
        </>
      )}
    </PageShell>
  );
}
