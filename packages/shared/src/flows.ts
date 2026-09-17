/**
 * Definição de um fluxo de automação (o que o editor salva e o motor executa).
 * Um fluxo é um grafo: nós + arestas. Cada nó tem um tipo e dados próprios.
 */
export type FlowNodeType = 'start' | 'message' | 'question' | 'menu' | 'condition' | 'action' | 'wait' | 'end';

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
export type ActionNode = FlowNodeBase<'action', { kind: 'add_tag' | 'remove_tag' | 'assign' | 'set_status' | 'handoff'; tagId?: string; agentId?: string; status?: 'waiting' | 'in_progress' | 'closed' }>;
export type WaitNode = FlowNodeBase<'wait', { minutes: number }>;
export type EndNode = FlowNodeBase<'end', { closeConversation: boolean }>;

export type FlowNode = StartNode | MessageNode | QuestionNode | MenuNode | ConditionNode | ActionNode | WaitNode | EndNode;

/** sourceHandle: menu → id da opção ou 'fallback'; condition → 'yes' | 'no'; demais → undefined */
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
};
