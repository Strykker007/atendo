'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft, Wallet, TrendingUp, AlertTriangle, Receipt, Landmark, Plus, Pencil, Trash2, Check, Lock, Unlock, MessageCircle, ExternalLink, Copy, Search, Undo2, Ban, Users, CalendarClock, Percent, Repeat } from 'lucide-react';
import {
  FINANCE_FREQUENCIES, FINANCE_FREQUENCY_LABEL, FINANCE_PAYMENT_METHODS, FINANCE_PAYMENT_METHOD_LABEL, FINANCE_SECTION_HINT, FINANCE_SECTION_LABEL, FINANCE_SECTIONS,
  FINANCE_TAX_BASE_LABEL, FINANCE_TAX_BASES, isValidCpfCnpj, type FinanceFrequency, type FinancePaymentMethod, type FinanceSection, type FinanceTaxBase,
} from '@atendo/shared';
import { cn, formatDoc } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { SkeletonCards, SkeletonRows } from '@/components/ui/Skeleton';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { PercentInput } from '@/components/ui/PercentInput';
import { DateInput, MonthPicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useClosingConfig, useClosingMonth, useClosingWrite, useMe, useOverdue, usePayables, useUpdateTenant, type ClosingConfig, type ClosingSummary, type FinanceEntryRow, type PayoutRow, type ReceivableRow } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR');
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const mesAtual = () => hojeSP().slice(0, 7);
const nomeMes = (p: string) => new Date(`${p}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const mesCurto = (p: string) => new Date(`${p}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace('.', '');
const diasAte = (ymd: string) => Math.round((Date.parse(`${ymd}T12:00:00Z`) - Date.parse(`${hojeSP()}T12:00:00Z`)) / 86_400_000);
/** "01/10 a 31/10" — o intervalo exato que o mês soma */
function intervalo(p: string) {
  const [y, m] = p.split('-').map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  return `01/${String(m).padStart(2, '0')} a ${ultimo}/${String(m).padStart(2, '0')}/${y}`;
}
/** 1º dia do mês seguinte, quando o mês pode ser fechado */
function fechaEm(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m, 1).toLocaleDateString('pt-BR');
}

const ORIGEM: Record<ReceivableRow['origin'], string> = { asaas: 'Pix (Asaas)', stripe: 'Cartão (Stripe)', manual: 'Por fora', ativacao: 'Ativação' };
const SITUACAO: Record<ReceivableRow['status'], [string, string]> = { paid: ['Recebido', 'bg-ok-soft text-ok'], open: ['A vencer', 'bg-field text-muted'], overdue: ['Atrasado', 'bg-danger-soft text-danger-ink'] };
const ASSINATURA: Record<string, string> = { active: 'Ativa', past_due: 'Pendente', suspended: 'Suspensa', trialing: 'Teste', canceled: 'Cancelada' };
/** ordem das saídas no fechamento (DRE) e nas listas */
const SAIDAS: FinanceSection[] = ['tax', 'cost', 'expense', 'payroll', 'prolabore'];
const metodo = (m: string | null) => (m ? FINANCE_PAYMENT_METHOD_LABEL[m as FinancePaymentMethod] ?? m : null);

/** barra de filtros: abas, selects e busca na mesma altura (h-9) */
const barra = 'flex items-center gap-1 rounded-lg bg-field p-1 h-9 text-xs overflow-x-auto max-w-full';
const filtroCls = cn(inputCls, 'h-9 py-0 w-auto');
const aba = (on: boolean) => cn('h-7 px-2.5 rounded-md font-medium whitespace-nowrap', on ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink');
/** valor só de leitura com cara de campo (mesma altura e borda dos inputs) */
const Fixo = ({ children }: { children: React.ReactNode }) => <div className={cn(inputCls, 'bg-field text-muted flex items-center gap-2 min-h-[38px]')}>{children}</div>;

type Aba = 'mes' | 'pagar' | 'atraso' | 'config';
type Config = ClosingConfig;

/**
 * Fechamento financeiro do dono (docs/36-fechamento-financeiro.md): quanto era para entrar, quanto
 * entrou, quem está atrasado, contas a pagar (impostos, custos, despesas, folha) e quanto cada
 * sócio recebe no fechamento do mês.
 */
export default function FechamentoPage() {
  const me = useMe();
  const [abaAtual, setAbaAtual] = useState<Aba>('mes');
  const [periodo, setPeriodo] = useState(mesAtual());
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get('aba');
    if (a === 'atraso' || a === 'config' || a === 'pagar') setAbaAtual(a);
  }, []);
  if (me.data && !me.data.systemOwner) return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;

  return (
    <PageShell width="max-w-6xl">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-2"><ArrowLeft size={14} /> Financeiro</Link>
      <PageHeader title="Fechamento" subtitle="Quanto entrou, quanto saiu, o que falta pagar e receber, e a parte de cada sócio." action={
        <div className="flex items-center gap-1 rounded-lg bg-field p-1 h-10 text-sm overflow-x-auto max-w-full">
          {([['mes', 'Mês'], ['pagar', 'Contas a pagar'], ['atraso', 'Em atraso'], ['config', 'Cadastros']] as [Aba, string][]).map(([t, l]) => (
            <button key={t} onClick={() => setAbaAtual(t)} className={cn('h-8 px-3 rounded-md font-medium whitespace-nowrap', abaAtual === t ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}>{l}</button>
          ))}
        </div>
      } />
      {abaAtual === 'mes' && <Mes periodo={periodo} setPeriodo={setPeriodo} />}
      {abaAtual === 'pagar' && <ContasAPagar />}
      {abaAtual === 'atraso' && <EmAtraso />}
      {abaAtual === 'config' && <Configuracao />}
    </PageShell>
  );
}

// ---------------------------------------------------------------- mês

