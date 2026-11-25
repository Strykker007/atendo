'use client';
/**
 * Kanban: colunas de transição (etapa do atendimento) e permanentes (📌, do contato). Mover card
 * = PATCH primary-tag; a regra de onde o card fica está em `@atendo/shared` (kanban.ts).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KANBAN_NO_STAGE, type KanbanBoard, type KanbanCard } from '@atendo/shared';
import { api } from '../api';
import { invConv } from './core';

export const useKanban = (numberId: string | null) =>
  useQuery({
    queryKey: ['kanban', numberId],
    queryFn: () => api<KanbanBoard>(`/kanban${numberId ? `?numberId=${numberId}` : ''}`),
  });

/**
 * Mesma regra do service, no cache: a etapa antiga vira pílula. Coluna permanente: a tag vai
 * para o contato (no lugar da outra permanente-coluna) e o atendimento perde a etapa — os outros
 * atendimentos do mesmo contato sem etapa vão junto. "Sem etapa": tira etapa e permanentes-coluna.
 */
function moverNoQuadro(b: KanbanBoard, id: string, tagId: string | null): KanbanBoard {
  const card = b.cards.find((c) => c.id === id);
  if (!card) return b;
  const col = tagId ? b.columns.find((c) => c.id === tagId) : undefined;
  const permanentes = new Set(b.columns.filter((c) => c.kind === 'permanent').map((c) => c.id));
  const antiga = card.primaryTagId ? b.columns.find((c) => c.id === card.primaryTagId) : undefined;
  const semEtapa = (c: KanbanCard): KanbanCard => {
    const secundarias = c.secondaryTags.filter((t) => t.id !== tagId);
    if (c.id === id && antiga) secundarias.push({ id: antiga.id, name: antiga.name, color: antiga.color, isKanban: true, kind: antiga.kind });
    return { ...c, primaryTagId: null, secondaryTags: secundarias };
  };
  if (col?.kind === 'transition') {
    return { ...b, cards: b.cards.map((c) => (c.id === id ? { ...semEtapa(c), primaryTagId: col.id, columnId: col.id } : c)) };
  }
  // permanente ou "Sem etapa": muda o contato, e com ele todo card dele que não tem etapa própria
  const contactTags = [...card.contactTags.filter((t) => !permanentes.has(t.id)), ...(col ? [{ id: col.id, name: col.name, color: col.color, isKanban: true, kind: col.kind }] : [])];
  const destino = col?.id ?? KANBAN_NO_STAGE;
  return {
    ...b,
    cards: b.cards.map((c) => {
      if (c.contact.id !== card.contact.id) return c;
      if (c.id === id) return { ...semEtapa(c), contactTags, columnId: destino };
      return c.primaryTagId ? { ...c, contactTags } : { ...c, contactTags, columnId: destino };
    }),
  };
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
        b && moverNoQuadro(b, id, tagId),
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
