/**
 * Fila de atendimento com distribuição automática e pausa do atendente
 * (docs/fila-de-atendimento.md). Tipos e regras puras, usados pela API e pelo painel.
 */

export const AGENT_PAUSE_REASONS = {
  lunch: 'Almoço',
  break: 'Intervalo',
  meeting: 'Reunião',
  other: 'Outra atividade',
} as const;
export type AgentPauseReason = keyof typeof AGENT_PAUSE_REASONS;

/** Durações oferecidas no botão de pausa (minutos); `null` = até eu voltar. */
export const AGENT_PAUSE_MINUTES = [15, 30, 60, null] as const;
/** limite de uma pausa com prazo (8 h) */
export const AGENT_PAUSE_MAX_MINUTES = 480;

export const QUEUE_MAX_PER_AGENT_DEFAULT = 4;
export const QUEUE_MAX_PER_AGENT_LIMIT = 50;

export interface AgentPause {
  reason: AgentPauseReason;
  startedAt: string;
  /** null = até a pessoa voltar */
  until: string | null;
}

/** Situação de cada pessoa na fila, do ponto de vista da distribuição. */
export type QueueAgentState = 'available' | 'full' | 'paused' | 'offline';

export interface QueueAgent {
  id: string;
  name: string;
  state: QueueAgentState;
  /** atendimentos abertos com a pessoa (o que conta para o limite) */
  open: number;
  pause: AgentPause | null;
}

export interface QueueStatus {
  /** distribuição automática ligada na empresa */
  enabled: boolean;
  /** limite de atendimentos abertos por pessoa */
  maxPerAgent: number;
  /** atendente não puxa da fila: só a distribuição (e quem pode transferir) entrega */
  lockClaim: boolean;
  /** contatos na fila esperando alguém (Aguardando, sem dono, fora do robô) */
  waiting: number;
  me: { open: number; pause: AgentPause | null; online: boolean };
  /** só para quem vê todos os atendimentos (gerente/admin) */
  team?: QueueAgent[];
}
