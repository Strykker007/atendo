/**
 * Definição de um fluxo de automação (o que o editor salva e o motor executa).
 * Um fluxo é um grafo: nós + arestas. Cada nó tem um tipo e dados próprios.
 */
export type FlowNodeType = 'start' | 'message' | 'question' | 'menu' | 'condition' | 'action' | 'wait' | 'end' | 'schedule' | 'ai';

export interface FlowNodeBase<T extends FlowNodeType, D> {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: D;
}

export type StartNode = FlowNodeBase<'start', Record<string, never>>;
export type MessageNode = FlowNodeBase<'message', { text?: string; mediaKey?: string; mediaType?: 'image' | 'document' | 'audio' | 'video'; mediaName?: string }>;
export type QuestionNode = FlowNodeBase<'question', { text: string; varName: string; validation: 'none' | 'email' | 'phone' | 'number'; invalidText?: string; maxRetries: number }>;
export type MenuNode = FlowNodeBase<'menu', { text: string; options: { id: string; label: string }[]; invalidText?: string; maxRetries: number }>;
export type ConditionNode = FlowNodeBase<'condition', { kind: 'var_equals' | 'var_contains' | 'has_tag' | 'business_hours'; varName?: string; value?: string; tagId?: string; hours?: { start: string; end: string; days: number[] } }>;
/** scope: 'conversation' (padrão) = tag do atendimento; 'contact' = tag da pessoa, vale para sempre */
export type ActionNode = FlowNodeBase<'action', { kind: 'add_tag' | 'remove_tag' | 'assign' | 'set_status' | 'handoff' | 'set_var'; tagId?: string; scope?: 'conversation' | 'contact'; agentId?: string; status?: 'waiting' | 'in_progress' | 'closed'; /** set_var */ varName?: string; value?: string }>;
export type WaitNode = FlowNodeBase<'wait', { minutes: number }>;
export type EndNode = FlowNodeBase<'end', { closeConversation: boolean }>;
/**
 * Agendar pelo WhatsApp: pergunta serviço → profissional → horário → confirma e cria o agendamento.
 * serviceId/professionalId fixos pulam a pergunta. Saídas: 'done' (agendou) e 'fallback' (desistiu/erro).
 */
export type ScheduleNode = FlowNodeBase<'schedule', { intro?: string; serviceId?: string; professionalId?: string; maxSlots: number; confirmText?: string }>;

/**
 * IA no fluxo. Dois modos:
 * - `answer`: responde a última mensagem do contato com base nas instruções e na base de
 *   conhecimento do cliente. Saídas: 'done' e 'fallback' (IA indisponível, sem quota ou erro).
 * - `classify`: escolhe um dos rótulos e sai por ele. Saídas: um id por rótulo + 'fallback'.
 *
 * A IA **nunca** inventa: o prompt manda dizer que vai verificar quando a informação não
 * estiver na base. Por isso todo nó de IA deve ter a saída 'fallback' ligada a um humano.
 */
export type AiNode = FlowNodeBase<'ai', {
  mode: 'answer' | 'classify';
  /** quem é o negócio e o que a IA pode ou não fazer */
  instructions: string;
  /** answer: única fonte de fatos (FAQ, preços, endereço) */
  knowledge?: string;
  /** answer: guarda a resposta nesta variável além de enviar */
  varName?: string;
  /** classify: rótulos que viram as saídas do nó */
  labels?: { id: string; label: string }[];
  /** mensagem enviada quando a IA não puder responder */
  fallbackText?: string;
}>;

export type FlowNode = StartNode | MessageNode | QuestionNode | MenuNode | ConditionNode | ActionNode | WaitNode | EndNode | ScheduleNode | AiNode;

/** sourceHandle: menu → id da opção ou 'fallback'; condition → 'yes' | 'no'; ai → 'done'/id do rótulo ou 'fallback'; demais → undefined */
export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowTrigger {
  /** manual = atendente dispara no chat; new_conversation = toda conversa nova (opcionalmente só de alguns números); keyword = mensagem recebida contém uma das palavras */
  type: 'manual' | 'new_conversation' | 'keyword';
  numberIds?: string[];
  keywords?: string[];
}

export const FLOW_NODE_LABEL: Record<FlowNodeType, string> = {
  start: 'Início',
  message: 'Enviar mensagem',
  question: 'Perguntar',
  menu: 'Menu de opções',
  condition: 'Condição',
  action: 'Ação',
  wait: 'Aguardar',
  end: 'Fim',
  schedule: 'Agendar horário',
  ai: 'IA',
};
