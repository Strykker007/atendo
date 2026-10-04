/**
 * Kanban: cada tag com `isKanban` é uma coluna; o atendimento aparece SÓ na coluna da sua
 * tag principal (`isPrimary`). As demais tags viram pílulas no card.
 */

/** Id fixo da coluna de quem não tem tag principal (não é uma tag). */
export const KANBAN_NO_STAGE = 'none';

export interface KanbanColumn {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface KanbanTag {
  id: string;
  name: string;
  color: string;
  /** só tags de coluna podem virar principal */
  isKanban: boolean;
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
  /** null = coluna "Sem etapa" */
  primaryTagId: string | null;
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

/** PATCH /conversations/:id/primary-tag — `null` tira da etapa (vai para "Sem etapa"). */
export interface SetPrimaryTagInput {
  tagId: string | null;
}

/** PATCH /kanban/columns — ordem completa das colunas. */
export interface ReorderColumnsInput {
  tagIds: string[];
}
