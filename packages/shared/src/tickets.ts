/**
 * Tickets internos da empresa (docs/tickets.md): um setor pede algo a outro (portaria → adm,
 * concierge → manutenção…). Várias pessoas atuam no mesmo ticket (um responsável + participantes),
 * dá para transferir e congelar "Em espera" por motivo externo (prestador, peça, aprovação).
 */

export const TICKET_STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'canceled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  on_hold: 'Em espera',
  resolved: 'Resolvido',
  canceled: 'Cancelado',
};
/** ainda precisa de alguém: entra nas contagens e na fila */
export const TICKET_ACTIVE_STATUSES: TicketStatus[] = ['open', 'in_progress', 'on_hold'];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };

/** responsável = quem responde pelo ticket (um só); participante = atua junto */
export const TICKET_ROLES = ['responsible', 'participant'] as const;
export type TicketRole = (typeof TICKET_ROLES)[number];

/** Linha do tempo: comentário e cada ação, com quem fez e quando. */
export const TICKET_EVENT_TYPES = ['created', 'comment', 'status', 'hold', 'resume', 'transfer', 'participant_added', 'participant_removed', 'edited'] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

/** Motivos de espera que toda empresa ganha (editáveis em Tickets → Motivos de espera). */
export const DEFAULT_TICKET_HOLD_REASONS = [
  'Aguardando prestador de serviço',
  'Aguardando peça ou material',
  'Aguardando morador / cliente',
  'Aguardando aprovação',
  'Aguardando orçamento',
  'Aguardando outro setor',
];

export const TICKET_TITLE_MAX = 140;
export const TICKET_TEXT_MAX = 4000;
export const TICKET_MAX_PARTICIPANTS = 20;
