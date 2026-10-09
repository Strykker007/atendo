'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle, Plus, Trash2 } from 'lucide-react';
import { Modal, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { useFlows, useHasFeature, useSetStatus, useTenantSettings, type ConversationOutcome } from '@/lib/hooks';
import { DEFAULT_LOSS_REASONS } from '@atendo/shared';

/** padrão enquanto as configurações carregam — a lista do cliente vem de Configurações → Motivos de perda */
export const MOTIVOS = DEFAULT_LOSS_REASONS;

/**
 * Bloco do formulário de encerramento: rótulo, explicação logo abaixo dele e o campo. A dica
 * vinha depois do campo e parecia pertencer ao bloco seguinte; aqui tudo fica alinhado à
 * esquerda e na mesma ordem em todas as seções. `acao` fica à direita do rótulo (ex.: trocar
 * lista por texto livre), em vez de um link solto entre as seções.
 */
export function Secao({ titulo, opcional, dica, acao, children, htmlFor }: { titulo: string; opcional?: boolean; dica?: string; acao?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
            {titulo}{opcional && <span className="ml-1.5 text-[11px] font-normal text-faint">opcional</span>}
          </label>
          {dica && <p className="text-xs text-muted mt-0.5">{dica}</p>}
        </div>
        {acao && <div className="shrink-0">{acao}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Motivo de perda: um clique nos cadastrados ou texto livre. Texto livre continua valendo
 * (caso raro não deveria exigir passar em Configurações), mas o relatório agrupa pelo texto —
 * por isso os cadastrados ficam à vista, para a equipe escrever sempre igual.
 */
export function LossReasonField({ value, onChange, hint, placeholder, invalid }: { value: string; onChange: (v: string) => void; hint: string; placeholder: string; /** tentou encerrar sem motivo */ invalid?: boolean }) {
  const settings = useTenantSettings();
  const motivos = settings.data?.lossReasons ?? MOTIVOS;
  const cores = settings.data?.lossReasonColors ?? {};
  const cadastrado = motivos.includes(value);
  return (
    <Secao titulo="Motivo" dica={`${hint} Obrigatório: escolha um da lista ou escreva outro.`} htmlFor="motivo-livre">
      {motivos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {motivos.map((m) => {
            // cor do motivo (Configurações → Motivos de perda): bolinha quando solto, botão tingido quando escolhido
            const cor = cores[m];
            const ativo = value === m;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={ativo}
                onClick={() => onChange(ativo ? '' : m)}
                style={ativo && cor ? { borderColor: cor, color: cor, backgroundColor: `${cor}1f` } : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${ativo ? (cor ? 'font-medium' : 'border-danger text-danger bg-danger-soft font-medium') : 'border-line text-muted hover:bg-field hover:text-ink'}`}
              >
                {cor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cor }} />}
                {m}
              </button>
            );
          })}
        </div>
      )}
      {/* escolheu um chip: o campo livre fica vazio, para não parecer que são duas respostas */}
      <input id="motivo-livre" className={`${inputCls} ${invalid ? 'border-danger' : ''}`} placeholder={placeholder} value={cadastrado ? '' : value} onChange={(e) => onChange(e.target.value)} maxLength={200} />
      {invalid && <p className="text-xs text-danger-ink">Escolha ou escreva o motivo para encerrar como “Não comprou”.</p>}
    </Secao>
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
  // tentou encerrar com o desfecho incompleto: só então os campos ficam vermelhos
  const [tentou, setTentou] = useState(false);
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

  const lista = outcome === 'won' && modoLista;
  const totalVenda = lista ? totalItens : valor ?? 0;
  // "Comprou" exige valor e "Não comprou" exige motivo — a API recusa do mesmo jeito
  const faltaValor = outcome === 'won' && !(totalVenda > 0);
  const faltaMotivo = outcome === 'lost' && !motivo.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (faltaValor || faltaMotivo) { setTentou(true); return; }
    const value = outcome === 'won' ? totalVenda : undefined;
    try {
      await setStatus.mutateAsync({
        id: conversationId,
        status: 'closed',
        outcome,
        value,
        reason: outcome === 'lost' ? motivo.trim() : undefined,
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
        <Secao titulo="Resultado" dica="Alimenta o relatório de vendas. Se a conversa não teve venda em jogo, deixe “Sem resultado”.">
          <div className="grid grid-cols-3 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={outcome === o.id}
                onClick={() => { setOutcome(o.id); escolheuFluxo.current = false; }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium ${outcome === o.id ? o.cls : 'border-line text-muted hover:bg-field'}`}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>
        </Secao>

        {outcome === 'won' && (
          <div className="border-t border-line pt-4">
            {modoLista ? (
              <Secao
                titulo="Itens da venda"
                dica="Obrigatório informar o valor: o total soma faturamento, ticket médio e desempenho por atendente. Item só com valor também vale."
                acao={<button type="button" onClick={() => setModoLista(false)} className="text-[12px] text-muted underline hover:text-ink">Usar texto livre</button>}
              >
                <div className="space-y-2">
                  {/* cabeçalho das colunas: sem ele não dava para saber qual campo era o quê */}
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-faint">
                    <span className="w-36 shrink-0">Valor (R$)</span>
                    <span className="flex-1">Produto ou serviço</span>
                    <span className="w-9 shrink-0" />
                  </div>
                  {itens.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <MoneyInput className="w-36 shrink-0" nullable value={item.valor} onChange={(v) => mudarItem(idx, { valor: v })} aria-label={`Valor do item ${idx + 1}`} autoFocus={idx === 0} />
                      {/* min-w-0: sem ele o input não encolhe abaixo da largura intrínseca e a descrição fica espremida */}
                      <input className={`${inputCls} flex-1 min-w-0`} placeholder="Ex.: Fralda G, pacote com 40" aria-label={`Produto do item ${idx + 1}`} value={item.descricao} onChange={(e) => mudarItem(idx, { descricao: e.target.value })} maxLength={200} />
                      <button type="button" aria-label="Remover item" title="Remover item" onClick={() => setItens((l) => l.filter((_, n) => n !== idx))} className="w-9 h-9 shrink-0 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-field">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-line pt-2">
                    <button type="button" disabled={itens.length >= 50} onClick={() => setItens((l) => [...l, { descricao: '', valor: null }])} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
                      <Plus size={14} /> Adicionar item
                    </button>
                    <span className="text-[13px] text-muted">Total <b className="ml-1 text-ink tnum">{fmtBRL(totalItens)}</b></span>
                  </div>
                  {tentou && faltaValor && <p className="text-xs text-danger-ink">Informe o valor de pelo menos um item para encerrar como “Comprou”.</p>}
                </div>
              </Secao>
            ) : (
              <div className="space-y-4">
                <Secao
                  titulo="Valor da compra (R$)"
                  dica="Obrigatório. Soma faturamento, ticket médio e desempenho por atendente."
                  acao={<button type="button" onClick={() => setModoLista(true)} className="text-[12px] text-muted underline hover:text-ink">Usar lista de itens</button>}
                >
                  <MoneyInput className="sm:w-56" nullable value={valor} onChange={setValor} autoFocus aria-label="Valor da compra" />
                  {tentou && faltaValor && <p className="text-xs text-danger-ink">Informe o valor da compra para encerrar como “Comprou”.</p>}
                </Secao>
                <Secao titulo="Produtos / descrição" opcional dica="O que foi comprado, do jeito que preferir." htmlFor="produtos-livre">
                  <textarea id="produtos-livre" className={`${inputCls} resize-none`} rows={3} placeholder="Ex.: 2 pacotes de fralda G e 1 perfume" value={produtos} onChange={(e) => setProdutos(e.target.value)} maxLength={500} />
                </Secao>
              </div>
            )}
          </div>
        )}

        {outcome === 'lost' && (
          <div className="border-t border-line pt-4">
            <LossReasonField value={motivo} onChange={setMotivo} hint="É o que mostra onde você está perdendo negócio." placeholder="Outro motivo…" invalid={tentou && faltaMotivo} />
          </div>
        )}

        {flowsFeature.has && (
          <div className="border-t border-line pt-4">
            <Secao
              titulo="Fluxo ao encerrar"
              dica={ehPadrao ? 'Já vem o fluxo padrão deste resultado. Pode trocar ou escolher “Nenhum” só para este atendimento.' : 'Mensagem automática enviada ao contato depois de encerrar: pesquisa de satisfação, pós-venda, recuperação.'}
              htmlFor="fluxo-encerrar"
            >
              <select id="fluxo-encerrar" className={inputCls} value={flowId} onChange={(e) => { setFlowId(e.target.value); escolheuFluxo.current = true; }}>
                <option value="">Nenhum</option>
                {ativos.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Secao>
          </div>
        )}

        {/* por último, abaixo do fluxo: é o fecho do formulário, não parte da venda */}
        {outcome === 'won' && (
          <div className="border-t border-line pt-4">
            <Secao titulo="Observação" opcional dica="Fica registrada na venda; o contato não vê." htmlFor="obs-venda">
              <textarea id="obs-venda" className={`${inputCls} resize-none`} rows={2} placeholder="Forma de pagamento, entrega, desconto…" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={1000} />
            </Secao>
          </div>
        )}

        {/* rodapé grudado no fim do modal: com muitos itens de venda o corpo rola e o Encerrar sumia */}
        <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-4 bg-panel flex justify-end gap-2 border-t border-line">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="success" icon={<CheckCircle2 size={15} />} loading={setStatus.isPending} loadingText="Encerrando…">Encerrar</Button>
        </div>
      </form>
    </Modal>
  );
}
