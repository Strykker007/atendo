'use client';
import { useState } from 'react';
import { RefreshCw, ShieldCheck, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { formatPhone } from '@/components/ui/PhoneInput';
import { useMetaCosts, useMetaCostsWrite, type MetaCosts } from '@/lib/hooks';

const money = (v: number, currency = 'BRL') => v.toLocaleString('pt-BR', { style: 'currency', currency });

/** categorias como a Meta e o ledger nomeiam → como o cliente lê */
const CATEGORIA: Record<string, string> = {
  marketing: 'Marketing', MARKETING: 'Marketing', MARKETING_LITE: 'Marketing',
  utility: 'Utilidade', UTILITY: 'Utilidade',
  authentication: 'Autenticação', AUTHENTICATION: 'Autenticação', AUTHENTICATION_INTERNATIONAL: 'Autenticação (internacional)',
  service: 'Atendimento (resposta em 24h)', SERVICE: 'Atendimento (resposta em 24h)',
};
const TIPO: Record<string, string> = { FREE_CUSTOMER_SERVICE: 'grátis: janela de 24h', FREE_ENTRY_POINT: 'grátis: veio de anúncio' };

/** últimos 6 meses, do atual para trás */
function meses() {
  const d = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const p = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    return { p, label: m.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) };
  });
}

/**
 * Gasto com a API oficial (docs/gasto-meta.md). A Meta cobra o cliente direto; aqui ele
 * acompanha a estimativa (na hora), o valor real da Meta (a cada 6 h), a projeção do mês e o
 * orçamento com aviso em 80%/100%. Só aparece para quem tem número oficial.
 */
