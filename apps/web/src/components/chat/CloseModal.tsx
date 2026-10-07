'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle, Plus, Trash2 } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { useFlows, useHasFeature, useSetStatus, useTenantSettings, type ConversationOutcome } from '@/lib/hooks';

/** padrão enquanto as configurações carregam — a lista do cliente vem de Configurações → Motivos de perda */
export const MOTIVOS = ['Preço', 'Prazo', 'Não respondeu', 'Comprou com concorrente', 'Fora da área', 'Só pesquisando'];

/**
 * Motivo de perda: um clique nos cadastrados ou texto livre. Texto livre continua valendo
 * (caso raro não deveria exigir passar em Configurações), mas o relatório agrupa pelo texto —
 * por isso os cadastrados ficam à vista, para a equipe escrever sempre igual.
 */
export function LossReasonField({ value, onChange, hint, placeholder }: { value: string; onChange: (v: string) => void; hint: string; placeholder: string }) {
  const settings = useTenantSettings();
  const motivos = settings.data?.lossReasons ?? MOTIVOS;
  return (
    // div, não o <label> do Field: clicar no texto do label acionaria o primeiro chip
    <div className="text-sm space-y-1">
      <span className="block text-ink font-medium">Motivo</span>
      {motivos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {motivos.map((m) => (
            <button key={m} type="button" onClick={() => onChange(value === m ? '' : m)} className={`rounded-full border px-2.5 py-1 text-[12px] ${value === m ? 'border-danger text-danger bg-danger-soft' : 'border-line text-muted hover:bg-field'}`}>
              {m}
            </button>
          ))}
        </div>
      )}
      <input className={inputCls} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} aria-label="Motivo" />
      <span className="block text-xs text-faint">{hint}</span>
    </div>
  );
}

/** As três saídas possíveis. Exportado porque o encerramento em massa usa as mesmas. */
export const OUTCOMES: { id: ConversationOutcome; label: string; icon: React.ReactNode; cls: string }[] = [
  { id: 'won', label: 'Comprou', icon: <CheckCircle2 size={15} />, cls: 'border-ok text-ok bg-ok-soft' },
  { id: 'lost', label: 'Não comprou', icon: <XCircle size={15} />, cls: 'border-danger text-danger bg-danger-soft' },
  { id: 'none', label: 'Sem resultado', icon: <MinusCircle size={15} />, cls: 'border-line text-muted bg-field' },
];

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** campo de configuração com o fluxo padrão de cada desfecho */
const FLUXO_DO_DESFECHO = { won: 'wonFlowId', lost: 'lostFlowId', none: 'noneFlowId' } as const;

/**
 * Encerramento com resultado. É o que transforma o relatório de conversas em relatório de
 * vendas — e o motivo da perda é o que mostra onde o negócio escapa.
 *
 * Cada desfecho pode ter um fluxo padrão (Configurações → Fluxos padrão): escolher o desfecho
 * já pré-seleciona o fluxo dele, então o caso comum é um clique. Trocar ou pôr "Nenhum" vale
 * só para este encerramento. "Comprou" grava a venda quando há valor (produtos e observação
 * opcionais); sem valor, fica só o desfecho. A venda abre em lista de itens (valor + descrição,
 * total somado; item só com valor vale); quem preferir troca para texto livre e informa o total.
 */
