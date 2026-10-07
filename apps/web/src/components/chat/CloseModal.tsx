'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle, Plus, Trash2 } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useFlows, useHasFeature, useSetStatus, useTenantSettings, type ConversationOutcome } from '@/lib/hooks';

export const MOTIVOS = ['Preço', 'Prazo', 'Não respondeu', 'Comprou com concorrente', 'Fora da área', 'Só pesquisando'];

/** As três saídas possíveis. Exportado porque o encerramento em massa usa as mesmas. */
export const OUTCOMES: { id: ConversationOutcome; label: string; icon: React.ReactNode; cls: string }[] = [
  { id: 'won', label: 'Comprou', icon: <CheckCircle2 size={15} />, cls: 'border-ok text-ok bg-ok-soft' },
  { id: 'lost', label: 'Não comprou', icon: <XCircle size={15} />, cls: 'border-danger text-danger bg-danger-soft' },
  { id: 'none', label: 'Sem resultado', icon: <MinusCircle size={15} />, cls: 'border-line text-muted bg-field' },
];

/** "1.500,90", "1500,9", "150.50" e "1.500" → número. Vírgula é sempre o decimal; sem ela, ponto seguido de 3 dígitos é milhar. */
const lerValor = (v: string) => {
  const t = v.trim();
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(/\.\d{3}$/.test(t) ? t.replace(/\./g, '') : t);
};

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** campo de configuração com o fluxo padrão de cada desfecho */
const FLUXO_DO_DESFECHO = { won: 'wonFlowId', lost: 'lostFlowId', none: 'noneFlowId' } as const;

/**
 * Encerramento com resultado. É o que transforma o relatório de conversas em relatório de
 * vendas — e o motivo da perda é o que mostra onde o negócio escapa.
 *
 * Cada desfecho pode ter um fluxo padrão (Configurações → Fluxos padrão): escolher o desfecho
 * já pré-seleciona o fluxo dele, então o caso comum é um clique. Trocar ou pôr "Nenhum" vale
 * só para este encerramento. "Comprou" grava a venda (valor obrigatório, produtos, observações).
 * A venda abre em lista de itens (descrição + valor, total somado); quem preferir troca para
 * texto livre e informa o total à mão.
 */
