/**
 * Feedback de atendimento (docs/feedback-de-atendimento.md): o gestor aponta algo num atendimento
 * encerrado e o atendente precisa ver e dar ciência. Privado entre os dois — o contato nunca vê,
 * os colegas também não.
 */

export const REVIEW_KINDS = ['correction', 'opportunity', 'guidance', 'praise'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = {
  correction: 'Correção',
  opportunity: 'Oportunidade',
  guidance: 'Orientação',
  praise: 'Elogio',
};
export const REVIEW_KIND_HINT: Record<ReviewKind, string> = {
  correction: 'Conduta que precisa mudar',
  opportunity: 'Venda ou oferta que ficou de fora',
  guidance: 'Dica de como fazer melhor',
  praise: 'O que foi bem feito',
};

/** Regra de cada tipo, configurável por empresa (Configurações → Feedback). */
export interface ReviewKindRule {
  /** precisa do "Li e estou ciente" (sem isso, abrir já basta) */
  requiresAck: boolean;
  /**
   * Prazo para a ciência em horas ONLINE do atendente (painel aberto e dentro do turno), não horas
   * corridas: folga, fim de semana e ausência não consomem o prazo. null = sem prazo.
   */
  deadlineHours: number | null;
  /** sem ciência, o atendente não assume novo atendimento até dar ciência */
  blocksClaim: boolean;
}
export interface ReviewSettings {
  kinds: Record<ReviewKind, ReviewKindRule>;
  /** prazo vencido: avisa quem fez o apontamento */
  notifyReviewerOnOverdue: boolean;
}

export const REVIEW_SETTINGS_DEFAULT: ReviewSettings = {
  kinds: {
    correction: { requiresAck: true, deadlineHours: 4, blocksClaim: true },
    opportunity: { requiresAck: true, deadlineHours: 8, blocksClaim: false },
    guidance: { requiresAck: true, deadlineHours: 8, blocksClaim: false },
    praise: { requiresAck: false, deadlineHours: null, blocksClaim: false },
  },
  notifyReviewerOnOverdue: true,
};

/** Junta o salvo com o padrão: tipo novo ou campo faltando no JSON caem no padrão. */
export function resolveReviewSettings(raw: unknown): ReviewSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReviewSettings>;
  const kinds = {} as Record<ReviewKind, ReviewKindRule>;
  for (const k of REVIEW_KINDS) kinds[k] = { ...REVIEW_SETTINGS_DEFAULT.kinds[k], ...(r.kinds?.[k] ?? {}) };
  return { kinds, notifyReviewerOnOverdue: r.notifyReviewerOnOverdue ?? REVIEW_SETTINGS_DEFAULT.notifyReviewerOnOverdue };
}

export type ReviewStatus = 'sent' | 'seen' | 'acknowledged' | 'overdue';

export interface AttendanceReview {
  id: string;
  conversationId: string;
  closeEventId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  agent: { id: string | null; name: string };
  reviewer: { id: string | null; name: string };
  kind: ReviewKind;
  text: string;
  messageIds: string[];
  requiresAck: boolean;
  blocksClaim: boolean;
  deadlineMinutes: number | null;
  /** tempo online do atendente desde o apontamento (o que conta para o prazo) */
  onlineMinutes: number;
  seenAt: string | null;
  acknowledgedAt: string | null;
  agentReply: string | null;
  repliedAt: string | null;
  overdueAt: string | null;
  createdAt: string;
  status: ReviewStatus;
  contact: { name: string | null; phone: string };
  /** só para quem fez/gestão: o atendente nunca entrou desde o apontamento */
  agentLastSeenAt?: string | null;
}

export interface CreateReviewInput {
  conversationId: string;
  closeEventId?: string | null;
  kind: ReviewKind;
  text: string;
  messageIds?: string[];
}

/** Evento de socket `review_alert`: apontamento novo para o atendente, ou prazo vencido para o gestor. */
export interface ReviewAlertEvent {
  type: 'new' | 'overdue' | 'acknowledged' | 'replied';
  reviewId: string;
  kind: ReviewKind;
  byName: string;
  contactName: string;
  text: string;
}