function Mes({ periodo, setPeriodo }: { periodo: string; setPeriodo: (p: string) => void }) {
  const q = useClosingMonth(periodo);
  const w = useClosingWrite();
  const [lancando, setLancando] = useState<FinanceEntryRow | 'saida' | 'entrada' | null>(null);
  const [pagando, setPagando] = useState<FinanceEntryRow | null>(null);
  const [pagandoSocio, setPagandoSocio] = useState<PayoutRow | null>(null);
  const [recebendo, setRecebendo] = useState<ReceivableRow | null>(null);
  const [filtro, setFiltro] = useState<'todos' | ReceivableRow['status']>('todos');
  const [busca, setBusca] = useState('');
  const d = q.data;
  const s = d?.summary;
  const saidas = s ? (s.taxes ?? 0) + (s.costs ?? 0) + s.expenses + s.payroll + s.prolabore : 0;
  const linhas = useMemo(() => (d?.receivables ?? []).filter((r) => (filtro === 'todos' || r.status === filtro) && (!busca || r.tenant.toLowerCase().includes(busca.toLowerCase()))), [d, filtro, busca]);
  const travado = !!d?.closed;

  const fechar = () => {
    if (!d) return;
    const aberto = d.summary.unpaid ?? 0;
    if (!confirm(`Fechar ${nomeMes(periodo).toUpperCase()} (${intervalo(periodo)})?\n\nResultado: ${brl(d.summary.result)} · A distribuir: ${brl(d.summary.distributable)}${aberto > 0 ? `\n\n${brl(aberto)} em contas deste mês ainda não foram pagas — já estão descontadas do resultado; dá para dar baixa depois de fechar.` : ''}\n\nOs números ficam congelados e os lançamentos desse mês travam. Dá para reabrir se precisar corrigir.`)) return;
    w.mutateAsync({ path: `month/${periodo}/close`, body: {} }).then(() => toast.ok('Mês fechado'), toast.err);
  };
  const reabrir = () => {
    if (!confirm('Reabrir o mês? O fechamento é desfeito (inclusive as marcações de pago dos sócios) e os números voltam a ser calculados.')) return;
    w.mutateAsync({ path: `month/${periodo}/reopen` }).then(() => toast.ok('Mês reaberto'), toast.err);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <MonthPicker value={periodo} max={mesAtual()} onChange={setPeriodo} />
        {travado && <span className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 bg-ok-soft text-ok"><Lock size={11} /> Fechado em {new Date(d!.closed!.closedAt).toLocaleDateString('pt-BR')}</span>}
        {d?.current && <span className="text-[11px] rounded-full px-2 py-0.5 bg-field text-muted">Mês em andamento — fecha a partir de {fechaEm(periodo)}</span>}
      </div>

      {/* no começo do mês, o que se fecha é o mês passado: o aviso leva até ele */}
      {d?.previousOpen && d.previousOpen !== periodo && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft text-warn-ink px-4 py-2.5 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1 min-w-[200px]"><b className="capitalize">{nomeMes(d.previousOpen)}</b> já terminou e ainda não foi fechado.</span>
          <Button size="sm" onClick={() => setPeriodo(d.previousOpen!)}>Ir para {nomeMes(d.previousOpen)}</Button>
        </div>
      )}

      {!d ? <SkeletonCards count={5} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi icon={<Receipt size={16} />} label="Previsto no mês" value={brl(d.expected)} sub={d.pending > 0 ? `${brl(d.pending)} ainda não entrou` : 'tudo recebido'} />
            <Kpi icon={<TrendingUp size={16} />} label="Recebido" value={brl(s!.receivedClients + s!.otherIncome)} sub={s!.otherIncome ? `${brl(s!.receivedClients)} de clientes + ${brl(s!.otherIncome)} outras` : 'Asaas, Stripe e por fora'} tone="ok" />
            <Kpi icon={<Landmark size={16} />} label="Saídas do mês" value={brl(saidas)} sub={(s!.unpaid ?? 0) > 0 ? `${brl(s!.unpaid!)} ainda a pagar` : 'tudo pago'} tone={(s!.unpaid ?? 0) > 0 ? 'warn' : undefined} />
            <Kpi icon={<Wallet size={16} />} label="Resultado do mês" value={brl(s!.result)} tone={s!.result < 0 ? 'danger' : 'ok'} sub={s!.result < 0 ? 'prejuízo: nada a distribuir' : `${brl(s!.distributable)} a distribuir`} />
            <Kpi icon={<Wallet size={16} />} label="Caixa hoje" value={brl(d.cash.balance)} tone={d.cash.balance < 0 ? 'danger' : undefined}
              sub={d.cash.toPay > 0 ? `${brl(d.cash.toPay)} a pagar${d.cash.overdue > 0 ? ` · ${brl(d.cash.overdue)} vencido` : ''}` : d.cash.since ? `desde ${dataBR(d.cash.since)}` : 'defina o saldo inicial em Cadastros'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <section className="rounded-2xl bg-panel border border-line p-4 space-y-3">
              <div>
                <h2 className="font-display font-semibold text-ink text-sm">Fechamento de {nomeMes(periodo)}</h2>
                <p className="text-[11px] text-muted">Entradas pelo dia em que o dinheiro caiu ({intervalo(periodo)}); saídas pelo mês a que pertencem (competência), pagas ou não.</p>
              </div>
              <Conta s={s!} />
              {d.closed && d.liveSummary && d.liveSummary.result !== s!.result && (
                <p className="text-xs rounded-lg bg-warn-soft text-warn-ink px-3 py-2">Depois do fechamento entrou/saiu dinheiro com data deste mês: hoje o resultado seria {brl(d.liveSummary.result)}. Reabra e feche de novo para atualizar.</p>
              )}
              {d.closed?.notes && <p className="text-xs text-muted">Obs.: {d.closed.notes}</p>}
            </section>

            <section className="rounded-2xl bg-panel border border-line p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display font-semibold text-ink text-sm inline-flex items-center gap-1.5"><Users size={15} /> Parte de cada sócio</h2>
                {travado
                  ? <Button size="sm" variant="ghost" icon={<Unlock size={13} />} loading={w.isPending} onClick={reabrir}>Reabrir</Button>
                  : d.canClose
                    ? <Button size="sm" icon={<Lock size={13} />} loading={w.isPending} onClick={fechar}>Fechar {nomeMes(periodo)}</Button>
                    : <span className="text-[11px] text-muted">Fecha a partir de {fechaEm(periodo)}</span>}
              </div>
              {!d.payouts.length ? <p className="text-sm text-faint">Nenhum sócio cadastrado — cadastre em <b>Cadastros</b>.</p> : (
                <ul className="divide-y divide-line">
                  {d.payouts.map((p) => (
                    <li key={p.partnerId} className="flex items-center gap-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">{p.name} <span className="text-xs text-muted font-normal">{p.percent.toLocaleString('pt-BR')}%</span></p>
                        {p.pixKey && <button type="button" className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1" onClick={() => navigator.clipboard.writeText(p.pixKey!).then(() => toast.ok('Chave Pix copiada'), toast.err)}><Copy size={11} /> Pix: {p.pixKey}</button>}
                      </div>
                      <b className="tnum">{brl(p.amount)}</b>
                      {travado && (p.paidAt
                        ? <button type="button" title="Mudar a data ou desfazer" className="text-[11px] rounded-full px-2 py-0.5 bg-ok-soft text-ok hover:brightness-95" onClick={() => setPagandoSocio(p)}>Pago {dataBR(p.paidAt)}</button>
                        : <Button size="sm" variant="success" icon={<Check size={12} />} disabled={p.amount <= 0} onClick={() => setPagandoSocio(p)}>Paguei</Button>)}
                    </li>
                  ))}
                </ul>
              )}
              {d.partnersPercent !== 100 && d.payouts.length > 0 && <p className="text-xs rounded-lg bg-warn-soft text-warn-ink px-3 py-2">A soma dos sócios é {d.partnersPercent.toLocaleString('pt-BR')}% — precisa dar 100% para fechar.</p>}
              {!travado && <p className="text-[11px] text-faint">Prévia: os valores mudam até fechar. Fechado, eles congelam e você marca quem já recebeu.</p>}
            </section>
          </div>

          <section className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-semibold text-ink text-sm mr-auto">Lançamentos de {nomeMes(periodo)}</h2>
              {!travado && (
                <>
                  <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setLancando('entrada')}>Entrada</Button>
                  <Button size="sm" icon={<Plus size={14} />} onClick={() => setLancando('saida')}>Lançar saída</Button>
                </>
              )}
            </div>
            <Lancamentos entries={d.entries} travado={travado} onEditar={setLancando} onPagar={setPagando} />
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-semibold text-ink text-sm mr-auto">Mensalidades e cobranças do mês</h2>
              <div className={barra}>
                {([['todos', 'Todos'], ['paid', 'Recebidos'], ['open', 'A vencer'], ['overdue', 'Atrasados']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setFiltro(k)} className={aba(filtro === k)}>{l}</button>
                ))}
              </div>
              <Busca value={busca} onChange={setBusca} />
            </div>
            <TabelaRecebiveis rows={linhas} onReceber={travado ? undefined : setRecebendo} vazio="Nada vencendo neste mês." />
          </section>
        </>
      )}
      {lancando && <LancamentoModal entry={typeof lancando === 'string' ? null : lancando} tipo={lancando === 'entrada' ? 'income' : 'expense'} periodo={periodo} onClose={() => setLancando(null)} />}
      {pagando && <PagarModal entry={pagando} onClose={() => setPagando(null)} />}
      {pagandoSocio && <PagarSocioModal periodo={periodo} payout={pagandoSocio} onClose={() => setPagandoSocio(null)} />}
      {recebendo && <ReceberModal row={recebendo} onClose={() => setRecebendo(null)} />}
    </div>
  );
}

/** DRE simplificado do mês. Fechamento antigo não tem impostos/custos separados (`?? 0`). */
function Conta({ s }: { s: ClosingSummary }) {
  const linha = (rotulo: string, v: number, sinal: '+' | '−' | '=', forte?: boolean) => (
    <li className={cn('flex justify-between gap-3 py-1', forte && 'font-semibold text-ink border-t border-line pt-2')}>
      <span className={forte ? '' : 'text-muted'}>{sinal === '=' ? '' : `${sinal} `}{rotulo}</span>
      <span className={cn('tnum', sinal === '−' && v > 0 && 'text-danger-ink')}>{sinal === '−' && v > 0 ? `−${brl(v)}` : brl(v)}</span>
    </li>
  );
  return (
    <ul className="text-sm">
      {linha('Recebido de clientes', s.receivedClients, '+')}
      {linha('Outras entradas', s.otherIncome, '+')}
      {linha('Impostos', s.taxes ?? 0, '−')}
      {linha('Custos do serviço', s.costs ?? 0, '−')}
      {linha('Despesas', s.expenses, '−')}
      {linha('Folha e encargos', s.payroll, '−')}
      {linha('Pró-labore', s.prolabore, '−')}
      {linha('Resultado', s.result, '=', true)}
      {linha(`Reserva do caixa (${s.reservePercent.toLocaleString('pt-BR')}%)`, s.reserve, '−')}
      {linha('A distribuir entre os sócios', s.distributable, '=', true)}
      {(s.unpaid ?? 0) > 0 && <li className="pt-2 text-[11px] text-warn-ink">{brl(s.unpaid!)} das saídas ainda não foram pagas (já estão descontadas acima).</li>}
    </ul>
  );
}

const PAGTO: Record<FinanceEntryRow['status'], [string, string, string]> = {
  paid: ['Pago', 'Recebido', 'bg-ok-soft text-ok'],
  open: ['A pagar', 'A receber', 'bg-field text-muted'],
  overdue: ['Vencido', 'Atrasado', 'bg-danger-soft text-danger-ink'],
};

function Selo({ e }: { e: FinanceEntryRow }) {
  const [saida, entrada, cls] = PAGTO[e.status];
  return <span className={cn('text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap', cls)}>{e.kind === 'income' ? entrada : saida}{e.paidAt && ` ${dataBR(e.paidAt).slice(0, 5)}`}</span>;
}

