import type { TagKind } from './enums.js';

/**
 * Kanban: cada tag com `isKanban` é uma coluna — de transição (etapa do atendimento) ou
 * permanente (classificação do contato, 📌). O card fica numa coluna só (`columnId`), com
 * prioridade para o atendimento: a tag principal (`isPrimary`, transição); sem ela, a primeira
 * tag permanente-coluna do contato (na ordem do quadro); sem nenhuma, "Sem etapa".
 * As demais tags viram pílulas no card.
 */

/** Id fixo da coluna de quem não tem tag principal (não é uma tag). */
export const KANBAN_NO_STAGE = 'none';

export interface KanbanColumn {
  id: string;
  name: string;
  color: string;
  position: number;
  /** permanente = a coluna é do contato (📌): o card fica nela enquanto o atendimento não tiver etapa */
  kind: TagKind;
}

export interface KanbanTag {
  id: string;
  name: string;
  color: string;
  /** só tags de coluna podem virar principal */
  isKanban: boolean;
  kind: TagKind;
}

export interface KanbanCard {
  /** id da conversa */
  id: string;
  status: 'waiting' | 'in_progress';
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  awaitingSince: string | null;
  contact: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  assignee: { id: string; name: string } | null;
  number: { id: string; label: string; phone: string; color: string };
  /** etapa do atendimento (tag de transição); null = sem etapa do atendimento */
  primaryTagId: string | null;
  /** coluna onde o card aparece (ver regra no topo); `KANBAN_NO_STAGE` = "Sem etapa" */
  columnId: string;
  /** tags do atendimento que não são a principal */
  secondaryTags: KanbanTag[];
  /** tags da pessoa (📌), só exibição — não viram principal */
  contactTags: KanbanTag[];
}

export interface KanbanBoard {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  /** o quadro mostra até este tanto de atendimentos abertos (mais recentes primeiro) */
  limit: number;
  truncated: boolean;
}

/**
 * PATCH /conversations/:id/primary-tag — mover o card. Tag de transição: vira a etapa do
 * atendimento. Tag permanente: vai para o contato (tirando a outra permanente-coluna dele) e o
 * atendimento perde a etapa. `null` = "Sem etapa": tira a etapa e as permanentes-coluna do contato.
 */
export interface SetPrimaryTagInput {
  tagId: string | null;
}

/** PATCH /kanban/columns — ordem completa das colunas. */
export interface ReorderColumnsInput {
  tagIds: string[];
}