export function CloseModal({ conversationId, onClose, onClosed }: { conversationId: string; onClose: () => void; /** encerrou de fato (a tela leva a aba junto) */ onClosed?: () => void }) {
  const setStatus = useSetStatus();
  const flowsFeature = useHasFeature('flows');
  const flows = useFlows();
  const settings = useTenantSettings();
  const [outcome, setOutcome] = useState<ConversationOutcome>('none');
  const [valor, setValor] = useState<number | null>(null);
  const [produtos, setProdutos] = useState('');
  const [modoLista, setModoLista] = useState(true);
  const [itens, setItens] = useState<{ descricao: string; valor: number | null }[]>([{ descricao: '', valor: null }]);
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

  const itensValidos = itens.map((i) => ({ description: i.descricao.trim(), value: i.valor ?? 0 })).filter((i) => i.description || i.value);
  const totalItens = Math.round(itensValidos.reduce((a, i) => a + i.value * 100, 0)) / 100;
  const mudarItem = (idx: number, patch: Partial<(typeof itens)[number]>) =>
    setItens((l) => l.map((i, n) => (n === idx ? { ...i, ...patch } : i)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const lista = outcome === 'won' && modoLista;
    // nada é obrigatório: sem valor, "Comprou" registra só o desfecho (não entra como venda)
    const value = outcome === 'won' ? (lista ? totalItens : valor ?? 0) || undefined : undefined;
    try {
      await setStatus.mutateAsync({
        id: conversationId,
        status: 'closed',
        outcome,
        value,
        reason: outcome === 'lost' ? motivo || undefined : undefined,
        products: outcome === 'won' && !lista ? produtos.trim() || undefined : undefined,
        // em lista, a API soma os itens e monta o resumo em `products`
        items: lista && itensValidos.length ? itensValidos : undefined,
        notes: outcome === 'won' ? observacoes.trim() || undefined : undefined,
        // sem o recurso o servidor decide; com ele, o que está na tela é o que vale ("Nenhum" = null).
        // Antes de carregar as configurações, deixa o servidor aplicar o padrão.
        flowId: flowsFeature.has && carregou ? flowId || null : undefined,
      });
      toast.ok('Atendimento encerrado');
      onClose();
      onClosed?.();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Encerrar atendimento" width={outcome === 'won' && modoLista ? 'max-w-2xl' : undefined}>
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
              <Field label="Itens da venda" hint="Opcional. O total soma faturamento, ticket médio e desempenho por atendente.">
                <div className="space-y-2">
                  {itens.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <MoneyInput className="w-36 shrink-0" nullable value={item.valor} onChange={(v) => mudarItem(idx, { valor: v })} aria-label="Valor do item" autoFocus={idx === 0} />
                      {/* min-w-0: sem ele o input não encolhe abaixo da largura intrínseca e a descrição fica espremida */}
                      <input className={`${inputCls} flex-1 min-w-0`} placeholder="Produto ou serviço (opcional)" value={item.descricao} onChange={(e) => mudarItem(idx, { descricao: e.target.value })} maxLength={200} />
                      <button type="button" aria-label="Remover item" onClick={() => setItens((l) => l.filter((_, n) => n !== idx))} className="shrink-0 p-2 rounded-lg text-muted hover:text-danger hover:bg-field">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <button type="button" disabled={itens.length >= 50} onClick={() => setItens((l) => [...l, { descricao: '', valor: null }])} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
                      <Plus size={14} /> Adicionar item
                    </button>
                    <span className="text-[13px] text-muted">Total: <b className="text-ink tnum">{fmtBRL(totalItens)}</b></span>
                  </div>
                </div>
              </Field>
            ) : (
              <>
                <Field label="Valor da compra (R$)" hint="Opcional. É o que soma faturamento, ticket médio e desempenho por atendente.">
                  <MoneyInput nullable value={valor} onChange={setValor} autoFocus />
                </Field>
                <Field label="Produtos / descrição">
                  <textarea className={`${inputCls} resize-none`} rows={3} placeholder="O que foi comprado" value={produtos} onChange={(e) => setProdutos(e.target.value)} maxLength={500} />
                </Field>
              </>
            )}
            <button type="button" onClick={() => setModoLista((m) => !m)} className="text-[12px] text-muted underline hover:text-ink">
              {modoLista ? 'Mudar para campo de texto livre' : 'Mudar para lista de itens'}
            </button>
          </>
        )}

        {outcome === 'lost' && (
          <LossReasonField value={motivo} onChange={setMotivo} hint="É o que mostra onde você está perdendo negócio." placeholder="Ou escreva outro motivo" />
        )}

        {flowsFeature.has && (
          <Field label="Disparar fluxo ao encerrar" hint={ehPadrao ? 'Fluxo padrão deste resultado — pode trocar só para este atendimento.' : 'Pesquisa de satisfação, pós-venda, recuperação.'}>
            <select className={inputCls} value={flowId} onChange={(e) => { setFlowId(e.target.value); escolheuFluxo.current = true; }}>
              <option value="">Nenhum</option>
              {ativos.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        )}

        {/* por último, abaixo do fluxo: é o fecho do formulário, não parte da venda */}
        {outcome === 'won' && (
          <Field label="Observação (opcional)">
            <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Forma de pagamento, entrega, desconto…" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={1000} />
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
