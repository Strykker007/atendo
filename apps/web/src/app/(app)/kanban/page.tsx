'use client';
import { useCallback, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Columns3, GripVertical, Search } from 'lucide-react';
import { KANBAN_NO_STAGE, type KanbanCard as Card, type KanbanColumn } from '@atendo/shared';
import Link from 'next/link';
import { KanbanCard } from '@/components/kanban/KanbanCard';
import { KanbanChatDialog } from '@/components/kanban/KanbanChatDialog';
import { useMinuto } from '@/components/chat/ConversationList';
import { Empty } from '@/components/ui/Page';
import { toast } from '@/components/ui/Toast';
import { useCan, useKanban, useNumbers, useReorderColumns, useSetPrimaryTag } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * Kanban: uma coluna por tag marcada como etapa, na ordem definida aqui (arrastando o
 * cabeçalho, quem tem `tags.manage`). O atendimento aparece só na coluna da tag principal;
 * arrastar o card troca a principal. "Sem etapa" é fixa e não é uma tag.
 *
 * Não tem limite nem cobrança próprios: o mini-chat é o mesmo da tela de conversas, então a
 * cota do plano bloqueia o envio aqui do mesmo jeito (e o aviso global aparece no topo).
 */
export default function KanbanPage() {
  const [numberId, setNumberId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const board = useKanban(numberId);
  const numbers = useNumbers();
  const move = useSetPrimaryTag();
  const reorder = useReorderColumns();
  const podeOrdenar = useCan('tags.manage');
  const agora = useMinuto();
  const fechar = useCallback(() => setAberto(null), []);

  const columns = board.data?.columns ?? [];
  const porColuna = useMemo(() => {
    const ids = new Set(columns.map((c) => c.id));
    const q = busca.trim().toLowerCase();
    const map = new Map<string, Card[]>([[KANBAN_NO_STAGE, []], ...columns.map((c) => [c.id, []] as [string, Card[]])]);
    for (const card of board.data?.cards ?? []) {
      if (q && !(card.contact.name ?? '').toLowerCase().includes(q) && !card.contact.phone.includes(q)) continue;
      map.get(card.primaryTagId && ids.has(card.primaryTagId) ? card.primaryTagId : KANBAN_NO_STAGE)!.push(card);
    }
    return map;
  }, [board.data, columns, busca]);

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
      <div className="w-72 shrink-0 flex flex-col max-h-full rounded-2xl bg-field/60 border border-line">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
          {handle}
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col?.color ?? 'var(--color-faint, #94a3b8)' }} />
          <span className="font-semibold text-sm text-ink truncate flex-1">{col?.name ?? 'Sem etapa'}</span>
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
          <p className="text-[13px] text-muted">Atendimentos abertos por etapa. Arraste para mudar a tag principal; duplo clique abre a conversa.</p>
        </div>
        <label className="flex items-center gap-1.5 rounded-lg bg-field px-2 h-8">
          <Search size={14} className="text-faint" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar contato…" className="bg-transparent text-[13px] w-40 focus:outline-none" />
        </label>
        {(numbers.data?.length ?? 0) > 1 && (
          <select value={numberId ?? ''} onChange={(e) => setNumberId(e.target.value || null)} className="rounded-lg bg-field px-2 h-8 text-[13px]">
            <option value="">Todos os números</option>
            {numbers.data!.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        )}
      </header>

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
    </div>
  );
}