/** Linha de detalhe: fornecedor, documento, parcela, forma, fixo/automático. */
function Detalhe({ e, comMes }: { e: FinanceEntryRow; comMes?: boolean }) {
  const itens = [
    e.supplier, e.tenant, e.documentNumber && `Doc. ${e.documentNumber}`, e.installmentTotal && `parcela ${e.installmentNo}/${e.installmentTotal}`,
    metodo(e.paymentMethod), comMes && `competência ${mesCurto(e.period)}`,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-1 flex-wrap text-[11px] text-faint no-underline">
      {e.recurringId && <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 bg-field text-muted"><Repeat size={10} /> fixo</span>}
      {e.taxRuleId && <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 bg-field text-muted" title={e.amountLocked ? 'Valor corrigido à mão: não recalcula mais' : 'Recalcula com o que entra no mês até ser pago'}><Percent size={10} /> automático{e.amountLocked && ' · valor da guia'}</span>}
      {itens.length > 0 && <span>{itens.join(' · ')}</span>}
      {e.notes && <span title={e.notes} className="truncate max-w-[16rem]">· {e.notes}</span>}
    </div>
  );
}

function Lancamentos({ entries, travado, onEditar, onPagar }: { entries: FinanceEntryRow[]; travado: boolean; onEditar: (e: FinanceEntryRow) => void; onPagar: (e: FinanceEntryRow) => void }) {
  const w = useClosingWrite();
  const [secao, setSecao] = useState<'all' | FinanceSection>('all');
  const [situ, setSitu] = useState<'all' | 'paid' | 'pending'>('all');
  if (!entries.length) return <p className="rounded-2xl bg-panel border border-line px-4 py-6 text-center text-sm text-muted">Nenhum lançamento. Cadastre impostos, custos fixos e a folha em <b>Cadastros</b> — eles entram sozinhos todo mês.</p>;
  const temSecao = (x: FinanceSection) => entries.some((e) => e.section === x);
  const rows = entries.filter((e) => (secao === 'all' || e.section === secao) && (situ === 'all' || (situ === 'paid' ? !!e.paidAt : !e.paidAt)));
  const ativos = rows.filter((e) => !e.skipped);
  const total = ativos.reduce((s, e) => s + (e.kind === 'income' ? e.amount : -e.amount), 0);
  const excluir = (e: FinanceEntryRow) => {
    if (e.recurringId || e.taxRuleId) {
      if (confirm(`${e.recurringId ? 'Este custo fixo' : 'Este imposto'} não houve neste mês? Ele fica riscado (os outros meses não mudam).`)) w.mutateAsync({ path: `entries/${e.id}`, method: 'DELETE' }).catch(toast.err);
      return;
    }
    if (e.installmentGroup && confirm(`Excluir também as parcelas seguintes ainda em aberto de "${e.description.replace(/ \(\d+\/\d+\)$/, '')}"?\n\nOK = esta e as seguintes · Cancelar = escolher só esta`)) {
      w.mutateAsync({ path: `entries/${e.id}?all=1`, method: 'DELETE' }).catch(toast.err);
      return;
    }
    if (confirm('Excluir este lançamento?')) w.mutateAsync({ path: `entries/${e.id}`, method: 'DELETE' }).catch(toast.err);
  };
  const chip = aba;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <div className={barra}>
          <button className={chip(secao === 'all')} onClick={() => setSecao('all')}>Tudo</button>
          {(['revenue', ...SAIDAS] as FinanceSection[]).filter(temSecao).map((x) => <button key={x} className={chip(secao === x)} onClick={() => setSecao(x)}>{FINANCE_SECTION_LABEL[x]}</button>)}
        </div>
        <div className={barra}>
          {([['all', 'Todos'], ['pending', 'Em aberto'], ['paid', 'Pagos']] as const).map(([k, l]) => <button key={k} className={chip(situ === k)} onClick={() => setSitu(k)}>{l}</button>)}
        </div>
        <span className="ml-auto text-muted">Saldo do filtro: <b className={cn('tnum', total < 0 ? 'text-danger-ink' : 'text-ok')}>{brl(total)}</b></span>
      </div>
      <div className="rounded-2xl bg-panel border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide"><tr><th className="px-4 py-2.5">Venc.</th><th className="px-3 py-2.5">Descrição</th><th className="px-3 py-2.5">Categoria</th><th className="px-3 py-2.5 text-right">Valor</th><th className="px-3 py-2.5">Situação</th><th className="px-4 py-2.5" /></tr></thead>
          <tbody className="divide-y divide-line">
            {!rows.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">Nada neste filtro.</td></tr>}
            {rows.map((e) => (
              <tr key={e.id} className={cn(e.skipped && 'opacity-50')}>
                <td className={cn('px-4 py-2 whitespace-nowrap tnum', e.skipped && 'line-through')}>{dataBR(e.date)}</td>
                <td className="px-3 py-2 min-w-[14rem]">
                  <span className={cn('text-ink', e.skipped && 'line-through')}>{e.description}</span>
                  <Detalhe e={e} />
                </td>
                <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">{e.categoryName}<div className="text-[10px] text-faint">{FINANCE_SECTION_LABEL[e.section]}</div></td>
                <td className={cn('px-3 py-2 text-right tnum whitespace-nowrap', e.kind === 'income' ? 'text-ok' : 'text-ink', e.skipped && 'line-through')}>{e.kind === 'income' ? '+' : '−'}{brl(e.amount)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{e.skipped ? <span className="text-[11px] text-muted">Não houve</span> : <Selo e={e} />}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {!e.skipped && !e.paidAt && <Button size="sm" variant="success" icon={<Check size={12} />} onClick={() => onPagar(e)}>{e.kind === 'income' ? 'Recebi' : 'Pagar'}</Button>}
                  {!e.skipped && e.paidAt && (
                    <button type="button" className="text-faint hover:text-ink p-1" title="Desfazer a baixa (volta a ficar em aberto)"
                      onClick={() => confirm('Desfazer a baixa? O lançamento volta a ficar em aberto e sai do caixa.') && w.mutateAsync({ path: `entries/${e.id}/pay`, body: { date: null } }).catch(toast.err)}><Undo2 size={14} /></button>
                  )}
                  {!travado && !e.skipped && <button type="button" className="text-faint hover:text-ink p-1" title="Editar" onClick={() => onEditar(e)}><Pencil size={14} /></button>}
                  {!travado && (e.skipped
                    ? <button type="button" className="text-faint hover:text-ink p-1" title="Voltar a contar" onClick={() => w.mutateAsync({ path: `entries/${e.id}`, method: 'PATCH', body: { skipped: false } }).catch(toast.err)}><Undo2 size={14} /></button>
                    : <button type="button" className="text-faint hover:text-danger p-1" title={e.recurringId || e.taxRuleId ? 'Não houve neste mês' : 'Excluir'} onClick={() => excluir(e)}><Trash2 size={14} /></button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- seletores

/** Categorias agrupadas pelo grupo do fechamento; a atual aparece mesmo desativada. */
function SelectCategoria({ cats, value, onChange, kind, sections }: { cats: Config['categories']; value: string; onChange: (id: string) => void; kind?: 'income' | 'expense'; sections?: FinanceSection[] }) {
  const grupos = (sections ?? (kind === 'income' ? ['revenue'] : kind === 'expense' ? SAIDAS : ['revenue', ...SAIDAS]) as FinanceSection[]);
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Escolha…</option>}
      {grupos.map((g) => {
        const lista = cats.filter((c) => c.section === g && (c.isActive || c.id === value));
        return lista.length ? <optgroup key={g} label={FINANCE_SECTION_LABEL[g]}>{lista.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (desativada)'}</option>)}</optgroup> : null;
      })}
    </select>
  );
}

/** Fornecedor com "cadastrar novo" no próprio seletor. */
function SelectFornecedor({ sups, value, onChange }: { sups: Config['suppliers']; value: string; onChange: (id: string) => void }) {
  const [novo, setNovo] = useState(false);
  return (
    <>
      <select className={inputCls} value={value} onChange={(e) => (e.target.value === '__novo' ? setNovo(true) : onChange(e.target.value))}>
        <option value="">Nenhum</option>
        {sups.filter((f) => f.isActive || f.id === value).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        <option value="__novo">＋ Cadastrar novo…</option>
      </select>
      {novo && <FornecedorModal item={null} onClose={(id) => { setNovo(false); if (id) onChange(id); }} />}
    </>
  );
}

function SelectMetodo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {FINANCE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{FINANCE_PAYMENT_METHOD_LABEL[m]}</option>)}
    </select>
  );
}

const PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24, 36, 48, 60];

/**
 * Lançamento completo: tipo, categoria, fornecedor, valor (ou parcelas), vencimento, competência,
 * situação (pago em / em aberto), forma de pagamento, nº do documento e observações.
 */
function LancamentoModal({ entry, tipo, periodo, onClose }: { entry: FinanceEntryRow | null; tipo: 'income' | 'expense'; periodo: string; onClose: () => void }) {
  const cfg = useClosingConfig();
  const w = useClosingWrite();
  const hoje = hojeSP();
  const dataInicial = entry?.date ?? (hoje.startsWith(periodo) ? hoje : `${periodo}-${periodo < mesAtual() ? '28' : '01'}`);
  const [kind, setKind] = useState<'income' | 'expense'>(entry?.kind ?? tipo);
  const [f, setF] = useState({
    category: entry?.category ?? '', description: entry?.description ?? '', amount: entry?.amount ?? 0, date: dataInicial,
    period: entry?.period ?? periodo, supplierId: entry?.supplierId ?? '', paymentMethod: entry?.paymentMethod ?? '',
    documentNumber: entry?.documentNumber ?? '', notes: entry?.notes ?? '', installments: 1,
  });
  // pago? entrada nasce recebida; saída com vencimento até hoje nasce paga
  const [pago, setPago] = useState(entry ? !!entry.paidAt : tipo === 'income' || dataInicial <= hoje);
  const [pagoEm, setPagoEm] = useState(entry?.paidAt ?? (dataInicial <= hoje ? dataInicial : hoje));
  const [competenciaManual, setCompetenciaManual] = useState(!!entry && entry.period !== entry.date.slice(0, 7));
  const set = (p: Partial<typeof f>) => setF((v) => ({ ...v, ...p }));
  const fixoOuImposto = !!(entry?.recurringId || entry?.taxRuleId);
  const entrada = kind === 'income';

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.category) return toast.warn('Escolha a categoria');
    if (!f.description.trim() || f.amount <= 0) return toast.warn('Preencha descrição e valor');
    const body = {
      category: f.category, description: f.description, amount: f.amount, date: f.date,
      period: competenciaManual ? f.period : f.date.slice(0, 7),
      paidAt: pago ? pagoEm : null, paymentMethod: f.paymentMethod || null, supplierId: f.supplierId || null,
      documentNumber: f.documentNumber || null, notes: f.notes || null,
      ...(!entry && f.installments > 1 && { installments: f.installments }),
    };
    try {
      if (entry) await w.mutateAsync({ path: `entries/${entry.id}`, method: 'PATCH', body: fixoOuImposto ? { ...body, period: undefined } : body });
      else await w.mutateAsync({ path: 'entries', body });
      toast.ok(!entry && f.installments > 1 ? `${f.installments} parcelas lançadas` : 'Lançamento salvo');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title={entry ? 'Editar lançamento' : entrada ? 'Nova entrada' : 'Nova saída'} width="max-w-2xl">
      {!cfg.data ? <SkeletonRows rows={5} /> : (
        <form onSubmit={salvar} className="space-y-4">
          {!entry && (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-field p-1 text-sm">
              {([['expense', 'Saída'], ['income', 'Entrada']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => { setKind(k); set({ category: '' }); if (k === 'income') setPago(true); }}
                  className={cn('h-8 rounded-md font-medium', kind === k ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}>{l}</button>
              ))}
            </div>
          )}
          {entry?.taxRuleId && (
            <p className="text-xs rounded-lg bg-field text-muted px-3 py-2">Imposto automático, calculado sobre o que entrou no mês. {entry.amountLocked ? 'O valor foi corrigido à mão (guia): não recalcula mais.' : 'Se a guia vier com outro valor, corrija aqui — a partir daí ele não recalcula mais.'}</p>
          )}
          {entry?.tenantId && <p className="text-xs rounded-lg bg-field text-muted px-3 py-2">Recebimento da mensalidade de {entry.tenant}.</p>}

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Categoria">
              <SelectCategoria cats={cfg.data.categories} value={f.category} onChange={(category) => set({ category })} kind={kind} />
            </Field>
            <Field label={entrada ? 'De quem' : 'Fornecedor / favorecido'}>
              <SelectFornecedor sups={cfg.data.suppliers} value={f.supplierId} onChange={(supplierId) => set({ supplierId })} />
            </Field>
          </div>
          <Field label="Descrição">
            <input className={inputCls} value={f.description} maxLength={160} onChange={(e) => set({ description: e.target.value })}
              placeholder={entrada ? 'Ex.: Consultoria para cliente X' : 'Ex.: DAS de outubro, Servidor Oracle, Notebook'} autoFocus={!entry} />
          </Field>

          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={f.installments > 1 ? 'Valor da parcela' : 'Valor'}><MoneyInput value={f.amount} onChange={(v) => set({ amount: v ?? 0 })} aria-label="Valor" /></Field>
            <Field label="Parcelas">
              {!entry && !entrada ? (
                <select className={inputCls} value={f.installments} onChange={(e) => set({ installments: Number(e.target.value) })}>
                  {PARCELAS.map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x`}</option>)}
                </select>
              ) : <Fixo>{entry?.installmentTotal ? `${entry.installmentNo} de ${entry.installmentTotal}` : 'À vista'}</Fixo>}
            </Field>
            <Field label={entrada ? 'Data' : f.installments > 1 ? '1º vencimento' : 'Vencimento'}>
              <DateInput value={f.date} onChange={(date) => { set({ date }); if (!pago || pagoEm > hoje) setPagoEm(date <= hoje ? date : hoje); }} aria-label="Vencimento" />
            </Field>
          </div>

          {f.installments > 1 && <p className="-mt-2 text-[11px] text-faint">Total {brl(f.amount * f.installments)} em {f.installments} parcelas, uma por mês.</p>}

          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Situação">
              <select className={inputCls} value={pago ? 'pago' : 'aberto'} onChange={(e) => setPago(e.target.value === 'pago')}>
                <option value="pago">{entrada ? 'Já recebi' : 'Já paguei'}</option>
                <option value="aberto">{entrada ? 'A receber' : 'Em aberto (a pagar)'}</option>
              </select>
            </Field>
            <Field label={entrada ? 'Recebido em' : f.installments > 1 ? '1ª parcela paga em' : 'Pago em'}>
              {pago ? <DateInput value={pagoEm} max={hoje} onChange={setPagoEm} aria-label="Pago em" /> : <Fixo>—</Fixo>}
            </Field>
            <Field label="Forma de pagamento"><SelectMetodo value={f.paymentMethod} onChange={(paymentMethod) => set({ paymentMethod })} /></Field>
          </div>
          {f.installments > 1 && pago && <p className="-mt-2 text-[11px] text-faint">Só a 1ª parcela fica paga; as outras entram em Contas a pagar.</p>}

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nº da nota / guia / boleto"><input className={inputCls} value={f.documentNumber} maxLength={80} placeholder="Opcional" onChange={(e) => set({ documentNumber: e.target.value })} /></Field>
            <Field label="Conta no fechamento de">
              {competenciaManual && !fixoOuImposto
                ? <MonthPicker block value={f.period} onChange={(p) => set({ period: p })} />
                : (
                  <Fixo>
                    <span className="flex-1 capitalize text-ink">{nomeMes(fixoOuImposto ? entry!.period : f.date.slice(0, 7))}</span>
                    {!fixoOuImposto && <button type="button" className="text-xs font-medium text-accent-ink hover:underline" onClick={() => { set({ period: f.date.slice(0, 7) }); setCompetenciaManual(true); }}>mudar</button>}
                  </Fixo>
                )}
            </Field>
          </div>
          <p className="-mt-2 text-[11px] text-faint">
            {fixoOuImposto ? 'Fixo e imposto automático ficam no mês deles.' : <>Mês da competência: a guia de outubro que vence em novembro conta em outubro.{competenciaManual && <> <button type="button" className="text-accent-ink hover:underline" onClick={() => setCompetenciaManual(false)}>Usar o mês do vencimento</button></>}</>}
          </p>
          <Field label="Observações"><textarea className={cn(inputCls, 'min-h-[60px]')} value={f.notes} maxLength={1000} placeholder="Opcional" onChange={(e) => set({ notes: e.target.value })} /></Field>

          {entrada && !entry && <p className="text-[11px] text-faint">Mensalidade de cliente que pagou por fora se registra na linha dele (botão “Recebi” em Mensalidades), para o vencimento andar.</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={w.isPending}>Salvar</Button></div>
        </form>
      )}
    </Modal>
  );
}

/** Baixa de uma conta: dia, valor pago (juros, guia diferente) e forma. */
function PagarModal({ entry, onClose }: { entry: FinanceEntryRow; onClose: () => void }) {
  const w = useClosingWrite();
  const hoje = hojeSP();
  const [data, setData] = useState(entry.date <= hoje ? entry.date : hoje);
  const [valor, setValor] = useState(entry.amount);
  const [forma, setForma] = useState(entry.paymentMethod ?? '');
  const entrada = entry.kind === 'income';
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await w.mutateAsync({ path: `entries/${entry.id}/pay`, body: { date: data, amount: valor, paymentMethod: forma || null } });
      toast.ok(entrada ? 'Recebimento registrado' : 'Pagamento registrado');
      onClose();
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open onClose={onClose} title={entrada ? 'Registrar recebimento' : 'Registrar pagamento'} width="max-w-md">
      <form onSubmit={salvar} className="space-y-3">
        <div className="rounded-lg bg-field px-3 py-2 text-sm">
          <p className="text-ink font-medium">{entry.description}</p>
          <p className="text-xs text-muted">{entry.categoryName}{entry.supplier && ` · ${entry.supplier}`} · vence {dataBR(entry.date)} · conta em {nomeMes(entry.period)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={entrada ? 'Recebido em' : 'Pago em'}><DateInput value={data} max={hoje} onChange={setData} aria-label="Pago em" /></Field>
          <Field label="Valor pago" hint={valor !== entry.amount ? `Lançado: ${brl(entry.amount)}` : undefined}><MoneyInput value={valor} onChange={(v) => setValor(v ?? 0)} aria-label="Valor pago" /></Field>
        </div>
        <Field label="Forma de pagamento"><SelectMetodo value={forma} onChange={setForma} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" variant="success" loading={w.isPending}>Confirmar</Button></div>
      </form>
    </Modal>
  );
}

/** Parte do sócio no mês fechado: quando ele recebeu (muda a data ou desfaz se já marcado). */
function PagarSocioModal({ periodo, payout, onClose }: { periodo: string; payout: PayoutRow; onClose: () => void }) {
  const w = useClosingWrite();
  const hoje = hojeSP();
  const [data, setData] = useState(payout.paidAt ?? hoje);
  const enviar = (paid: boolean) => w.mutateAsync({ path: `month/${periodo}/payouts/${payout.partnerId}`, method: 'PUT', body: paid ? { paid, date: data } : { paid } });
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await enviar(true);
      toast.ok(`Pagamento de ${payout.name} registrado`);
      onClose();
    } catch (err) { toast.err(err); }
  }
  async function desfazer() {
    try {
      await enviar(false);
      toast.ok('Pagamento desmarcado');
      onClose();
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open onClose={onClose} title={payout.paidAt ? 'Pagamento do sócio' : 'Registrar pagamento do sócio'} width="max-w-md">
      <form onSubmit={salvar} className="space-y-3">
        <div className="rounded-lg bg-field px-3 py-2 text-sm">
          <p className="text-ink font-medium">{payout.name} <span className="text-xs text-muted font-normal">{payout.percent.toLocaleString('pt-BR')}%</span></p>
          <p className="text-xs text-muted">Parte de {nomeMes(periodo)} · <b className="tnum">{brl(payout.amount)}</b>{payout.pixKey && ` · Pix: ${payout.pixKey}`}</p>
        </div>
        <Field label="Pago em" hint="Sai do caixa nesse dia."><DateInput value={data} min={`${periodo}-01`} max={hoje} onChange={setData} aria-label="Pago em" /></Field>
        <div className="flex items-center gap-2">
          {payout.paidAt && <Button type="button" variant="ghost" icon={<Undo2 size={13} />} loading={w.isPending} onClick={desfazer}>Desfazer</Button>}
          <div className="ml-auto flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" variant="success" loading={w.isPending}>{payout.paidAt ? 'Salvar' : 'Confirmar'}</Button></div>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- contas a pagar

function ContasAPagar() {
  const q = usePayables();
  const [faixa, setFaixa] = useState<'all' | 'overdue' | '7' | '30'>('all');
  const [busca, setBusca] = useState('');
  const [secao, setSecao] = useState<'' | FinanceSection>('');
  const [pagando, setPagando] = useState<FinanceEntryRow | null>(null);
  const todas = q.data ?? [];
  const rows = todas.filter((e) => {
    const d = diasAte(e.date);
    return (faixa === 'all' || (faixa === 'overdue' ? d < 0 : d >= 0 && d <= Number(faixa)))
      && (!secao || e.section === secao)
      && (!busca || `${e.description} ${e.supplier ?? ''} ${e.categoryName}`.toLowerCase().includes(busca.toLowerCase()));
  });
  const soma = (l: FinanceEntryRow[]) => l.reduce((s, e) => s + e.amount, 0);
  const vencidas = todas.filter((e) => diasAte(e.date) < 0);
  const semana = todas.filter((e) => { const d = diasAte(e.date); return d >= 0 && d <= 7; });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={<AlertTriangle size={16} />} label="Vencidas" value={brl(soma(vencidas))} sub={`${vencidas.length} conta${vencidas.length === 1 ? '' : 's'}`} tone={vencidas.length ? 'danger' : 'ok'} />
        <Kpi icon={<CalendarClock size={16} />} label="Vencem em 7 dias" value={brl(soma(semana))} sub={`${semana.length} conta${semana.length === 1 ? '' : 's'}`} tone={semana.length ? 'warn' : undefined} />
        <Kpi icon={<Landmark size={16} />} label="Total em aberto" value={brl(soma(todas))} sub="inclui parcelas futuras" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className={barra}>
          {([['all', 'Todas'], ['overdue', 'Vencidas'], ['7', 'Próx. 7 dias'], ['30', 'Próx. 30 dias']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFaixa(k)} className={aba(faixa === k)}>{l}</button>
          ))}
        </div>
        <select className={filtroCls} value={secao} onChange={(e) => setSecao(e.target.value as typeof secao)} aria-label="Grupo">
          <option value="">Todos os grupos</option>
          {SAIDAS.map((x) => <option key={x} value={x}>{FINANCE_SECTION_LABEL[x]}</option>)}
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className={cn(inputCls, 'h-9 py-0 pl-8 w-56')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conta ou fornecedor" />
        </div>
      </div>
      {q.isLoading ? <SkeletonRows rows={5} /> : (
        <div className="rounded-2xl bg-panel border border-line overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide"><tr><th className="px-4 py-2.5">Vencimento</th><th className="px-3 py-2.5">Conta</th><th className="px-3 py-2.5">Categoria</th><th className="px-3 py-2.5 text-right">Valor</th><th className="px-4 py-2.5" /></tr></thead>
            <tbody className="divide-y divide-line">
              {!rows.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">{todas.length ? 'Nada neste filtro.' : 'Nenhuma conta em aberto. 🎉'}</td></tr>}
              {rows.map((e) => {
                const d = diasAte(e.date);
                return (
                  <tr key={e.id}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="tnum">{dataBR(e.date)}</span>
                      <div className={cn('text-[11px]', d < 0 ? 'text-danger-ink font-medium' : d <= 3 ? 'text-warn-ink' : 'text-faint')}>{d < 0 ? `vencida há ${-d} dia${d === -1 ? '' : 's'}` : d === 0 ? 'vence hoje' : `em ${d} dia${d === 1 ? '' : 's'}`}</div>
                    </td>
                    <td className="px-3 py-2 min-w-[14rem]"><span className="text-ink">{e.description}</span><Detalhe e={e} comMes /></td>
                    <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">{e.categoryName}<div className="text-[10px] text-faint">{FINANCE_SECTION_LABEL[e.section]}</div></td>
                    <td className="px-3 py-2 text-right tnum whitespace-nowrap font-medium">{brl(e.amount)}</td>
                    <td className="px-4 py-2 text-right"><Button size="sm" variant="success" icon={<Check size={12} />} onClick={() => setPagando(e)}>Pagar</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-faint">Pagar aqui tira do caixa no dia escolhido. O fechamento não muda: a conta já foi descontada no mês a que pertence. Para lançar uma conta nova, use “Lançar saída” na aba Mês.</p>
      {pagando && <PagarModal entry={pagando} onClose={() => setPagando(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- recebíveis / atraso

function Busca({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
      <input className={cn(inputCls, 'h-9 py-0 pl-8 w-52')} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Buscar cliente" />
    </div>
  );
}

/** Mensagem pronta para cobrar no WhatsApp do responsável (abre no WhatsApp de quem clicou). */
function linkWhatsApp(r: ReceivableRow) {
  const d = (r.contact.phone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const tel = d.length <= 11 ? `55${d}` : d;
  const quem = r.contact.name?.trim().split(/\s+/)[0];
  const texto = `Olá${quem ? `, ${quem}` : ''}! Tudo bem? A mensalidade de ${brl(r.amount)} com vencimento em ${dataBR(r.dueDate)} consta em aberto.${r.hostedUrl ? ` Para pagar: ${r.hostedUrl}` : ''} Qualquer dúvida, estamos à disposição.`;
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
}

function TabelaRecebiveis({ rows, onReceber, vazio, comAtraso, onSuspender }: { rows: ReceivableRow[]; onReceber?: (r: ReceivableRow) => void; vazio: string; comAtraso?: boolean; onSuspender?: (r: ReceivableRow) => void }) {
  const head = ['Cliente', 'Origem', 'Vencimento', ...(comAtraso ? ['Atraso', 'Assinatura'] : []), 'Valor', 'Situação', ''];
  return (
    <div className="rounded-2xl bg-panel border border-line overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide"><tr>{head.map((h, i) => <th key={i} className="px-4 py-2.5 whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {!rows.length && <tr><td colSpan={head.length} className="px-4 py-6 text-center text-muted">{vazio}</td></tr>}
          {rows.map((r) => {
            const wa = r.status !== 'paid' ? linkWhatsApp(r) : null;
            return (
              <tr key={r.key}>
                <td className="px-4 py-2.5">
                  <Link href={`/clientes?busca=${encodeURIComponent(r.tenant)}`} className="text-ink hover:text-accent-ink hover:underline">{r.tenant}</Link>
                  {(r.contact.name || r.contact.phone) && <div className="text-[11px] text-faint">{[r.contact.name, r.contact.phone].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">{ORIGEM[r.origin]}</td>
                <td className="px-4 py-2.5 tnum whitespace-nowrap">{dataBR(r.dueDate)}</td>
                {comAtraso && <td className={cn('px-4 py-2.5 tnum whitespace-nowrap', r.daysLate > 30 ? 'text-danger-ink font-medium' : r.daysLate > 7 ? 'text-warn-ink' : '')}>{r.daysLate} dia{r.daysLate === 1 ? '' : 's'}</td>}
                {comAtraso && <td className="px-4 py-2.5 text-xs whitespace-nowrap">{r.subscriptionStatus ? ASSINATURA[r.subscriptionStatus] ?? r.subscriptionStatus : '—'}</td>}
                <td className="px-4 py-2.5 tnum whitespace-nowrap font-medium">{brl(r.amount)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className={cn('text-[11px] rounded-full px-2 py-0.5', SITUACAO[r.status][1])}>{SITUACAO[r.status][0]}</span>
                  {r.paidAt && <span className="text-[11px] text-faint ml-1">{dataBR(r.paidAt)}</span>}
                  {!comAtraso && r.status === 'overdue' && r.daysLate > 0 && <span className="text-[11px] text-danger-ink ml-1">{r.daysLate}d</span>}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex p-1.5 text-faint hover:text-ok" title="Cobrar no WhatsApp"><MessageCircle size={15} /></a>}
                  {r.hostedUrl && r.status !== 'paid' && (
                    <button type="button" className="p-1.5 text-faint hover:text-ink" title="Copiar link de pagamento" onClick={() => navigator.clipboard.writeText(r.hostedUrl!).then(() => toast.ok('Link copiado'), toast.err)}><Copy size={15} /></button>
                  )}
                  {r.hostedUrl && <a href={r.hostedUrl} target="_blank" rel="noreferrer" className="inline-flex p-1.5 text-faint hover:text-ink" title="Abrir cobrança"><ExternalLink size={15} /></a>}
                  {onSuspender && r.subscriptionStatus && r.subscriptionStatus !== 'suspended' && (
                    <button type="button" className="p-1.5 text-faint hover:text-danger" title="Suspender o envio do cliente" onClick={() => onSuspender(r)}><Ban size={15} /></button>
                  )}
                  {onReceber && r.canReceive && r.status !== 'paid' && <Button size="sm" variant="success" className="ml-1" icon={<Check size={12} />} onClick={() => onReceber(r)}>Recebi</Button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReceberModal({ row, onClose }: { row: ReceivableRow; onClose: () => void }) {
  const w = useClosingWrite();
  const [valor, setValor] = useState(row.amount);
  const [data, setData] = useState(hojeSP());
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = (await w.mutateAsync({ path: `receive/${row.tenantId}`, body: { amount: valor, date: data } })) as { nextDue: string };
      toast.ok(`Recebimento registrado — próximo vencimento ${dataBR(r.nextDue)}`);
      onClose();
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open onClose={onClose} title={`Recebi de ${row.tenant}`} width="max-w-md">
      <form onSubmit={salvar} className="space-y-3">
        <p className="text-sm text-muted">Mensalidade com vencimento em {dataBR(row.dueDate)}. Entra no caixa do dia escolhido e o vencimento do cliente anda um ciclo (a assinatura volta a ficar ativa).</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor recebido"><MoneyInput value={valor} onChange={(v) => setValor(v ?? 0)} aria-label="Valor recebido" /></Field>
          <Field label="Recebido em"><DateInput value={data} max={hojeSP()} onChange={setData} aria-label="Recebido em" /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" variant="success" loading={w.isPending}>Registrar</Button></div>
      </form>
    </Modal>
  );
}

function EmAtraso() {
  const q = useOverdue();
  const update = useUpdateTenant();
  const [busca, setBusca] = useState('');
  const [origem, setOrigem] = useState<'' | ReceivableRow['origin']>('');
  const [faixa, setFaixa] = useState<'' | '7' | '30' | '30+'>('');
  const [recebendo, setRecebendo] = useState<ReceivableRow | null>(null);
  const rows = (q.data ?? []).filter((r) =>
    (!busca || r.tenant.toLowerCase().includes(busca.toLowerCase())) && (!origem || r.origin === origem)
    && (!faixa || (faixa === '7' ? r.daysLate <= 7 : faixa === '30' ? r.daysLate > 7 && r.daysLate <= 30 : r.daysLate > 30)));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const clientes = new Set(rows.map((r) => r.tenantId)).size;
  const suspender = (r: ReceivableRow) => {
    if (!confirm(`Suspender ${r.tenant}? O envio de mensagens é bloqueado (o recebimento continua). Volta ao pagar ou ao mudar a assinatura em Clientes.`)) return;
    update.mutateAsync({ id: r.tenantId, subscriptionStatus: 'suspended' }).then(() => { toast.ok('Cliente suspenso'); void q.refetch(); }, toast.err);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={<AlertTriangle size={16} />} label="Total em atraso" value={brl(total)} tone={total > 0 ? 'danger' : 'ok'} />
        <Kpi icon={<Users size={16} />} label="Clientes devendo" value={String(clientes)} />
        <Kpi icon={<Receipt size={16} />} label="Mais de 30 dias" value={brl(rows.filter((r) => r.daysLate > 30).reduce((s, r) => s + r.amount, 0))} sub="candidatos a suspensão" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Busca value={busca} onChange={setBusca} />
        <select className={filtroCls} value={origem} onChange={(e) => setOrigem(e.target.value as typeof origem)} aria-label="Origem">
          <option value="">Todas as origens</option>
          {Object.entries(ORIGEM).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className={filtroCls} value={faixa} onChange={(e) => setFaixa(e.target.value as typeof faixa)} aria-label="Atraso">
          <option value="">Qualquer atraso</option>
          <option value="7">Até 7 dias</option>
          <option value="30">8 a 30 dias</option>
          <option value="30+">Mais de 30 dias</option>
        </select>
      </div>
      {q.isLoading ? <SkeletonRows rows={5} /> : (
        <TabelaRecebiveis rows={rows} comAtraso onReceber={setRecebendo} onSuspender={suspender} vazio="Ninguém em atraso. 🎉" />
      )}
      <p className="text-[11px] text-faint">Cobrança pelo Asaas/Stripe dá baixa sozinha quando o cliente paga. “Recebi” é para quem paga por fora (sem gateway): registra no caixa e o vencimento anda.</p>
      {recebendo && <ReceberModal row={recebendo} onClose={() => { setRecebendo(null); void q.refetch(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- cadastros

function Secao({ titulo, desc, acao, children }: { titulo: string; desc?: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-panel border border-line p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div><h2 className="font-display font-semibold text-ink text-sm">{titulo}</h2>{desc && <p className="text-xs text-muted">{desc}</p>}</div>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Configuracao() {
  const q = useClosingConfig();
  const w = useClosingWrite();
  const [socio, setSocio] = useState<Config['partners'][number] | 'novo' | null>(null);
  const [fixo, setFixo] = useState<{ item: Config['recurring'][number] | null; folha: boolean } | null>(null);
  const [imposto, setImposto] = useState<Config['taxRules'][number] | 'novo' | null>(null);
  const [categoria, setCategoria] = useState<Config['categories'][number] | 'novo' | null>(null);
  const [fornecedor, setFornecedor] = useState<Config['suppliers'][number] | 'novo' | null>(null);
  const [ajustes, setAjustes] = useState<Config['settings'] | null>(null);
  useEffect(() => { if (q.data && !ajustes) setAjustes(q.data.settings); }, [q.data, ajustes]);
  if (!q.data || !ajustes) return <SkeletonCards count={3} />;
  const cfg = q.data;
  const ativos = cfg.partners.filter((p) => p.isActive);
  const soma = Math.round(ativos.reduce((s, p) => s + p.sharePercent, 0) * 100) / 100;
  const secaoDe = (id: string) => cfg.categories.find((c) => c.id === id)?.section;
  const folha = cfg.recurring.filter((r) => secaoDe(r.category) === 'payroll' || secaoDe(r.category) === 'prolabore');
  const fixos = cfg.recurring.filter((r) => !folha.includes(r));
  const salvarAjustes = () => w.mutateAsync({ path: 'settings', method: 'PUT', body: { ...ajustes, openingDate: ajustes.openingDate || null } }).then(() => toast.ok('Configuração salva'), toast.err);
  const nomeCat = (id: string) => cfg.categories.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Secao titulo="Sócios" desc="O que sobra no mês (depois de impostos, custos, folha e reserva) é dividido por estes percentuais." acao={<Button size="sm" icon={<Plus size={14} />} onClick={() => setSocio('novo')}>Sócio</Button>}>
          {!cfg.partners.length ? <p className="text-sm text-faint">Nenhum sócio cadastrado.</p> : (
            <ul className="divide-y divide-line">
              {cfg.partners.map((p) => (
                <li key={p.id} className={cn('flex items-center gap-3 py-2 text-sm', !p.isActive && 'opacity-50')}>
                  <span className="flex-1 font-medium text-ink">{p.name}{!p.isActive && <span className="text-xs text-muted font-normal"> (inativo)</span>}</span>
                  {p.pixKey && <span className="text-xs text-muted hidden sm:inline">Pix: {p.pixKey}</span>}
                  <b className="tnum w-16 text-right">{p.sharePercent.toLocaleString('pt-BR')}%</b>
                  <button type="button" className="text-faint hover:text-ink p-1" title="Editar" onClick={() => setSocio(p)}><Pencil size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <p className={cn('text-xs', soma === 100 ? 'text-ok' : 'text-warn-ink')}>Soma dos ativos: {soma.toLocaleString('pt-BR')}%{soma !== 100 && ' — precisa dar 100%'}</p>
        </Secao>

        <Secao titulo="Caixa">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Reserva"><PercentInput value={ajustes.reservePercent} onChange={(v) => setAjustes({ ...ajustes, reservePercent: v })} aria-label="Reserva antes de dividir" /></Field>
            <Field label="Saldo inicial"><MoneyInput value={ajustes.openingBalance} onChange={(v) => setAjustes({ ...ajustes, openingBalance: v ?? 0 })} aria-label="Saldo inicial" /></Field>
            <Field label="Data do saldo"><DateInput value={ajustes.openingDate ?? ''} clearable onChange={(v) => setAjustes({ ...ajustes, openingDate: v || null })} aria-label="Data do saldo inicial" /></Field>
          </div>
          <p className="text-[11px] text-faint">Reserva: % do resultado que fica no caixa antes de dividir. Saldo inicial: quanto tinha na conta na data ao lado — o caixa conta a partir dela.</p>
          <div className="flex justify-end"><Button size="sm" onClick={salvarAjustes} loading={w.isPending}>Salvar</Button></div>
        </Secao>
      </div>

      <Secao titulo="Impostos automáticos" desc="Percentual sobre o que entrou no mês (ex.: Simples Nacional com a alíquota efetiva). Vira uma conta a pagar no próprio mês, vencendo no mês seguinte, e se ajusta sozinha até você pagar ou corrigir o valor pela guia."
        acao={<Button size="sm" icon={<Plus size={14} />} onClick={() => setImposto('novo')}>Imposto</Button>}>
        {!cfg.taxRules.length ? <p className="text-sm text-faint">Nenhum imposto automático. Imposto de valor fixo (taxa, alvará, parcelamento) entra como custo fixo ou lançamento avulso.</p> : (
          <ul className="divide-y divide-line">
            {cfg.taxRules.map((t) => (
              <li key={t.id} className={cn('flex items-center gap-3 py-2 text-sm', !t.isActive && 'opacity-50')}>
                <span className="flex-1 min-w-0"><span className="text-ink font-medium">{t.name}</span> <span className="text-xs text-muted">· {nomeCat(t.categoryId)} · {FINANCE_TAX_BASE_LABEL[t.base].toLowerCase()} · vence dia {t.dueDay} do mês seguinte{!t.isActive && ' · desligado'}</span></span>
                <b className="tnum">{t.percent.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%</b>
                <button type="button" className="text-faint hover:text-ink p-1" title="Editar" onClick={() => setImposto(t)}><Pencil size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <ListaFixos titulo="Folha de pagamento e pró-labore" desc="Salários, encargos, benefícios e o pró-labore dos sócios. Entram sozinhos como conta do mês." itens={folha} cats={cfg.categories} onNovo={() => setFixo({ item: null, folha: true })} onEditar={(item) => setFixo({ item, folha: true })} />
      <ListaFixos titulo="Custos e despesas fixos" desc="Servidores, ferramentas, contador, aluguel, parcelamentos… Mensais, trimestrais ou anuais. No mês em que não houver, risque o lançamento." itens={fixos} cats={cfg.categories} onNovo={() => setFixo({ item: null, folha: false })} onEditar={(item) => setFixo({ item, folha: false })} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Secao titulo="Categorias" desc="O grupo decide a linha do fechamento. As de fábrica podem ser renomeadas ou desativadas." acao={<Button size="sm" icon={<Plus size={14} />} onClick={() => setCategoria('novo')}>Categoria</Button>}>
          <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
            {(['tax', 'cost', 'expense', 'payroll', 'prolabore', 'revenue'] as FinanceSection[]).map((g) => (
              <div key={g}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-faint mb-1">{FINANCE_SECTION_LABEL[g]}</p>
                <ul className="divide-y divide-line">
                  {cfg.categories.filter((c) => c.section === g).map((c) => (
                    <li key={c.id} className={cn('flex items-center gap-2 py-1.5 text-sm', !c.isActive && 'opacity-50')}>
                      <span className="flex-1 text-ink">{c.name}{!c.isActive && <span className="text-xs text-muted"> (desativada)</span>}</span>
                      <button type="button" className="text-faint hover:text-ink p-1" title="Editar" onClick={() => setCategoria(c)}><Pencil size={13} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Secao>

        <Secao titulo="Fornecedores" desc="Para quem você paga: contador, Oracle, Meta, Receita, funcionários…" acao={<Button size="sm" icon={<Plus size={14} />} onClick={() => setFornecedor('novo')}>Fornecedor</Button>}>
          {!cfg.suppliers.length ? <p className="text-sm text-faint">Nenhum fornecedor. Dá para cadastrar também direto no lançamento.</p> : (
            <ul className="divide-y divide-line max-h-[28rem] overflow-y-auto pr-1">
              {cfg.suppliers.map((f) => (
                <li key={f.id} className={cn('flex items-center gap-2 py-1.5 text-sm', !f.isActive && 'opacity-50')}>
                  <span className="flex-1 min-w-0"><span className="text-ink">{f.name}</span>{f.document && <span className="text-xs text-muted tnum"> · {formatDoc(f.document)}</span>}{!f.isActive && <span className="text-xs text-muted"> (inativo)</span>}</span>
                  {f.pixKey && <button type="button" className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1" title="Copiar chave Pix" onClick={() => navigator.clipboard.writeText(f.pixKey!).then(() => toast.ok('Chave Pix copiada'), toast.err)}><Copy size={11} /> Pix</button>}
                  <button type="button" className="text-faint hover:text-ink p-1" title="Editar" onClick={() => setFornecedor(f)}><Pencil size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      {socio && <SocioModal socio={socio === 'novo' ? null : socio} outros={ativos.filter((p) => socio === 'novo' || p.id !== socio.id)} onClose={() => setSocio(null)} />}
      {fixo && <FixoModal item={fixo.item} folha={fixo.folha} cfg={cfg} onClose={() => setFixo(null)} />}
      {imposto && <ImpostoModal item={imposto === 'novo' ? null : imposto} cfg={cfg} onClose={() => setImposto(null)} />}
      {categoria && <CategoriaModal item={categoria === 'novo' ? null : categoria} onClose={() => setCategoria(null)} />}
      {fornecedor && <FornecedorModal item={fornecedor === 'novo' ? null : fornecedor} onClose={() => setFornecedor(null)} />}
    </div>
  );
}

function ListaFixos({ titulo, desc, itens, cats, onNovo, onEditar }: { titulo: string; desc: string; itens: Config['recurring']; cats: Config['categories']; onNovo: () => void; onEditar: (i: Config['recurring'][number]) => void }) {
  // equivalente mensal: anual conta 1/12 por mês, para o total fazer sentido
  const total = itens.filter((i) => i.isActive).reduce((s, i) => s + i.amount / ({ monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }[i.frequency] ?? 1), 0);
  const nomeCat = (id: string) => cats.find((c) => c.id === id)?.name ?? id;
  return (
    <Secao titulo={titulo} desc={desc} acao={<Button size="sm" icon={<Plus size={14} />} onClick={onNovo}>Adicionar</Button>}>
      {!itens.length ? <p className="text-sm text-faint">Nada cadastrado.</p> : (
        <ul className="divide-y divide-line">
          {itens.map((i) => (
            <li key={i.id} className={cn('flex items-center gap-3 py-2 text-sm', !i.isActive && 'opacity-50')}>
              <span className="flex-1 min-w-0">
                <span className="text-ink">{i.description}</span>
                <span className="block text-xs text-muted">
                  {[nomeCat(i.category), i.supplier, `${FINANCE_FREQUENCY_LABEL[i.frequency]}, dia ${i.dayOfMonth}`, i.autoPaid && 'débito automático', i.endPeriod && `até ${mesCurto(i.endPeriod)}`, !i.isActive && 'pausado'].filter(Boolean).join(' · ')}
                </span>
              </span>
              <b className="tnum">{brl(i.amount)}</b>
              <button type="button" className="text-faint hover:text-ink p-1" title="Editar" onClick={() => onEditar(i)}><Pencil size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted text-right">Equivale a <b className="text-ink tnum">{brl(total)}</b> por mês</p>
    </Secao>
  );
}

function SocioModal({ socio, outros, onClose }: { socio: ClosingConfig['partners'][number] | null; outros: ClosingConfig['partners']; onClose: () => void }) {
  const w = useClosingWrite();
  // quanto dos 100% os demais sócios ativos já ocupam: o que falta é a sugestão para este
  const ocupado = Math.round(outros.reduce((s, p) => s + p.sharePercent, 0) * 100) / 100;
  const falta = Math.max(0, Math.round((100 - ocupado) * 100) / 100);
  const [f, setF] = useState({ name: socio?.name ?? '', sharePercent: socio?.sharePercent ?? (outros.length ? falta : 0), pixKey: socio?.pixKey ?? '', isActive: socio?.isActive ?? true });
  const total = Math.round((ocupado + (f.isActive ? f.sharePercent : 0)) * 100) / 100;
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await w.mutateAsync(socio ? { path: `partners/${socio.id}`, method: 'PUT', body: f } : { path: 'partners', body: f });
      onClose();
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open onClose={onClose} title={socio ? 'Editar sócio' : 'Novo sócio'} width="max-w-md">
      <form onSubmit={salvar} className="space-y-3">
        <Field label="Nome"><input className={inputCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Participação no lucro"><PercentInput value={f.sharePercent} onChange={(v) => setF({ ...f, sharePercent: v })} aria-label="Participação no lucro" /></Field>
          <Field label="Chave Pix"><input className={inputCls} value={f.pixKey} maxLength={120} placeholder="Opcional" onChange={(e) => setF({ ...f, pixKey: e.target.value })} /></Field>
        </div>
        {outros.length > 0 && (
          <div className="rounded-lg bg-field px-3 py-2 text-xs text-muted space-y-1">
            <p>Os outros sócios somam <b className="text-ink tnum">{ocupado.toLocaleString('pt-BR')}%</b>{outros.length <= 4 && ` (${outros.map((p) => `${p.name} ${p.sharePercent.toLocaleString('pt-BR')}%`).join(', ')})`}.</p>
            <p className="flex items-center justify-between gap-2 flex-wrap">
              <span className={total === 100 ? 'text-ok' : 'text-warn-ink'}>Com este, o total fica em <b className="tnum">{total.toLocaleString('pt-BR')}%</b>{total === 100 ? ' ✓' : total > 100 ? ' — passa de 100%' : ' — falta para 100%'}</span>
              {f.isActive && f.sharePercent !== falta && falta > 0 && <button type="button" className="font-semibold text-accent-ink hover:underline" onClick={() => setF({ ...f, sharePercent: falta })}>Usar {falta.toLocaleString('pt-BR')}%</button>}
            </p>
          </div>
        )}
        {socio && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo (entra na divisão)</label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={w.isPending}>Salvar</Button></div>
      </form>
    </Modal>
  );
}

function FixoModal({ item, folha, cfg, onClose }: { item: Config['recurring'][number] | null; folha: boolean; cfg: Config; onClose: () => void }) {
  const w = useClosingWrite();
  const secoes: FinanceSection[] = folha ? ['payroll', 'prolabore'] : ['tax', 'cost', 'expense'];
  const [f, setF] = useState({
    category: item?.category ?? (folha ? 'folha' : ''), description: item?.description ?? '', amount: item?.amount ?? 0, dayOfMonth: item?.dayOfMonth ?? 5,
    isActive: item?.isActive ?? true, frequency: (item?.frequency ?? 'monthly') as FinanceFrequency, startPeriod: item?.startPeriod ?? mesAtual(),
    endPeriod: item?.endPeriod ?? '', autoPaid: item?.autoPaid ?? false, paymentMethod: item?.paymentMethod ?? '', supplierId: item?.supplierId ?? '', notes: item?.notes ?? '',
  });
  const [temFim, setTemFim] = useState(!!item?.endPeriod);
  const set = (p: Partial<typeof f>) => setF((v) => ({ ...v, ...p }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.category) return toast.warn('Escolha a categoria');
    if (f.amount <= 0) return toast.warn('Informe o valor');
    if (temFim && f.endPeriod && f.endPeriod < f.startPeriod) return toast.warn('O mês final é antes do início');
    const body = { ...f, endPeriod: temFim ? f.endPeriod || f.startPeriod : null, paymentMethod: f.paymentMethod || null, supplierId: f.supplierId || null, notes: f.notes || null, ...(item && { startPeriod: undefined }) };
    try {
      await w.mutateAsync(item ? { path: `recurring/${item.id}`, method: 'PUT', body } : { path: 'recurring', body });
      toast.ok(item ? 'Atualizado — vale a partir do mês aberto' : 'Cadastrado — entra a partir do mês de início');
      onClose();
    } catch (err) { toast.err(err); }
  }
  const remover = () => {
    if (!item || !confirm('Remover? Sai do mês aberto; meses já lançados não mudam.')) return;
    w.mutateAsync({ path: `recurring/${item.id}`, method: 'DELETE' }).then(onClose, toast.err);
  };
  return (
    <Modal open onClose={onClose} title={item ? 'Editar' : folha ? 'Folha / pró-labore' : 'Custo fixo'} width="max-w-2xl">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Categoria"><SelectCategoria cats={cfg.categories} value={f.category} onChange={(category) => set({ category })} sections={secoes} /></Field>
          <Field label={folha ? 'Pessoa / favorecido' : 'Fornecedor'}><SelectFornecedor sups={cfg.suppliers} value={f.supplierId} onChange={(supplierId) => set({ supplierId })} /></Field>
        </div>
        <Field label="Descrição">
          <input className={inputCls} value={f.description} maxLength={160} onChange={(e) => set({ description: e.target.value })} placeholder={folha ? 'Ex.: Ana — suporte; INSS da folha; VR' : 'Ex.: Servidor Oracle, Contador, Parcelamento do Simples'} required autoFocus />
        </Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Valor"><MoneyInput value={f.amount} onChange={(v) => set({ amount: v ?? 0 })} aria-label="Valor" /></Field>
          <Field label="Repete">
            <select className={inputCls} value={f.frequency} onChange={(e) => set({ frequency: e.target.value as FinanceFrequency })}>
              {FINANCE_FREQUENCIES.map((x) => <option key={x} value={x}>{FINANCE_FREQUENCY_LABEL[x]}</option>)}
            </select>
          </Field>
          <Field label="Dia do vencimento">
            <select className={inputCls} value={f.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Dia {d}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Começa em">
            {item ? <Fixo><span className="capitalize text-ink">{nomeMes(f.startPeriod)}</span></Fixo> : <MonthPicker block value={f.startPeriod} onChange={(startPeriod) => set({ startPeriod })} />}
          </Field>
          <Field label="Termina">
            <select className={inputCls} value={temFim ? 'sim' : 'nao'} onChange={(e) => { const sim = e.target.value === 'sim'; setTemFim(sim); if (sim && !f.endPeriod) set({ endPeriod: f.startPeriod }); }}>
              <option value="nao">Sem data para acabar</option>
              <option value="sim">Em um mês definido</option>
            </select>
          </Field>
          <Field label="Último mês">
            {temFim ? <MonthPicker block value={f.endPeriod || f.startPeriod} min={f.startPeriod} onChange={(endPeriod) => set({ endPeriod })} /> : <Fixo>—</Fixo>}
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Forma de pagamento"><SelectMetodo value={f.paymentMethod} onChange={(paymentMethod) => set({ paymentMethod })} /></Field>
          <Field label="Baixa">
            <select className={inputCls} value={f.autoPaid ? 'auto' : 'manual'} onChange={(e) => set({ autoPaid: e.target.value === 'auto' })}>
              <option value="manual">Eu dou baixa quando pagar</option>
              <option value="auto">Débito automático / cartão (já entra pago)</option>
            </select>
          </Field>
        </div>
        <p className="-mt-2 text-[11px] text-faint">{f.frequency === 'monthly' ? 'Lança todo mês' : `${FINANCE_FREQUENCY_LABEL[f.frequency]}, contando do mês de início`}, no dia {f.dayOfMonth} (em mês mais curto, no último dia).</p>
        <Field label="Observações"><textarea className={cn(inputCls, 'min-h-[50px]')} value={f.notes} maxLength={1000} placeholder="Opcional" onChange={(e) => set({ notes: e.target.value })} /></Field>
        {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Ativo (continua lançando)</label>}
        <div className="flex items-center gap-2">
          {item && <Button type="button" variant="ghost" className="text-danger" icon={<Trash2 size={14} />} onClick={remover}>Remover</Button>}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={w.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImpostoModal({ item, cfg, onClose }: { item: Config['taxRules'][number] | null; cfg: Config; onClose: () => void }) {
  const w = useClosingWrite();
  const [f, setF] = useState({ name: item?.name ?? '', categoryId: item?.categoryId ?? 'das', percent: item?.percent ?? 0, base: (item?.base ?? 'all') as FinanceTaxBase, dueDay: item?.dueDay ?? 20, isActive: item?.isActive ?? true, startPeriod: item?.startPeriod ?? mesAtual() });
  const set = (p: Partial<typeof f>) => setF((v) => ({ ...v, ...p }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (f.percent <= 0) return toast.warn('Informe o percentual');
    try {
      await w.mutateAsync(item ? { path: `tax-rules/${item.id}`, method: 'PUT', body: { ...f, startPeriod: undefined } } : { path: 'tax-rules', body: f });
      toast.ok('Imposto salvo — o mês aberto já recalcula');
      onClose();
    } catch (err) { toast.err(err); }
  }
  const remover = () => {
    if (!item || !confirm('Remover este imposto? Sai dos meses abertos o que ainda não foi pago; o que já foi pago ou fechado fica.')) return;
    w.mutateAsync({ path: `tax-rules/${item.id}`, method: 'DELETE' }).then(onClose, toast.err);
  };
  return (
    <Modal open onClose={onClose} title={item ? 'Editar imposto' : 'Imposto automático'} width="max-w-lg">
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome"><input className={inputCls} value={f.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Simples Nacional, ISS" required autoFocus /></Field>
          <Field label="Categoria"><SelectCategoria cats={cfg.categories} value={f.categoryId} onChange={(categoryId) => set({ categoryId })} sections={['tax']} /></Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Alíquota"><PercentInput value={f.percent} onChange={(percent) => set({ percent })} aria-label="Alíquota" /></Field>
          <Field label="Sobre">
            <select className={inputCls} value={f.base} onChange={(e) => set({ base: e.target.value as FinanceTaxBase })}>
              {FINANCE_TAX_BASES.map((b) => <option key={b} value={b}>{FINANCE_TAX_BASE_LABEL[b]}</option>)}
            </select>
          </Field>
          <Field label="Vence no mês seguinte">
            <select className={inputCls} value={f.dueDay} onChange={(e) => set({ dueDay: Number(e.target.value) })}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Dia {d}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Vale a partir de">{item ? <Fixo><span className="capitalize text-ink">{nomeMes(f.startPeriod)}</span></Fixo> : <MonthPicker block value={f.startPeriod} onChange={(startPeriod) => set({ startPeriod })} />}</Field>
        </div>
        <p className="-mt-1 text-[11px] text-faint">No Simples Nacional, use a alíquota efetiva que vem no DAS.</p>
        {f.percent > 0 && <p className="text-xs rounded-lg bg-field text-muted px-3 py-2">Exemplo: entrou {brl(10000)} em outubro → lança {brl((10000 * f.percent) / 100)} em outubro, vencendo dia {f.dueDay}/11. Se a guia vier diferente, corrija o valor no lançamento.</p>}
        {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Ligado</label>}
        <div className="flex items-center gap-2">
          {item && <Button type="button" variant="ghost" className="text-danger" icon={<Trash2 size={14} />} onClick={remover}>Remover</Button>}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={w.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

function CategoriaModal({ item, onClose }: { item: Config['categories'][number] | null; onClose: () => void }) {
  const w = useClosingWrite();
  const [f, setF] = useState({ name: item?.name ?? '', section: (item?.section ?? 'expense') as FinanceSection, isActive: item?.isActive ?? true });
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await w.mutateAsync(item ? { path: `categories/${item.id}`, method: 'PUT', body: f } : { path: 'categories', body: f });
      onClose();
    } catch (err) { toast.err(err); }
  }
  const remover = () => {
    if (!item || !confirm('Excluir esta categoria? Se já tiver lançamentos, ela só é desativada (o histórico continua com o nome).')) return;
    w.mutateAsync({ path: `categories/${item.id}`, method: 'DELETE' }).then(onClose, toast.err);
  };
  return (
    <Modal open onClose={onClose} title={item ? 'Editar categoria' : 'Nova categoria'} width="max-w-md">
      <form onSubmit={salvar} className="space-y-3">
        <Field label="Nome"><input className={inputCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
        <Field label="Grupo no fechamento" hint={item?.system ? 'Categoria de fábrica: o grupo não muda.' : FINANCE_SECTION_HINT[f.section]}>
          <select className={inputCls} value={f.section} disabled={item?.system} onChange={(e) => setF({ ...f, section: e.target.value as FinanceSection })}>
            {FINANCE_SECTIONS.map((x) => <option key={x} value={x}>{FINANCE_SECTION_LABEL[x]}</option>)}
          </select>
        </Field>
        {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativa (aparece para lançar)</label>}
        <div className="flex items-center gap-2">
          {item && !item.system && <Button type="button" variant="ghost" className="text-danger" icon={<Trash2 size={14} />} onClick={remover}>Excluir</Button>}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={w.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Também abre de dentro do lançamento ("cadastrar novo"): devolve o id criado no `onClose`. */
function FornecedorModal({ item, onClose }: { item: Config['suppliers'][number] | null; onClose: (createdId?: string) => void }) {
  const w = useClosingWrite();
  const [f, setF] = useState({ name: item?.name ?? '', document: formatDoc(item?.document ?? ''), pixKey: item?.pixKey ?? '', notes: item?.notes ?? '', isActive: item?.isActive ?? true });
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    // aberto de dentro de outro formulário (portal): o submit não pode subir até o de fora
    e.stopPropagation();
    if (f.document && !isValidCpfCnpj(f.document)) return toast.warn('CPF/CNPJ inválido');
    try {
      const r = (await w.mutateAsync(item ? { path: `suppliers/${item.id}`, method: 'PUT', body: f } : { path: 'suppliers', body: f })) as { saved?: string };
      onClose(r.saved);
    } catch (err) { toast.err(err); }
  }
  const remover = () => {
    if (!item || !confirm('Excluir este fornecedor? Se já tiver lançamentos, ele só é desativado.')) return;
    w.mutateAsync({ path: `suppliers/${item.id}`, method: 'DELETE' }).then(() => onClose(), toast.err);
  };
  return createPortal(
    <Modal open onClose={() => onClose()} title={item ? 'Editar fornecedor' : 'Novo fornecedor'} width="max-w-md">
      <form onSubmit={salvar} className="space-y-3">
        <Field label="Nome"><input className={inputCls} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Contabilidade Silva, Oracle, Receita Federal" required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPF / CNPJ"><input className={cn(inputCls, 'tnum')} inputMode="numeric" value={f.document} maxLength={18} placeholder="Opcional" onChange={(e) => setF({ ...f, document: formatDoc(e.target.value) })} /></Field>
          <Field label="Chave Pix"><input className={inputCls} value={f.pixKey} maxLength={120} placeholder="Opcional" onChange={(e) => setF({ ...f, pixKey: e.target.value })} /></Field>
        </div>
        <Field label="Observações"><textarea className={cn(inputCls, 'min-h-[50px]')} value={f.notes} maxLength={1000} placeholder="Opcional" onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo</label>}
        <div className="flex items-center gap-2">
          {item && <Button type="button" variant="ghost" className="text-danger" icon={<Trash2 size={14} />} onClick={remover}>Excluir</Button>}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={() => onClose()}>Cancelar</Button>
          <Button type="submit" loading={w.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>,
    document.body,
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="rounded-2xl bg-panel border border-line p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted">{icon}{label}</div>
      <div className={cn('text-xl font-semibold tnum mt-1', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</div>
      {sub && <div className="text-xs text-faint mt-0.5">{sub}</div>}
    </div>
  );
}
