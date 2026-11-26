'use client';
import { useCallback, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { ChevronDown, Columns3, GripVertical, Pin, Search, SlidersHorizontal } from 'lucide-react';
import { KANBAN_NO_STAGE, type KanbanCard as Card, type KanbanColumn } from '@atendo/shared';
import Link from 'next/link';
import { KanbanCard } from '@/components/kanban/KanbanCard';
import { KanbanChatDialog } from '@/components/kanban/KanbanChatDialog';
import { CloseModal } from '@/components/chat/CloseModal';
import { useQueryClient } from '@tanstack/react-query';
import { useMinuto, STATUS_META } from '@/components/chat/ConversationList';
import { NumberFilter, useDefaultNumbers } from '@/components/chat/NumberFilter';
import { TagPicker } from '@/components/chat/TagPicker';
import { ORIGIN_META } from '@/components/chat/OriginBadge';
import { usePersistedState } from '@/lib/persisted';
import { useUI } from '@/lib/store';
import { Empty } from '@/components/ui/Page';
import { toast } from '@/components/ui/Toast';
import { useAgents, useCan, useDebounced, useDepartments, useKanban, useMarkRead, useMarkUnread, useMe, useNumbers, useReorderColumns, useSetPrimaryTag, useTags, useVocab, type ConversationOrigin } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * Kanban: uma coluna por tag marcada como etapa, na ordem definida aqui (arrastando o
 * cabeçalho, quem tem `tags.manage`). O atendimento aparece só na coluna da tag principal;
 * arrastar o card troca a principal. "Sem etapa" é fixa e não é uma tag.
 *
 * Não tem limite nem cobrança próprios: o mini-chat é o mesmo da tela de conversas, então a
 * cota do plano bloqueia o envio aqui do mesmo jeito (e o aviso global aparece no topo).
 */
/** Filtros só do Kanban (número e departamento são os mesmos da tela de conversas). */
type FiltrosKanban = { status: 'waiting' | 'in_progress' | null; assigneeId: string | null; tagIds: string[]; origin: ConversationOrigin | null; unread: boolean };
const SEM_FILTRO: FiltrosKanban = { status: null, assigneeId: null, tagIds: [], origin: null, unread: false };

export default function KanbanPage() {
  // número e departamento: o mesmo estado da lista de conversas (inclui o número padrão da pessoa)
  const { companyId, numberIds, departmentId, setDepartment } = useUI();
  useDefaultNumbers();
  const [filtros, setFiltros] = usePersistedState<FiltrosKanban>('kanban-filtros', SEM_FILTRO);
  const f = { ...SEM_FILTRO, ...filtros };
  const mudar = (p: Partial<FiltrosKanban>) => setFiltros((v) => ({ ...SEM_FILTRO, ...v, ...p }));
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [busca, setBusca] = useState('');
  const buscaApi = useDebounced(busca, 350);
  const [aberto, setAberto] = useState<string | null>(null);
  // encerrar direto do card: o mesmo modal do chat (resultado, motivo, tags, venda, fluxo)
  const [encerrando, setEncerrando] = useState<string | null>(null);
  const qc = useQueryClient();
  const me = useMe();
  const veEquipe = useCan('conversations.view_all');
  const agents = useAgents();
  const tags = useTags();
  const vocab = useVocab();
  const departments = useDepartments();
  const numbers = useNumbers();
  const numerosDaEmpresa = (numbers.data ?? []).filter((n) => (!companyId || n.companyId === companyId) && (!departmentId || departmentId === 'none' || !n.defaultDepartmentId || n.defaultDepartmentId === departmentId));
  const deptOptions = (departments.data ?? []).filter((d) => d.isActive || d.id === departmentId);
  const board = useKanban({
    numberIds,
    departmentId,
    tagIds: f.tagIds,
    status: f.status,
    assigneeId: veEquipe && f.assigneeId ? (f.assigneeId === 'me' ? me.data?.id ?? null : f.assigneeId) : null,
    origin: f.origin,
    unread: f.unread,
    search: buscaApi,
  });
  const filtrosAtivos = (f.status ? 1 : 0) + (veEquipe && f.assigneeId ? 1 : 0) + (f.tagIds.length ? 1 : 0) + (f.origin ? 1 : 0) + (f.unread ? 1 : 0);
  const move = useSetPrimaryTag();
  const reorder = useReorderColumns();
  const marcarLida = useMarkRead();
  const marcarNaoLida = useMarkUnread();
  const podeOrdenar = useCan('tags.manage');
  const agora = useMinuto();
  const fechar = useCallback(() => setAberto(null), []);

  const columns = board.data?.columns ?? [];
  const porColuna = useMemo(() => {
    const ids = new Set(columns.map((c) => c.id));
    const map = new Map<string, Card[]>([[KANBAN_NO_STAGE, []], ...columns.map((c) => [c.id, []] as [string, Card[]])]);
    for (const card of board.data?.cards ?? []) {
      // a API já diz a coluna (etapa do atendimento, senão a permanente do contato)
      map.get(ids.has(card.columnId) ? card.columnId : KANBAN_NO_STAGE)!.push(card);
    }
    return map;
  }, [board.data, columns]);

  function onDragEnd(r: DropResult) {
    if (!r.destination) return;
    if (r.type === 'COLUMN') {
      if (r.destination.index === r.source.index) return;
      const ids = columns.map((c) => c.id);
      const [moved] = ids.splice(r.source.index, 1);
      ids.splice(r.destination.index, 0, moved);
      reorder.mutateAsync(ids).catch(toast.err);
      return;
    }
    // ordem dentro da coluna não é guardada: lá dentro manda a última mensagem
    if (r.destination.droppableId === r.source.droppableId) return;
    const tagId = r.destination.droppableId === KANBAN_NO_STAGE ? null : r.destination.droppableId;
    move.mutateAsync({ id: r.draggableId, tagId }).catch(toast.err);
  }

  const coluna = (col: KanbanColumn | null, handle?: React.ReactNode) => {
    const id = col?.id ?? KANBAN_NO_STAGE;
    const cards = porColuna.get(id) ?? [];
    return (
      <div className={cn('w-72 shrink-0 flex flex-col max-h-full rounded-2xl bg-field/60 border', col?.kind === 'permanent' ? 'border-dashed border-line-strong' : 'border-line')}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
          {handle}
          {/* permanente: 📌 no lugar da bolinha e o aviso de que a coluna é do contato */}
          {col?.kind === 'permanent'
            ? <Pin size={12} className="shrink-0" style={{ color: col.color }} aria-hidden />
            : <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col?.color ?? 'var(--color-faint, #94a3b8)' }} />}
          <span className="font-semibold text-sm text-ink truncate flex-1" title={col?.kind === 'permanent' ? 'Tag permanente (do contato): o atendimento fica aqui enquanto não tiver etapa própria' : undefined}>{col?.name ?? 'Sem etapa'}</span>
          {col?.kind === 'permanent' && <span className="text-[10px] font-semibold uppercase tracking-wide text-faint border border-dashed border-line rounded px-1 py-px shrink-0">contato</span>}
          <span className="text-xs text-faint tnum">{cards.length}</span>
        </div>
        <Droppable droppableId={id} type="CARD">
          {(p, s) => (
            <div ref={p.innerRef} {...p.droppableProps} className={cn('flex-1 min-h-24 overflow-y-auto p-2 space-y-2 transition-colors', s.isDraggingOver && 'bg-accent/5')}>
              {cards.map((card, i) => (
                <Draggable key={card.id} draggableId={card.id} index={i}>
                  {(dp, ds) => (
                    <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps}>
                      <KanbanCard
                        card={card}
                        primary={col ?? undefined}
                        agora={agora}
                        dragging={ds.isDragging}
                        onOpen={() => setAberto(card.id)}
                        onPromote={(tagId) => move.mutateAsync({ id: card.id, tagId }).catch(toast.err)}
                        onEncerrar={() => setEncerrando(card.id)}
                        onAlternarLida={() => card.unreadCount > 0 ? marcarLida.mutate(card.id) : marcarNaoLida.mutateAsync({ id: card.id }).catch(toast.err)}
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {p.placeholder}
              {!cards.length && !s.isDraggingOver && <p className="text-xs text-faint text-center py-4">{col ? 'Arraste um atendimento para cá' : 'Todos os atendimentos têm etapa'}</p>}
            </div>
          )}
        </Droppable>
      </div>
    );
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line bg-panel">
        <div className="mr-auto">
          <h1 className="font-display text-lg font-semibold text-ink tracking-tight">Kanban</h1>
          <p className="text-[13px] text-muted">Atendimentos abertos por etapa. Arraste para mudar a tag principal; duplo clique abre a conversa; ✓ no card encerra.</p>
        </div>
        <label className="flex items-center gap-1.5 rounded-lg bg-field px-2 h-8">
          <Search size={14} className="text-faint" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar contato…" className="bg-transparent text-[13px] w-40 focus:outline-none" />
        </label>
        <div className="w-full sm:w-56 flex"><NumberFilter options={numerosDaEmpresa} /></div>
        {(deptOptions.length > 0 || departmentId) && (
          <div className="relative w-full sm:w-48">
            <select value={departmentId ?? ''} onChange={(e) => setDepartment(e.target.value || null)} title="Filtrar por departamento"
              className={cn('w-full appearance-none rounded-lg bg-field text-ink pl-2.5 pr-6 py-1.5 text-[12px] font-semibold truncate focus:outline-none focus:ring-2 focus:ring-accent/40', departmentId && 'ring-1 ring-accent')}>
              <option value="">Todos os departamentos</option>
              {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}{d.isActive ? '' : ' (desativado)'}</option>)}
              <option value="none">Sem departamento</option>
            </select>
            <ChevronDown size={14} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          </div>
        )}
        <button
          onClick={() => setFiltrosAbertos((v) => !v)}
          title={filtrosAtivos ? `${filtrosAtivos} filtro(s) ligado(s)` : 'Filtros'}
          className={cn('relative shrink-0 w-8 h-8 rounded-lg grid place-items-center', filtrosAbertos || filtrosAtivos ? 'bg-accent-soft text-accent-ink' : 'text-faint hover:text-ink hover:bg-field')}
        >
          <SlidersHorizontal size={15} />
          {filtrosAtivos > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-white text-[9px] font-bold grid place-items-center tnum">{filtrosAtivos}</span>}
        </button>
      </header>

      {/* Filtros escondidos atrás do ícone, como na lista de conversas: o ponto avisa quando há
          algum ligado (senão o card some e ninguém lembra por quê) */}
      {filtrosAbertos && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b border-line bg-panel">
          <div className="flex gap-1">
            {([[null, 'Todos'], ['in_progress', STATUS_META.in_progress.short], ['waiting', STATUS_META.waiting.short]] as const).map(([st, l]) => (
              <button key={l} onClick={() => mudar({ status: st })} className={chip(f.status === st)}>{l}</button>
            ))}
          </div>
          {veEquipe && (
            <select value={f.assigneeId ?? ''} onChange={(e) => mudar({ assigneeId: e.target.value || null })} aria-label="Filtrar por atendente"
              className={cn('rounded-lg bg-field text-ink px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-accent/40', f.assigneeId && 'ring-1 ring-accent')}>
              <option value="">Todos os {vocab.pessoas}</option>
              <option value="me">Só os meus</option>
              <option value="none">Sem {vocab.pessoa.toLowerCase()}</option>
              {agents.data?.filter((a) => a.id !== me.data?.id && a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <div className="w-full sm:w-64"><TagPicker tags={tags.data ?? []} value={f.tagIds} onChange={(ids) => mudar({ tagIds: ids })} placeholder="Filtrar por tag…" /></div>
          {(vocab.vendas || f.origin) && (
            <div className="flex flex-wrap gap-1">
              {(['ad', 'link', 'post', 'organic'] as ConversationOrigin[]).map((o) => (
                <button key={o} onClick={() => mudar({ origin: f.origin === o ? null : o })} className={chip(f.origin === o)}>{ORIGIN_META[o].label}</button>
              ))}
            </div>
          )}
          <button onClick={() => mudar({ unread: !f.unread })} className={chip(f.unread)}>Só não lidas</button>
          {filtrosAtivos > 0 && <button onClick={() => setFiltros(SEM_FILTRO)} className="text-[11px] text-accent-ink hover:underline">Limpar filtros</button>}
        </div>
      )}

      {board.data?.truncated && (
        <p className="px-4 py-1.5 text-xs bg-warn-soft text-warn-ink">Mostrando os {board.data.limit} atendimentos abertos mais recentes. Filtre por número ou encerre os parados para ver o resto.</p>
      )}

      {board.isLoading ? (
        <div className="flex-1 grid place-items-center text-sm text-muted">Carregando quadro…</div>
      ) : !columns.length ? (
        <div className="flex-1 grid place-items-center p-4">
          <div className="space-y-3 text-center">
            <Empty icon={<Columns3 size={36} />} title="Nenhuma etapa" text={podeOrdenar ? 'Marque tags como "Etapa no Kanban" para criar as colunas.' : 'Peça a um gerente para marcar tags como etapas do Kanban.'} />
            {podeOrdenar && <Link href="/tags" className="text-sm text-accent underline">Ir para Tags</Link>}
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex-1 min-h-0 overflow-x-auto">
            <div className="flex gap-3 p-4 h-full items-stretch">
              {coluna(null)}
              {podeOrdenar ? (
                <Droppable droppableId="board" type="COLUMN" direction="horizontal">
                  {(p) => (
                    <div ref={p.innerRef} {...p.droppableProps} className="flex gap-3 h-full">
                      {columns.map((col, i) => (
                        <Draggable key={col.id} draggableId={`col:${col.id}`} index={i}>
                          {(dp) => (
                            <div ref={dp.innerRef} {...dp.draggableProps} className="h-full flex">
                              {coluna(col, <span {...dp.dragHandleProps} className="text-faint hover:text-ink cursor-grab -ml-1" title="Arraste para reordenar"><GripVertical size={14} /></span>)}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {p.placeholder}
                    </div>
                  )}
                </Droppable>
              ) : (
                // sem `tags.manage` a ordem é só leitura: nem monta o arraste de colunas
                columns.map((col) => <div key={col.id} className="h-full flex">{coluna(col)}</div>)
              )}
            </div>
          </div>
        </DragDropContext>
      )}

      {aberto && <KanbanChatDialog conversationId={aberto} onClose={fechar} />}
      {/* encerrado: o card sai do quadro (o socket também avisa; aqui é na hora) */}
      {encerrando && <CloseModal conversationId={encerrando} onClose={() => setEncerrando(null)} onClosed={() => qc.invalidateQueries({ queryKey: ['kanban'] })} />}
    </div>
  );
}

const chip = (on: boolean) => cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-md border transition-colors', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field');
