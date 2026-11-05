/**
 * Agente de IA com etapas (docs/agente-ia.md): um roteiro de atendimento em blocos. Cada etapa
 * tem o seu prompt (o que a IA busca nela), para onde avança e quando, e quais ferramentas do
 * sistema a IA pode usar ali. A IA PEDE as ações; quem confere e executa é o código.
 */
import type { ContactField } from './flows.js';

/** Ferramentas do sistema que a IA pode pedir. Cada uma só vale com os alvos liberados no agente. */
export const AGENT_TOOLS = {
  transfer_department: { label: 'Transferir para departamento', desc: 'Passa a conversa para um departamento e entrega para a equipe.' },
  handoff: { label: 'Chamar um atendente', desc: 'Entrega a conversa para a fila humana quando a IA não deve seguir.' },
  add_tag: { label: 'Etiquetar', desc: 'Marca a conversa com uma das etiquetas liberadas.' },
  set_contact_field: { label: 'Salvar dado do contato', desc: 'Grava nome, e-mail, endereço ou um campo personalizado da ficha que o contato informou.' },
  close: { label: 'Encerrar a conversa', desc: 'Encerra com um dos motivos liberados quando o assunto terminou.' },
} as const;
export type AgentToolKey = keyof typeof AGENT_TOOLS;
export const AGENT_TOOL_KEYS = Object.keys(AGENT_TOOLS) as AgentToolKey[];

export interface AgentTransition {
  /** etapa de destino */
  to: string;
  /** condição em linguagem natural: "o cliente disse qual produto quer" */
  when: string;
}

export interface AgentStage {
  id: string;
  name: string;
  /** o prompt da etapa: o que a IA faz e busca aqui */
  goal: string;
  transitions: AgentTransition[];
  /** ferramentas que a IA pode usar NESTA etapa (subconjunto das liberadas no agente) */
  tools: AgentToolKey[];
}

/** Alvos liberados de cada ferramenta: a IA só escolhe entre estes. */
export interface AgentToolTargets {
  departmentIds?: string[];
  tagIds?: string[];
  closeReasonIds?: string[];
  /** campos da ficha, como no bloco Salvar dos fluxos: `name`, `email`, `address`, `note1`, `note2` ou `attribute:<rótulo>` */
  contactFields?: string[];
}

export type AgentTone = 'friendly' | 'formal' | 'casual';
export const AGENT_TONES: Record<AgentTone, string> = { friendly: 'Simpático e acolhedor', formal: 'Formal e objetivo', casual: 'Descontraído' };

export interface AiAgentConfig {
  name: string;
  /** quem a IA é: "Você é a Ana, atendente da Farmácia Modelo" */
  persona: string;
  tone: AgentTone;
  /** regras gerais que valem em todas as etapas ("nunca prometa prazo de entrega") */
  rules: string;
  /** base de conhecimento: única fonte de fatos (preços, horários, endereço, políticas) */
  knowledge: string;
  stages: AgentStage[];
  targets: AgentToolTargets;
  /** respostas no máximo por conversa antes de entregar para humano (freio de custo) */
  maxReplies: number;
  isActive: boolean;
}

export interface AiAgent extends AiAgentConfig {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export const AGENT_MAX_STAGES = 12;
export const AGENT_DEFAULT_MAX_REPLIES = 20;

/** Ação pedida pela IA, já conferida pelo código. */
export type AgentAction =
  | { tool: 'transfer_department'; departmentId: string; reason?: string }
  | { tool: 'handoff'; reason?: string }
  | { tool: 'add_tag'; tagId: string }
  | { tool: 'set_contact_field'; field: ContactField; value: string }
  | { tool: 'close'; closeReasonId?: string; outcome?: 'won' | 'lost' };

/** Resultado de uma rodada do agente (também o que o simulador mostra). */
export interface AgentTurn {
  reply: string;
  /** etapa depois desta rodada */
  stageId: string;
  actions: AgentAction[];
  /** o que a IA pediu e o código recusou (alvo não liberado, etapa inexistente) */
  rejected: string[];
  /** a IA disse que o assunto terminou */
  done: boolean;
}