export function CloseModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const setStatus = useSetStatus();
  const flowsFeature = useHasFeature('flows');
  const flows = useFlows();
  const settings = useTenantSettings();
  const [outcome, setOutcome] = useState<ConversationOutcome>('none');
  const [valor, setValor] = useState('');
  const [produtos, setProdutos] = useState('');
  const [modoLista, setModoLista] = useState(true);
  const [itens, setItens] = useState([{ descricao: '', valor: '' }]);
  const [observacoes, setObservacoes] = useState('');
  const [motivo, setMotivo] = useState('');
  const [flowId, setFlowId] = useState('');
  // trocou o fluxo à mão: a carga atrasada das configurações não sobrescreve. Clicar num
  // desfecho volta para o padrão dele (é o que se espera ao mudar de "Comprou" para "Não comprou")
  const escolheuFluxo = useRef(false);

  const ativos = (flows.data ?? []).filter((f) => f.isActive);
  /** padrão do desfecho, senão o geral "ao encerrar" — só se o fluxo ainda existe e está ativo */
  const padraoDe = (o: ConversationOutcome) => {
    const s = settings.data;
    const id = s ? s[FLUXO_DO_DESFECHO[o]] ?? s.onCloseFlowId : null;
    return id && ativos.some((f) => f.id === id) ? id : '';
  };
  const carregou = !!settings.data && !!flows.data;
  useEffect(() => {
    if (carregou && !escolheuFluxo.current) setFlowId(padraoDe(outcome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregou, outcome]);
  const ehPadrao = !!flowId && flowId === padraoDe(outcome);

  const itensValidos = itens.map((i) => ({ description: i.descricao.trim(), value: lerValor(i.valor) || 0 })).filter((i) => i.description || i.value);
  const totalItens = Math.round(itensValidos.reduce((a, i) => a + i.value * 100, 0)) / 100;
  const mudarItem = (idx: number, campo: 'descricao' | 'valor', v: string) =>
    setItens((l) => l.map((i, n) => (n === idx ? { ...i, [campo]: campo === 'valor' ? v.replace(/[^\d.,]/g, '') : v } : i)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const lista = outcome === 'won' && modoLista;
    if (lista && itensValidos.some((i) => !i.description)) return toast.err(new Error('Descreva cada item da venda'));
    const value = outcome === 'won' ? (lista ? totalItens : lerValor(valor)) : undefined;
    if (outcome === 'won' && !(value! > 0)) return toast.err(new Error('Informe o valor da compra'));
    try {
      await setStatus.mutateAsync({
        id: conversationId,
        status: 'closed',
        outcome,
        value,
        reason: outcome === 'lost' ? motivo || undefined : undefined,
        products: outcome === 'won' && !lista ? produtos.trim() || undefined : undefined,
        // em lista, a API soma os itens e monta o resumo em `products`
        items: lista ? itensValidos : undefined,
        notes: outcome === 'won' ? observacoes.trim() || undefined : undefined,
        // sem o recurso o servidor decide; com ele, o que está na tela é o que vale ("Nenhum" = null).
        // Antes de carregar as configurações, deixa o servidor aplicar o padrão.
        flowId: flowsFeature.has && carregou ? flowId || null : undefined,
      });
      toast.ok('Atendimento encerrado');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Encerrar atendimento">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Resultado" hint="Alimenta o relatório de vendas. Pode deixar sem resultado.">
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { setOutcome(o.id); escolheuFluxo.current = false; }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium ${outcome === o.id ? o.cls : 'border-line text-muted hover:bg-field'}`}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>
        </Field>

        {outcome === 'won' && (
          <>
            {modoLista ? (
              <Field label="Itens da venda *" hint="O total soma faturamento, ticket médio e desempenho por atendente.">
                <div className="space-y-2">
                  {itens.map((item, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input className={`${inputCls} flex-1`} placeholder="Produto ou serviço" value={item.descricao} onChange={(e) => mudarItem(idx, 'descricao', e.target.value)} maxLength={200} autoFocus={idx === 0} />
                      <input className={`${inputCls} w-28`} inputMode="decimal" placeholder="R$ 0,00" value={item.valor} onChange={(e) => mudarItem(idx, 'valor', e.target.value)} />
                      {itens.length > 1 && (
                        <button type="button" aria-label="Remover item" onClick={() => setItens((l) => l.filter((_, n) => n !== idx))} className="shrink-0 px-2 text-muted hover:text-danger">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <button type="button" disabled={itens.length >= 50} onClick={() => setItens((l) => [...l, { descricao: '', valor: '' }])} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
                      <Plus size={14} /> Adicionar item
                    </button>
                    <span className="text-[13px] text-muted">Total: <b className="text-ink tnum">{fmtBRL(totalItens)}</b></span>
                  </div>
                </div>
              </Field>
            ) : (
              <>
                <Field label="Valor da compra (R$) *" hint="É o que soma faturamento, ticket médio e desempenho por atendente.">
                  <input className={inputCls} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))} required autoFocus />
                </Field>
                <Field label="Produtos / descrição">
                  <textarea className={`${inputCls} resize-none`} rows={3} placeholder="O que foi comprado" value={produtos} onChange={(e) => setProdutos(e.target.value)} maxLength={500} />
                </Field>
              </>
            )}
            <button type="button" onClick={() => setModoLista((m) => !m)} className="text-[12px] text-muted underline hover:text-ink">
              {modoLista ? 'Mudar para campo de texto livre' : 'Mudar para lista de itens'}
            </button>
            <Field label="Observações">
              <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Forma de pagamento, entrega, desconto…" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={1000} />
            </Field>
          </>
        )}

        {outcome === 'lost' && (
          <Field label="Motivo" hint="É o que mostra onde você está perdendo negócio.">
            <input className={inputCls} list="motivos-perda" placeholder="Preço, prazo, não respondeu…" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
            <datalist id="motivos-perda">{MOTIVOS.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
        )}

        {flowsFeature.has && (
          <Field label="Disparar fluxo ao encerrar" hint={ehPadrao ? 'Fluxo padrão deste resultado — pode trocar só para este atendimento.' : 'Pesquisa de satisfação, pós-venda, recuperação.'}>
            <select className={inputCls} value={flowId} onChange={(e) => { setFlowId(e.target.value); escolheuFluxo.current = true; }}>
              <option value="">Nenhum</option>
              {ativos.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={setStatus.isPending} loadingText="Encerrando…">Encerrar</Button>
        </div>
      </form>
    </Modal>
  );
}
