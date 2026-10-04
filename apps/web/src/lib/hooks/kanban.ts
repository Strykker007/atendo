'use client';
/** Kanban: quadro por tag principal. Mover card = trocar a tag principal do atendimento. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { KanbanBoard, KanbanCard } from '@atendo/shared';
import { api } from '../api';
import { invConv } from './core';

export const useKanban = (numberId: string | null) =>
  useQuery({
    queryKey: ['kanban', numberId],
    queryFn: () => api<KanbanBoard>(`/kanban${numberId ? `?numberId=${numberId}` : ''}`),
  });

/** A principal antiga vira pílula; a nova sai das pílulas. Mesma regra do service. */
function moverNoCache(card: KanbanCard, tagId: string | null, colunas: KanbanBoard['columns']): KanbanCard {
  const antiga = card.primaryTagId ? colunas.find((c) => c.id === card.primaryTagId) : undefined;
  const secundarias = card.secondaryTags.filter((t) => t.id !== tagId);
  if (antiga) secundarias.push({ id: antiga.id, name: antiga.name, color: antiga.color, isKanban: true });
  return { ...card, primaryTagId: tagId, secondaryTags: secundarias };
}

/**
 * Troca a tag principal (arrastar card, clicar na pílula, escolher no chat).
 * Otimista no quadro: card que volta para a coluna antiga depois de soltar parece bug.
 */
export const useSetPrimaryTag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tagId }: { id: string; tagId: string | null }) => api(`/conversations/${id}/primary-tag`, { method: 'PATCH', body: JSON.stringify({ tagId }) }),
    onMutate: async ({ id, tagId }) => {
      await qc.cancelQueries({ queryKey: ['kanban'] });
      const antes = qc.getQueriesData<KanbanBoard>({ queryKey: ['kanban'] });
      qc.setQueriesData<KanbanBoard>({ queryKey: ['kanban'] }, (b) =>
        b && { ...b, cards: b.cards.map((c) => (c.id === id ? moverNoCache(c, tagId, b.columns) : c)) },
      );
      return { antes };
    },
    onError: (_e, _v, ctx) => ctx?.antes.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: (_d, _e, v) => { invConv(qc, v.id); qc.invalidateQueries({ queryKey: ['kanban'] }); },
  });
};

/** Nova ordem das colunas (só quem tem `tags.manage`). */
export const useReorderColumns = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagIds: string[]) => api('/kanban/columns', { method: 'PATCH', body: JSON.stringify({ tagIds }) }),
    onMutate: async (tagIds) => {
      await qc.cancelQueries({ queryKey: ['kanban'] });
      const antes = qc.getQueriesData<KanbanBoard>({ queryKey: ['kanban'] });
      qc.setQueriesData<KanbanBoard>({ queryKey: ['kanban'] }, (b) =>
        b && { ...b, columns: tagIds.map((id, position) => ({ ...b.columns.find((c) => c.id === id)!, position })).filter((c) => c.id) },
      );
      return { antes };
    },
    onError: (_e, _v, ctx) => ctx?.antes.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['kanban'] }); qc.invalidateQueries({ queryKey: ['tags'] }); },
  });
};