export function MetaCostsSection() {
  const opcoes = meses();
  const [period, setPeriod] = useState(opcoes[0].p);
  const q = useMetaCosts(period);
  const w = useMetaCostsWrite();
  const d = q.data;
  if (!d?.hasMeta) return null;
  const corrente = period === opcoes[0].p;
  const realBrl = d.real?.currency === 'BRL' ? d.real.total : null;
  // o que conta contra o orçamento: o maior entre estimativa e real (em reais)
  const gasto = Math.max(d.estimated, realBrl ?? 0);

  return (
    <section id="gasto-meta" className="rounded-2xl bg-panel border border-line overflow-hidden scroll-mt-4">
      <div className="px-5 py-3 border-b border-line flex flex-wrap items-center gap-2">
        <span className="font-display font-semibold text-ink flex items-center gap-2"><ShieldCheck size={16} className="text-meta-ink" /> Gasto com a Meta (API oficial)</span>
        <div className="ml-auto flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={cn(inputCls, 'h-9 py-0 w-auto capitalize')}>
            {opcoes.map((o) => <option key={o.p} value={o.p}>{o.label}</option>)}
          </select>
          {corrente && (
            <Button variant="ghost" onClick={() => w.refresh.mutate(undefined, { onSuccess: () => toast.ok('Gasto atualizado com a Meta'), onError: (e) => toast.err(e) })} loading={w.refresh.isPending} loadingText="Lendo…">
              <RefreshCw size={14} /> Atualizar
            </Button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Estimativa do Atendo" value={money(d.estimated)} hint="Pela tabela de preços, a cada envio" />
          <Kpi
            label="Valor apurado pela Meta"
            value={d.real ? money(d.real.total, d.real.currency) : '—'}
            hint={d.real?.updatedAt ? `Atualizado em ${new Date(d.real.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'A Meta fecha o dia com algumas horas de atraso'}
          />
          {corrente && <Kpi label="Projeção do mês" value={d.projection != null ? money(d.projection) : '—'} hint="No ritmo atual até o fim do mês" />}
          <Orcamento d={d} gasto={gasto} corrente={corrente} />
        </div>

        {d.real && d.real.currency !== 'BRL' && (
          <p className="text-xs text-faint">A conta do WhatsApp é cobrada em {d.real.currency}: o orçamento compara com a estimativa em reais.</p>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-ink mb-2">Por número</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1.5">Número</th><th className="py-1.5 text-right">Estimativa</th><th className="py-1.5 text-right">Meta</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.byNumber.map((n) => (
                  <tr key={n.numberId} className={cn(!n.isActive && 'text-faint')}>
                    <td className="py-2"><span className="text-ink">{n.label}</span> <span className="text-muted tnum text-xs">{formatPhone(n.phone)}</span></td>
                    <td className="py-2 text-right tnum">{money(n.estimated)}</td>
                    <td className="py-2 text-right tnum">{n.real != null && d.real ? money(n.real, d.real.currency) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="text-sm font-medium text-ink mb-2">Por tipo de mensagem</h3>
            <PorTipo d={d} />
          </div>
        </div>

        <p className="text-xs text-faint">
          A Meta cobra direto no cartão cadastrado na conta do WhatsApp: este painel é para acompanhar, não é fatura do Atendo.
          Custam as mensagens de modelo (marketing, utilidade, autenticação); responder em até 24 horas da última mensagem do cliente é grátis.
          A estimativa sai na hora; o valor da Meta é lido a cada 6 horas e é o que vale.
        </p>
      </div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-field p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold tnum mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-faint mt-0.5">{hint}</p>}
    </div>
  );
}

/** real da Meta quando já existe (é o que vale); senão, a estimativa por categoria do template */
function PorTipo({ d }: { d: MetaCosts }) {
  const linhas = d.byCategory.real.length
    ? d.byCategory.real.map((c) => ({ k: `${c.category}|${c.type}`, nome: CATEGORIA[c.category] ?? c.category, extra: TIPO[c.type], qtd: c.volume, custo: money(c.cost, d.real?.currency) }))
    : d.byCategory.estimated.map((c) => ({ k: c.category, nome: CATEGORIA[c.category] ?? c.category, extra: undefined, qtd: c.count, custo: money(c.cost) }));
  if (!linhas.length) return <p className="text-sm text-faint">Nenhuma mensagem pela API oficial neste mês.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted"><tr><th className="py-1.5">Tipo</th><th className="py-1.5 text-right">Mensagens</th><th className="py-1.5 text-right">{d.byCategory.real.length ? 'Meta' : 'Estimativa'}</th></tr></thead>
      <tbody className="divide-y divide-line">
        {linhas.sort((a, b) => b.qtd - a.qtd).map((l) => (
          <tr key={l.k}>
            <td className="py-2 text-ink">{l.nome}{l.extra && <span className="text-xs text-faint"> · {l.extra}</span>}</td>
            <td className="py-2 text-right tnum">{l.qtd.toLocaleString('pt-BR')}</td>
            <td className="py-2 text-right tnum">{l.custo}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Orcamento({ d, gasto, corrente }: { d: MetaCosts; gasto: number; corrente: boolean }) {
  const w = useMetaCostsWrite();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(d.budget != null ? String(d.budget).replace('.', ',') : '');
  const ratio = d.budget ? gasto / d.budget : 0;
  const pct = Math.min(100, Math.round(ratio * 100));

  function salvar(v: number | null) {
    w.budget.mutate(v, {
      onSuccess: () => { toast.ok(v ? 'Orçamento salvo' : 'Orçamento removido'); setEditando(false); },
      onError: (e) => toast.err(e),
    });
  }

  if (editando) {
    const n = Number(valor.replace(/\./g, '').replace(',', '.'));
    const ok = valor.trim() !== '' && Number.isFinite(n) && n > 0;
    return (
      <div className="rounded-xl bg-field p-3.5 space-y-2">
        <p className="text-xs text-muted">Orçamento mensal (R$)</p>
        <input autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 500,00" className={cn(inputCls, 'h-9 py-0')} onKeyDown={(e) => { if (e.key === 'Enter' && ok) salvar(n); }} />
        <div className="flex gap-2">
          <Button onClick={() => salvar(n)} disabled={!ok} loading={w.budget.isPending}>Salvar</Button>
          {d.budget != null && <Button variant="ghost" onClick={() => salvar(null)}>Remover</Button>}
          <Button variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
        </div>
        <p className="text-[11px] text-faint">Aviso por e-mail em 80% e 100%. O envio não é bloqueado.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-field p-3.5">
      <div className="flex items-center gap-1">
        <p className="text-xs text-muted">Orçamento do mês</p>
        <button type="button" onClick={() => setEditando(true)} className="ml-auto text-faint hover:text-ink" aria-label="Editar orçamento"><Pencil size={13} /></button>
      </div>
      {d.budget ? (
        <>
          <p className="text-xl font-semibold tnum mt-0.5">{money(d.budget)}</p>
          {corrente && (
            <>
              <div className="h-1.5 rounded-full bg-panel overflow-hidden mt-1.5"><div className={cn('h-full rounded-full', ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warn' : 'bg-accent')} style={{ width: `${pct}%` }} /></div>
              <p className={cn('text-[11px] mt-1', ratio >= 1 ? 'text-danger' : ratio >= 0.8 ? 'text-warn' : 'text-faint')}>{pct}% usado{ratio >= 1 ? ' — passou do orçamento' : ''}</p>
            </>
          )}
        </>
      ) : (
        <button type="button" onClick={() => setEditando(true)} className="mt-1 text-sm text-accent-ink hover:underline">Definir orçamento</button>
      )}
    </div>
  );
}
