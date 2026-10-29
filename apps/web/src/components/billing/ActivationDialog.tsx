'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, ExternalLink, Check, X } from 'lucide-react';
import { isValidCpfCnpj } from '@atendo/shared';
import { cn, formatDoc } from '@/lib/utils';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { useActivation, useActivationAction, useCreateActivation, type ActivationCharge, type ActivationItem } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR');
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const maisDias = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const SITUACAO: Record<ActivationCharge['status'], [string, string]> = {
  pending: ['Aguardando pagamento', 'bg-warn-soft text-warn-ink'],
  paid: ['Paga — conta ativa', 'bg-ok-soft text-ok'],
  canceled: ['Cancelada', 'bg-field text-muted'],
};

/**
 * Cobrança de ativação de um cliente (só o dono — docs/05-planos-e-cobranca.md#cobrança-de-ativação).
 * Instalação + 1ª mensalidade (+ o que mais houver) num Pix; até pagar, o cliente configura mas
 * não envia. Pago, a conta ativa sozinha e a mensalidade recorrente por Pix nasce no Asaas.
 */
export function ActivationDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const q = useActivation(tenantId);
  const criar = useCreateActivation(tenantId);
  const acao = useActivationAction(tenantId);
  const [itens, setItens] = useState<ActivationItem[]>([]);
  const [desconto, setDesconto] = useState(0);
  const [vence, setVence] = useState(maisDias(3));
  const [doc, setDoc] = useState('');
  const d = q.data;
  // itens sugeridos: instalação (o dono digita) e a 1ª mensalidade do valor contratado
  useEffect(() => {
    if (!d || itens.length) return;
    setItens([
      { description: 'Instalação e configuração', value: 0, kind: 'setup' },
      ...(d.firstMonthValue > 0 ? [{ description: `1ª mensalidade — ${d.planName}`, value: d.firstMonthValue, kind: 'first_month' as const }] : []),
    ]);
    setDoc(formatDoc(d.document ?? ''));
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const aberta = d?.charges.find((c) => c.status === 'pending');
  const total = Math.round((itens.reduce((s, i) => s + (i.value || 0), 0) - desconto) * 100) / 100;
  const mudar = (i: number, p: Partial<ActivationItem>) => setItens((l) => l.map((it, j) => (j === i ? { ...it, ...p } : it)));

  async function gerar() {
    const validos = itens.filter((i) => i.description.trim() && i.value > 0);
    if (!validos.length) return toast.warn('Lance ao menos um item com valor');
    if (total < 5) return toast.warn('O total precisa ser de pelo menos R$ 5,00');
    if (!isValidCpfCnpj(doc)) return toast.warn('Informe um CPF ou CNPJ válido do cliente');
    try {
      await criar.mutateAsync({ items: validos, discount: desconto || undefined, dueDate: vence, document: doc });
      toast.ok('Pix gerado — o admin do cliente vê o aviso no painel e recebe por e-mail');
    } catch (e) { toast.err(e); }
  }

  return (
    <Modal open onClose={onClose} title={`Cobrança de ativação — ${d?.tenantName ?? ''}`} width="max-w-2xl">
      {!d ? <SkeletonRows rows={4} /> : (
        <div className="space-y-5">
          {!d.asaasConfigured && <p className="rounded-xl bg-warn-soft text-warn-ink px-3 py-2 text-sm">Asaas não configurado no servidor (ASAAS_API_KEY): não dá para gerar o Pix.</p>}

          {aberta ? (
            <Cobranca c={aberta} acao={acao} />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted">Lance os custos de entrada. O cliente já pode configurar tudo, mas só envia mensagens depois de pagar. Pago o Pix, a conta ativa sozinha e a mensalidade de {brl(d.firstMonthValue)} passa a ser cobrada por Pix todo mês, a partir de um mês depois.</p>
              <div className="space-y-2">
                {itens.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_9rem_2rem] gap-2 items-center">
                    <input className={inputCls} value={it.description} maxLength={120} placeholder="Ex.: Treinamento da equipe" onChange={(e) => mudar(i, { description: e.target.value })} />
                    <MoneyInput value={it.value} onChange={(v) => mudar(i, { value: v ?? 0 })} aria-label="Valor" />
                    <button type="button" className="text-faint hover:text-danger justify-self-center" title="Remover item" aria-label="Remover item" onClick={() => setItens((l) => l.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" icon={<Plus size={14} />} disabled={itens.length >= 20} onClick={() => setItens((l) => [...l, { description: '', value: 0, kind: 'other' }])}>Adicionar item</Button>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Desconto (opcional)"><MoneyInput value={desconto} onChange={(v) => setDesconto(v ?? 0)} aria-label="Desconto" /></Field>
                <Field label="Vencimento"><input type="date" className={inputCls} min={hojeSP()} value={vence} onChange={(e) => setVence(e.target.value)} /></Field>
                <Field label="CPF / CNPJ do cliente" hint={d.document ? 'Do cadastro.' : 'Vai para o cadastro do cliente.'}>
                  <input className={cn(inputCls, 'tnum')} inputMode="numeric" value={doc} maxLength={18} placeholder="00.000.000/0000-00" onChange={(e) => setDoc(formatDoc(e.target.value))} />
                </Field>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm text-muted">Total do Pix <b className="text-ink tnum text-base ml-1">{brl(Math.max(0, total))}</b></span>
                <Button onClick={gerar} loading={criar.isPending} loadingText="Gerando Pix…" disabled={!d.asaasConfigured}>Gerar Pix de ativação</Button>
              </div>
            </div>
          )}

          {d.charges.filter((c) => c.id !== aberta?.id).length > 0 && (
            <div className="space-y-2 border-t border-line pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Histórico</h3>
              {d.charges.filter((c) => c.id !== aberta?.id).map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm flex-wrap">
                  <b className="tnum">{brl(c.totalValue)}</b>
                  <span className={cn('text-[11px] rounded-full px-2 py-0.5', SITUACAO[c.status][1])}>{SITUACAO[c.status][0]}</span>
                  <span className="text-xs text-muted">{c.items.map((i) => i.description).join(', ')}</span>
                  <span className="flex-1" />
                  <span className="text-[11px] text-faint">{c.paidAt ? `paga ${new Date(c.paidAt).toLocaleDateString('pt-BR')}${c.paidVia === 'manual' ? ' (por fora)' : ''}` : new Date(c.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Cobranca({ c, acao }: { c: ActivationCharge; acao: ReturnType<typeof useActivationAction> }) {
  const fazer = (action: 'cancel' | 'paid', msg: string, ok: string) => {
    if (!confirm(msg)) return;
    acao.mutateAsync({ id: c.id, action }).then(() => toast.ok(ok), toast.err);
  };
  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <b className="tnum text-lg">{brl(c.totalValue)}</b>
        <span className={cn('text-[11px] rounded-full px-2 py-0.5', SITUACAO.pending[1])}>{SITUACAO.pending[0]}</span>
        <span className="text-xs text-muted">vence {dataBR(c.dueDate)}</span>
      </div>
      <ul className="text-sm space-y-0.5">
        {c.items.map((i, k) => <li key={k} className="flex justify-between gap-3"><span>{i.description}</span><span className="tnum">{brl(i.value)}</span></li>)}
        {c.discount > 0 && <li className="flex justify-between gap-3 text-muted"><span>Desconto</span><span className="tnum">−{brl(c.discount)}</span></li>}
      </ul>
      <p className="text-xs text-muted">O admin do cliente vê o aviso “Ative sua conta” no painel e paga pelo QR em Plano e uso. A conta ativa sozinha quando o Pix cair.</p>
      <div className="flex items-center gap-2 flex-wrap">
        {c.invoiceUrl && <a href={c.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-line text-ink hover:bg-field"><ExternalLink size={13} /> Link do Asaas</a>}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" icon={<X size={13} />} loading={acao.isPending && acao.variables?.action === 'cancel'}
          onClick={() => fazer('cancel', 'Cancelar este Pix? O cliente volta a enviar normalmente (sem cobrança de ativação).', 'Cobrança cancelada')}>Cancelar Pix</Button>
        <Button variant="success" size="sm" icon={<Check size={13} />} loading={acao.isPending && acao.variables?.action === 'paid'}
          onClick={() => fazer('paid', 'Marcar como paga por fora (transferência, dinheiro)? A conta é ativada e o Pix no Asaas é cancelado.', 'Conta ativada')}>Pagou por fora</Button>
      </div>
    </div>
  );
}
