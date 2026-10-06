'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
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

/** campo de configuração com o fluxo padrão de cada desfecho */
const FLUXO_DO_DESFECHO = { won: 'wonFlowId', lost: 'lostFlowId', none: 'noneFlowId' } as const;

/**
 * Encerramento com resultado. É o que transforma o relatório de conversas em relatório de
 * vendas — e o motivo da perda é o que mostra onde o negócio escapa.
 *
 * Cada desfecho pode ter um fluxo padrão (Configurações → Fluxos padrão): escolher o desfecho
 * já pré-seleciona o fluxo dele, então o caso comum é um clique. Trocar ou pôr "Nenhum" vale
 * só para este encerramento. "Comprou" grava a venda (valor obrigatório, produtos, observações).
 */
export function CloseModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const setStatus = useSetStatus();
  const flowsFeature = useHasFeature('flows');
  const flows = useFlows();
  const settings = useTenantSettings();
  const [outcome, setOutcome] = useState<ConversationOutcome>('none');
  const [valor, setValor] = useState('');
  const [produtos, setProdutos] = useState('');
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = outcome === 'won' ? lerValor(valor) : undefined;
    if (outcome === 'won' && !(value! > 0)) return toast.err(new Error('Informe o valor da compra'));
    try {
      await setStatus.mutateAsync({
        id: conversationId,
        status: 'closed',
        outcome,
        value,
        reason: outcome === 'lost' ? motivo || undefined : undefined,
        products: outcome === 'won' ? produtos.trim() || undefined : undefined,
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
            <Field label="Valor da compra (R$) *" hint="É o que soma faturamento, ticket médio e desempenho por atendente.">
              <input className={inputCls} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))} required autoFocus />
            </Field>
            <Field label="Produtos / descrição">
              <input className={inputCls} placeholder="O que foi comprado" value={produtos} onChange={(e) => setProdutos(e.target.value)} maxLength={500} />
            </Field>
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
