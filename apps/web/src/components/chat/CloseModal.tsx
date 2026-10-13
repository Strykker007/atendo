'use client';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Plus, Trash2, Check, EyeOff } from 'lucide-react';
import { Modal, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { useCan, useFlows, useHasFeature, useSetStatus, useTags, useTenantSettings, useCloseReasons, reasonsFor, useOutcomeLabels } from '@/lib/hooks';

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

/** Resultado do encerramento pelo atendente — um dos dois é obrigatório ("Sem resultado" saiu). */
export type CloseOutcome = 'won' | 'lost';
/** Exportado porque o encerramento em massa usa as mesmas. O nome vem da empresa (`useOutcomeLabels`). */
export const OUTCOMES: { id: CloseOutcome; icon: React.ReactNode; cls: string }[] = [
  { id: 'won', icon: <CheckCircle2 size={15} />, cls: 'border-ok text-ok bg-ok-soft' },
  { id: 'lost', icon: <XCircle size={15} />, cls: 'border-danger text-danger bg-danger-soft' },
];

/**
 * Tags do encerramento (o antigo "motivo"): opcionais, um botão por tag. Só as marcadas em Tags
 * para o resultado escolhido — "Comprou" e "Não comprou" têm listas próprias (o que explica uma
 * venda não é o que explica uma perda). Trocar o resultado tira as escolhidas que não valem
 * para o novo. Entram na conversa e ficam congeladas no histórico do atendimento.
 */
export function CloseTagsField({ outcome, value, onChange }: { outcome: CloseOutcome; value: string[]; onChange: (ids: string[]) => void }) {
  const tags = useTags();
  const labels = useOutcomeLabels();
  const [busca, setBusca] = useState('');
  const doResultado = (tags.data ?? []).filter((t) => (outcome === 'won' ? t.showOnWon : t.showOnLost));
  useEffect(() => {
    if (!tags.data) return;
    const validas = value.filter((id) => doResultado.some((t) => t.id === id));
    if (validas.length !== value.length) onChange(validas);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao trocar o resultado / carregar as tags
  }, [outcome, tags.data]);
  // busca só quando a lista é grande: com poucas tags, os botões já estão todos à vista
  const comBusca = doResultado.length > 12;
  const visiveis = comBusca && busca.trim() ? doResultado.filter((t) => t.name.toLowerCase().includes(busca.trim().toLowerCase())) : doResultado;
  const alternar = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const rotulo = labels[outcome];
  // sem tag marcada para o resultado, o campo some: o principal no encerramento agora é o motivo
  if (!tags.data || doResultado.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {comBusca && <input className={cn(inputCls, 'py-1 text-[12.5px]')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar tags…" aria-label="Filtrar tags" />}
      {/* um clique por tag (antes era campo com lista: abrir, buscar, escolher, fechar) */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Tags de ${rotulo}`}>
        {visiveis.map((t) => {
          const on = value.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => alternar(t.id)}
              className={cn('inline-flex items-center gap-1.5 rounded-full border pl-2 pr-2.5 py-0.5 text-[12.5px] transition', on ? 'font-semibold' : 'font-medium opacity-80 hover:opacity-100')}
              style={{
                color: t.color,
                borderColor: on ? t.color : `color-mix(in srgb, ${t.color} 45%, transparent)`,
                background: `color-mix(in srgb, ${t.color} ${on ? 22 : 8}%, transparent)`,
                boxShadow: on ? `0 0 0 1px ${t.color}` : undefined,
              }}
            >
              {/* bolinha cheia na cor da tag; escolhida, cresce e ganha o ✓ dentro */}
              <span className={cn('rounded-full shrink-0 grid place-items-center transition-all', on ? 'w-3.5 h-3.5' : 'w-2 h-2')} style={{ background: t.color }}>
                {on && <Check size={9} strokeWidth={4} className="text-white" />}
              </span>
              {t.name}
            </button>
          );
        })}
        {comBusca && visiveis.length === 0 && <span className="text-xs text-faint">Nenhuma tag com “{busca}”.</span>}
      </div>
    </div>
  );
}

/**
 * Motivo do encerramento (lista da empresa, Configurações → Atendimento → Encerramento). Um só,
 * obrigatório quando há motivo para o resultado — a API confere igual (`close_reason_required`).
 * Trocar o resultado limpa o motivo que não vale para o novo. `internal` = motivos de atendimento
 * interno (só no encerramento interno).
 */
export function CloseReasonField({ outcome, value, onChange, erro }: { outcome: CloseOutcome | 'internal'; value: string | null; onChange: (id: string | null) => void; erro?: boolean }) {
  const reasons = useCloseReasons();
  const lista = reasonsFor(reasons.data, outcome);
  useEffect(() => {
    if (reasons.data && value && !lista.some((r) => r.id === value)) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao trocar o resultado / carregar
  }, [outcome, reasons.data]);
  if (!reasons.data || lista.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium text-ink">Motivo</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Motivo do encerramento">
        {lista.map((r) => {
          const on = value === r.id;
          return (
            <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? null : r.id)}
              className={cn('inline-flex items-center gap-1.5 rounded-full border pl-2 pr-2.5 py-0.5 text-[12.5px] transition', on ? 'font-semibold' : 'font-medium opacity-80 hover:opacity-100')}
              style={{ color: r.color, borderColor: on ? r.color : `color-mix(in srgb, ${r.color} 45%, transparent)`, background: `color-mix(in srgb, ${r.color} ${on ? 22 : 8}%, transparent)`, boxShadow: on ? `0 0 0 1px ${r.color}` : undefined }}>
              <span className={cn('rounded-full shrink-0 grid place-items-center transition-all', on ? 'w-3.5 h-3.5' : 'w-2 h-2')} style={{ background: r.color }}>
                {on && <Check size={9} strokeWidth={4} className="text-white" />}
              </span>
              {r.name}
            </button>
          );
        })}
      </div>
      {erro && <p className="text-xs text-danger-ink">Escolha o motivo do encerramento.</p>}
      {/* a API confere: vale tag da conversa ou escolhida aqui */}
      {lista.find((r) => r.id === value)?.requiresTag && <p className="text-xs text-muted">Este motivo exige pelo menos uma tag no atendimento.</p>}
    </div>
  );
}

/**
 * "Atendimento interno": tira o atendimento dos relatórios (TMR, volume, encerramentos,
 * conversão). Só aparece com `conversations.close_internal` — a API recusa sem ela — e cada
 * uso fica na auditoria (docs/06-modelo-de-dados.md#encerramento-interno).
 */
export function InternalCloseToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const pode = useCan('conversations.close_internal');
  if (!pode) return null;
  return (
    <label className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] cursor-pointer', value ? 'border-warn bg-warn-soft' : 'border-line hover:bg-field')}>
      <input type="checkbox" className="mt-0.5 accent-current" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-ink"><EyeOff size={13} /> Atendimento interno</span>
        <span className="block text-muted">Não contabilizar nos relatórios de desempenho. Fica registrado na auditoria.</span>
      </span>
    </label>
  );
}

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** campo de configuração com o fluxo padrão de cada desfecho */
const FLUXO_DO_DESFECHO = { won: 'wonFlowId', lost: 'lostFlowId' } as const;

/**
 * Encerramento com resultado. É o que transforma o relatório de conversas em relatório de
 * vendas. "Comprou" ou "Não comprou" é obrigatório; as tags (o antigo motivo) são opcionais.
 *
 * Cada desfecho pode ter um fluxo padrão (Configurações → Fluxos padrão): escolher o desfecho
 * já pré-seleciona o fluxo dele, então o caso comum é um clique. Trocar ou pôr "Nenhum" vale
 * só para este encerramento. "Comprou" grava a venda quando há valor (produtos e observação
 * opcionais); sem valor, fica só o desfecho. A venda abre em lista de itens (valor + descrição,
 * total somado; item só com valor vale); quem preferir troca para texto livre e informa o total.
 */
export function CloseModal({ conversationId, onClose, onClosed }: { conversationId: string; onClose: () => void; /** encerrou de fato (a tela leva a aba junto) */ onClosed?: () => void }) {
  const setStatus = useSetStatus();
  const labels = useOutcomeLabels();
  const flowsFeature = useHasFeature('flows');
  const flows = useFlows();
  const settings = useTenantSettings();
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  const [valor, setValor] = useState<number | null>(null);
  const [produtos, setProdutos] = useState('');
  const [modoLista, setModoLista] = useState(true);
  const [itens, setItens] = useState<{ descricao: string; valor: number | null }[]>([{ descricao: '', valor: null }]);
  const [observacoes, setObservacoes] = useState('');
  /** observação fica atrás de um link: quase nunca se usa, e o campo aberto pesava o modal */
  const [comObs, setComObs] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [closeReasonId, setCloseReasonId] = useState<string | null>(null);
  const reasons = useCloseReasons();
  /** atendimento interno: sem resultado, sem venda, sem fluxo, fora dos relatórios */
  const [interno, setInterno] = useState(false);
  const [flowId, setFlowId] = useState('');
  // tentou encerrar com o desfecho incompleto: só então os campos ficam vermelhos
  const [tentou, setTentou] = useState(false);
  // trocou o fluxo à mão: a carga atrasada das configurações não sobrescreve. Clicar num
  // desfecho volta para o padrão dele (é o que se espera ao mudar de "Comprou" para "Não comprou")
  const escolheuFluxo = useRef(false);

  const ativos = (flows.data ?? []).filter((f) => f.isActive);
  /** padrão do desfecho, senão o geral "ao encerrar" — só se o fluxo ainda existe e está ativo */
  const padraoDe = (o: CloseOutcome | null) => {
    const s = settings.data;
    const id = s ? (o && s[FLUXO_DO_DESFECHO[o]]) || s.onCloseFlowId : null;
    return id && ativos.some((f) => f.id === id) ? id : '';
  };
  const carregou = !!settings.data && !!flows.data;
  useEffect(() => {
    if (carregou && !escolheuFluxo.current) setFlowId(padraoDe(outcome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregou, outcome]);

  const itensValidos = itens.map((i) => ({ description: i.descricao.trim(), value: i.valor ?? 0 })).filter((i) => i.description || i.value);
  const totalItens = Math.round(itensValidos.reduce((a, i) => a + i.value * 100, 0)) / 100;
  const mudarItem = (idx: number, patch: Partial<(typeof itens)[number]>) =>
    setItens((l) => l.map((i, n) => (n === idx ? { ...i, ...patch } : i)));

  const lista = outcome === 'won' && modoLista;
  const totalVenda = lista ? totalItens : valor ?? 0;
  // resultado é obrigatório e "Comprou" exige valor — a API recusa do mesmo jeito
  const faltaResultado = !outcome;
  // a empresa pode dispensar o valor (Configurações → Atendimento → Encerramento); a API confere igual
  const exigeValor = settings.data?.requireSaleValue ?? true;
  const faltaValor = outcome === 'won' && exigeValor && !(totalVenda > 0);
  /** Comprou sem valor (permitido): conta na conversão, mas não vira venda — produtos e observação não ficam */
  const semValor = outcome === 'won' && !exigeValor && !(totalVenda > 0);
  // motivo obrigatório quando há motivo cadastrado para o resultado
  const faltaMotivo = !!outcome && reasonsFor(reasons.data, outcome).length > 0 && !closeReasonId;
  const faltaMotivoInterno = reasonsFor(reasons.data, 'internal').length > 0 && !closeReasonId;

  function alternarInterno(v: boolean) {
    setInterno(v);
    // os motivos internos e os do resultado são listas separadas
    setCloseReasonId(null);
    setTentou(false);
  }

  async function submitInterno() {
    if (faltaMotivoInterno) { setTentou(true); return; }
    try {
      await setStatus.mutateAsync({ id: conversationId, status: 'closed', internal: true, closeReasonId: closeReasonId ?? undefined, flowId: null });
      toast.ok('Atendimento interno encerrado (fora dos relatórios)');
      onClose();
      onClosed?.();
    } catch (err) { toast.err(err); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (interno) return submitInterno();
    if (!outcome || faltaValor || faltaMotivo) { setTentou(true); return; }
    const value = outcome === 'won' ? totalVenda : undefined;
    try {
      await setStatus.mutateAsync({
        id: conversationId,
        status: 'closed',
        outcome,
        value,
        tagIds: tagIds.length ? tagIds : undefined,
        closeReasonId: closeReasonId ?? undefined,
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

  const link = 'text-[12px] text-muted underline hover:text-ink';
  return (
    <Modal open onClose={onClose} title="Encerrar atendimento" width={lista ? 'max-w-xl' : 'max-w-md'}>
      {/* compacto: resultado → venda → tags → fluxo/observação numa linha. As explicações longas
          saíram (estão em docs/08-frontend.md); ficam só os avisos de erro */}
      <form onSubmit={submit} className="space-y-3">
        <InternalCloseToggle value={interno} onChange={alternarInterno} />
        {interno && <CloseReasonField outcome="internal" value={closeReasonId} onChange={setCloseReasonId} erro={tentou && faltaMotivoInterno} />}
        {!interno && <>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Resultado">
          {OUTCOMES.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={outcome === o.id}
              onClick={() => { setOutcome(o.id); escolheuFluxo.current = false; }}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium ${outcome === o.id ? o.cls : 'border-line text-muted hover:bg-field'}`}
            >
              {o.icon} {labels[o.id]}
            </button>
          ))}
        </div>
        {tentou && faltaResultado && <p className="text-xs text-danger-ink">Escolha “{labels.won}” ou “{labels.lost}”.</p>}

        {outcome === 'won' && (lista ? (
          <div className="space-y-1.5">
            {itens.map((item, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <MoneyInput className="w-32 shrink-0" nullable value={item.valor} onChange={(v) => mudarItem(idx, { valor: v })} aria-label={`Valor do item ${idx + 1}`} autoFocus={idx === 0} />
                {/* min-w-0: sem ele o input não encolhe abaixo da largura intrínseca */}
                <input className={`${inputCls} flex-1 min-w-0`} placeholder={idx === 0 ? 'Produto ou serviço (opcional)' : 'Produto ou serviço'} aria-label={`Produto do item ${idx + 1}`} value={item.descricao} onChange={(e) => mudarItem(idx, { descricao: e.target.value })} maxLength={200} />
                {itens.length > 1 && (
                  <button type="button" aria-label="Remover item" title="Remover item" onClick={() => setItens((l) => l.filter((_, n) => n !== idx))} className="w-8 h-8 shrink-0 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-field">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-3 text-[12px]">
              <button type="button" disabled={itens.length >= 50} onClick={() => setItens((l) => [...l, { descricao: '', valor: null }])} className="inline-flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-50">
                <Plus size={13} /> Item
              </button>
              <button type="button" onClick={() => setModoLista(false)} className={link}>Texto livre</button>
              <span className="ml-auto text-muted">Total <b className="ml-1 text-ink tnum">{fmtBRL(totalItens)}</b></span>
            </div>
            {tentou && faltaValor && <p className="text-xs text-danger-ink">Informe o valor de pelo menos um item.</p>}
            {semValor && <p className="text-xs text-muted">Sem valor, conta como “{labels.won}” mas não soma no faturamento.</p>}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <MoneyInput className="w-32 shrink-0" nullable value={valor} onChange={setValor} autoFocus aria-label="Valor da compra" />
              <input className={`${inputCls} flex-1 min-w-0`} placeholder="O que foi comprado (opcional)" aria-label="Produtos" value={produtos} onChange={(e) => setProdutos(e.target.value)} maxLength={500} />
            </div>
            <button type="button" onClick={() => setModoLista(true)} className={link}>Lista de itens</button>
            {tentou && faltaValor && <p className="text-xs text-danger-ink">Informe o valor da compra.</p>}
            {semValor && <p className="text-xs text-muted">Sem valor, conta como “{labels.won}” mas não soma no faturamento.</p>}
          </div>
        ))}

        {outcome && <CloseReasonField outcome={outcome} value={closeReasonId} onChange={setCloseReasonId} erro={tentou && faltaMotivo} />}
        {outcome && <CloseTagsField outcome={outcome} value={tagIds} onChange={setTagIds} />}

        {outcome && (flowsFeature.has || outcome === 'won') && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
            {flowsFeature.has && (
              <label className="flex items-center gap-1.5 text-muted min-w-0">
                Fluxo
                <select className={cn(inputCls, 'py-1 text-[12.5px] w-auto max-w-[14rem]')} value={flowId} onChange={(e) => { setFlowId(e.target.value); escolheuFluxo.current = true; }} title="Mensagem automática enviada ao contato depois de encerrar">
                  <option value="">Nenhum</option>
                  {ativos.map((f) => <option key={f.id} value={f.id}>{f.name}{f.id === padraoDe(outcome) ? ' (padrão)' : ''}</option>)}
                </select>
              </label>
            )}
            {outcome === 'won' && !comObs && <button type="button" onClick={() => setComObs(true)} className={link}>+ Observação</button>}
          </div>
        )}
        {outcome === 'won' && comObs && (
          <textarea className={`${inputCls} resize-none`} rows={2} autoFocus placeholder="Observação da venda (o contato não vê): pagamento, entrega, desconto…" aria-label="Observação" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={1000} />
        )}
        </>}

        {/* rodapé grudado no fim do modal: com muitos itens de venda o corpo rola e o Encerrar sumia */}
        <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-3 bg-panel flex justify-end gap-2 border-t border-line">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="success" icon={<CheckCircle2 size={15} />} loading={setStatus.isPending} loadingText="Encerrando…">Encerrar</Button>
        </div>
      </form>
    </Modal>
  );
}
