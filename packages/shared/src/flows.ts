/**
 * Definição de um fluxo de automação (o que o editor salva e o motor executa).
 * Um fluxo é um grafo: nós + arestas. Cada nó tem um tipo e dados próprios.
 */
export type FlowNodeType = 'start' | 'message' | 'question' | 'menu' | 'condition' | 'action' | 'wait' | 'end' | 'schedule' | 'ai' | 'variable' | 'randomizer' | 'distributor' | 'connect_flow';

export interface FlowNodeBase<T extends FlowNodeType, D> {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: D;
}

export type StartNode = FlowNodeBase<'start', Record<string, never>>;
/**
 * Conteúdo: várias mensagens enviadas em ordem (`items`). Os campos soltos `text`/`mediaKey`/
 * `mediaType`/`mediaName` são o formato antigo (um texto + um anexo); `normalizeContent` lê os dois.
 */
export type MessageNode = FlowNodeBase<'message', { items?: ContentItem[] } & LegacyContentData>;
export interface LegacyContentData { text?: string; mediaKey?: string; mediaType?: ContentMediaKind; mediaName?: string }

export type ContentMediaKind = 'image' | 'video' | 'document' | 'audio';
export type ContentItemKind = 'text' | ContentMediaKind;

export interface ContentItem {
  id: string;
  kind: ContentItemKind;
  /** text: o corpo; image/video/document: a legenda. Aceita {{variáveis}} e *negrito* _itálico_ ~tachado~. Áudio não tem legenda. */
  text?: string;
  /** chave no storage (`media/<tenant>/…`) */
  mediaKey?: string;
  /** nome do arquivo — no documento é o nome que o contato vê */
  mediaName?: string;
  mimeType?: string;
  /** bytes, gravado no upload (validação de tamanho ao salvar) */
  size?: number;
  /** audio: true (padrão) = áudio gravado (PTT); false = arquivo de áudio */
  voice?: boolean;
  /** segundos de espera antes desta mensagem (ignorado na primeira) */
  delay?: number;
}

/** Limites do WhatsApp por formato (os mesmos na Meta e na Evolution, que usam o mesmo app do contato). */
export const CONTENT_MEDIA_RULES: Record<ContentMediaKind, { label: string; maxMb: number; mimes: string[]; formats: string }> = {
  image: { label: 'Imagem', maxMb: 5, mimes: ['image/jpeg', 'image/png', 'image/webp'], formats: 'JPG, PNG ou WebP' },
  video: { label: 'Vídeo', maxMb: 16, mimes: ['video/mp4', 'video/3gpp'], formats: 'MP4 ou 3GP' },
  audio: { label: 'Áudio', maxMb: 16, mimes: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac'], formats: 'OGG, MP3, M4A ou AAC' },
  document: {
    label: 'Documento',
    maxMb: 100,
    mimes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    formats: 'PDF, Word, Excel ou PowerPoint',
  },
};

/** Intervalo máximo entre mensagens do mesmo Conteúdo. Mais que isso é caso do Atraso inteligente. */
export const CONTENT_MAX_DELAY_SEC = 300;

/** Problema de formato/tamanho de um anexo, ou `null` se cabe nos limites do WhatsApp. */
export function contentMediaError(kind: ContentMediaKind, mimeType?: string, size?: number): string | null {
  const r = CONTENT_MEDIA_RULES[kind];
  if (mimeType && !r.mimes.includes(mimeType.split(';')[0].trim().toLowerCase())) return `${r.label}: formato não aceito pelo WhatsApp (use ${r.formats}).`;
  if (size && size > r.maxMb * 1024 * 1024) return `${r.label}: o WhatsApp aceita até ${r.maxMb} MB (este tem ${(size / 1024 / 1024).toFixed(1)} MB).`;
  return null;
}

/**
 * Lê o Conteúdo em qualquer formato. Antigo: texto + anexo viram **um** item com legenda
 * (exatamente o que era enviado); áudio não tem legenda, então o texto vira uma segunda mensagem.
 */
export function normalizeContent(data: MessageNode['data']): ContentItem[] {
  if (Array.isArray(data.items)) return data.items;
  const text = data.text ?? '';
  if (!data.mediaKey) return text ? [{ id: 'legacy', kind: 'text', text }] : [];
  const media: ContentItem = { id: 'legacy', kind: data.mediaType ?? 'document', mediaKey: data.mediaKey, mediaName: data.mediaName };
  if (media.kind !== 'audio') return [{ ...media, text: text || undefined }];
  return text ? [media, { id: 'legacy-text', kind: 'text', text }] : [media];
}
/**
 * Bloco "Salvar": espera a resposta do contato e guarda numa variável. `text` vazio = não
 * pergunta nada, só espera (a pergunta veio de um bloco anterior). `contactField` grava
 * também na ficha do contato, para valer fora deste fluxo.
 */
export type QuestionNode = FlowNodeBase<'question', { text: string; varName: string; validation: 'none' | 'email' | 'phone' | 'number'; invalidText?: string; maxRetries: number; contactField?: ContactField } & ReplyTimeout>;

export type DelayUnit = 'minutes' | 'hours' | 'days';
/**
 * Tempo limite de resposta (Salvar e Menu). `timeoutMinutes` é o total (0/ausente = espera
 * indefinidamente); `timeoutUnit` só diz como mostrar. Vencido, o fluxo sai por
 * `REPLY_TIMEOUT_HANDLE` ("Não respondeu"); sem essa saída ligada, o fluxo termina.
 */
export interface ReplyTimeout { timeoutMinutes?: number; timeoutUnit?: DelayUnit }
/** Saída "Não respondeu" (tempo limite) do Salvar e do Menu. */
export const REPLY_TIMEOUT_HANDLE = 'timeout';
/**
 * Saída "Tentativas esgotadas" do Menu e do Salvar (no Menu, é o id antigo da "resposta
 * inválida"). Sem ela ligada, entrega para humano.
 */
export const RETRIES_EXHAUSTED_HANDLE = 'fallback';
/** Campos da ficha do contato que um fluxo pode preencher. */
export type ContactField = 'name' | 'email' | 'address' | 'note1' | 'note2';
export const CONTACT_FIELD_LABEL: Record<ContactField, string> = { name: 'Nome', email: 'E-mail', address: 'Endereço', note1: 'Observação 1', note2: 'Observação 2' };
export type MenuNode = FlowNodeBase<'menu', { text: string; options: { id: string; label: string }[]; invalidText?: string; maxRetries: number } & ReplyTimeout>;
/**
 * Condição: lista de ramos avaliados em ordem; o primeiro verdadeiro define a saída
 * (sourceHandle = id do ramo). Nenhum verdadeiro → saída "Senão" (`CONDITION_ELSE`).
 *
 * Os campos `kind`/`varName`/`value`/`tagId`/`hours` são o formato antigo (um critério,
 * saídas 'yes'/'no'). Nó salvo assim é lido por `normalizeCondition`, que o converte em um
 * ramo de id 'yes' + Senão ('no') — as ligações salvas continuam valendo sem migrar o banco.
 */
export type ConditionNode = FlowNodeBase<'condition', { branches?: ConditionBranch[] } & LegacyConditionData>;
export interface LegacyConditionData { kind?: 'var_equals' | 'var_contains' | 'var_filled' | 'has_tag' | 'business_hours'; varName?: string; value?: string; tagId?: string; hours?: { start: string; end: string; days: number[] } }

export interface ConditionBranch {
  id: string;
  label: string;
  /** all = todas as regras (E); any = qualquer uma (OU) */
  match: 'all' | 'any';
  rules: ConditionRule[];
}

/**
 * De onde vem o valor comparado. Para plugar um operando novo (ex.: horário de atendimento
 * de um setor): acrescente aqui, em `CONDITION_OPERANDS` e no registro `OPERANDS` do
 * avaliador (`apps/api/src/modules/flows/conditions.ts`).
 */
export type ConditionOperand = 'var' | 'contact' | 'message' | 'now' | 'tag' | 'business_hours';
/** text = texto/número/existência; datetime = dia/horário; flag = verdadeiro/falso */
export type ConditionValueKind = 'text' | 'datetime' | 'flag';

export type ConditionOp =
  | 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'num_eq' | 'num_neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'empty' | 'not_empty'
  | 'weekday_in' | 'time_between'
  | 'is_true' | 'is_false';

export interface ConditionRule {
  id: string;
  operand: ConditionOperand;
  /** var: nome da variável; contact: campo da ficha (`ConditionContactField`) */
  key?: string;
  op: ConditionOp;
  /** comparadores de texto/número. Aceita {{variáveis}}. */
  value?: string;
  /** texto: diferencia maiúsculas/minúsculas e acentos (padrão: não diferencia) */
  caseSensitive?: boolean;
  /** weekday_in: 0 = domingo … 6 = sábado */
  days?: number[];
  /** time_between: HH:MM. `from` > `to` atravessa a meia-noite (22:00–06:00). */
  from?: string;
  to?: string;
  /** tag: etiqueta da conversa ou do contato */
  tagId?: string;
  /** business_hours: horário próprio (veio do formato antigo); sem ele vale Configurações → Horário */
  hours?: { start: string; end: string; days: number[] };
}

export type ConditionContactField = 'name' | 'phone' | 'email' | 'address' | 'note1' | 'note2';
export const CONDITION_CONTACT_FIELD_LABEL: Record<ConditionContactField, string> = { name: 'Nome', phone: 'Telefone', email: 'E-mail', address: 'Endereço', note1: 'Observação 1', note2: 'Observação 2' };

export const CONDITION_OPERANDS: Record<ConditionOperand, { label: string; kind: ConditionValueKind }> = {
  var: { label: 'Variável do fluxo', kind: 'text' },
  contact: { label: 'Campo do contato', kind: 'text' },
  message: { label: 'Mensagem recebida', kind: 'text' },
  now: { label: 'Data/hora atual', kind: 'datetime' },
  tag: { label: 'Etiqueta', kind: 'flag' },
  business_hours: { label: 'Horário comercial', kind: 'flag' },
};

export const CONDITION_OPS: Record<ConditionValueKind, { op: ConditionOp; label: string }[]> = {
  text: [
    { op: 'eq', label: 'é igual a' }, { op: 'neq', label: 'é diferente de' },
    { op: 'contains', label: 'contém' }, { op: 'not_contains', label: 'não contém' },
    { op: 'starts_with', label: 'começa com' }, { op: 'ends_with', label: 'termina com' },
    { op: 'num_eq', label: '= (número)' }, { op: 'num_neq', label: '≠ (número)' },
    { op: 'gt', label: '> (número)' }, { op: 'gte', label: '≥ (número)' },
    { op: 'lt', label: '< (número)' }, { op: 'lte', label: '≤ (número)' },
    { op: 'empty', label: 'está vazio' }, { op: 'not_empty', label: 'não está vazio' },
  ],
  datetime: [{ op: 'weekday_in', label: 'dia da semana é' }, { op: 'time_between', label: 'horário entre' }],
  flag: [{ op: 'is_true', label: 'sim' }, { op: 'is_false', label: 'não' }],
};

/** Saída "Senão" da Condição. É 'no' para casar com a saída "Não" do formato antigo. */
export const CONDITION_ELSE = 'no';

/** Lê a Condição em qualquer formato (novo ou antigo) como lista de ramos. */
export function normalizeCondition(data: ConditionNode['data']): ConditionBranch[] {
  if (Array.isArray(data.branches)) return data.branches;
  const rule = legacyRule(data);
  return [{ id: 'yes', label: 'Sim', match: 'all', rules: rule ? [rule] : [] }];
}

function legacyRule(d: LegacyConditionData): ConditionRule | undefined {
  const id = 'r1';
  switch (d.kind) {
    case 'var_equals':
    case 'var_contains':
    case 'var_filled': {
      const name = d.varName ?? '';
      const op: ConditionOp = d.kind === 'var_equals' ? 'eq' : d.kind === 'var_contains' ? 'contains' : 'not_empty';
      const target = name.startsWith('contact.') ? { operand: 'contact' as const, key: name.slice(8) } : { operand: 'var' as const, key: name };
      return { id, ...target, op, ...(op === 'not_empty' ? {} : { value: d.value ?? '' }) };
    }
    case 'has_tag':
      return { id, operand: 'tag', op: 'is_true', tagId: d.tagId };
    case 'business_hours':
      return { id, operand: 'business_hours', op: 'is_true', ...(d.hours ? { hours: d.hours } : {}) };
  }
  return undefined;
}

/** scope: 'conversation' (padrão) = tag do atendimento; 'contact' = tag da pessoa, vale para sempre */
/**
 * set_var é legado: fluxos novos usam o bloco "Manipulador". "Encerrar conversa" no editor é
 * `set_status` + `closed`.
 * webhook: `method` (padrão POST), `headers` e `body` aceitam {{variáveis}}; `body` vazio = JSON
 * com o contexto da conversa (formato antigo). Falha (rede, tempo limite, status ≠ 2xx) sai por
 * `WEBHOOK_ERROR_HANDLE` se estiver ligada; senão segue pela saída normal.
 */
export type ActionNode = FlowNodeBase<'action', {
  kind: 'add_tag' | 'remove_tag' | 'assign' | 'set_status' | 'handoff' | 'set_var' | 'webhook';
  tagId?: string; scope?: 'conversation' | 'contact'; agentId?: string; status?: 'waiting' | 'in_progress' | 'closed';
  /** set_var */ varName?: string; value?: string;
  /** webhook */ url?: string; method?: WebhookMethod; headers?: WebhookHeader[]; body?: string; timeoutSec?: number;
  /** webhook: guarda o corpo da resposta nesta variável */ responseVar?: string;
}>;
export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export const WEBHOOK_METHODS: WebhookMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export interface WebhookHeader { id: string; key: string; value: string }
/** Saída "Erro" do webhook. */
export const WEBHOOK_ERROR_HANDLE = 'error';
export const WEBHOOK_DEFAULT_TIMEOUT_SEC = 8;
export const WEBHOOK_MAX_TIMEOUT_SEC = 30;
/**
 * Atraso inteligente. `mode` ausente/'duration': espera `minutes` (sempre o total, compatível com
 * fluxos antigos; `unit` só diz como mostrar). `businessHours`: se o prazo cair fora do
 * expediente, espera até a próxima abertura. `mode: 'next_open'`: espera até o próximo horário
 * de atendimento (segue na hora se já estiver aberto) — hoje o expediente de Configurações →
 * Horário; o módulo de horários vai plugar aqui a origem do horário.
 */
export type WaitNode = FlowNodeBase<'wait', { mode?: 'duration' | 'next_open'; minutes: number; unit?: DelayUnit; businessHours?: boolean }>;
/**
 * Manipulador (tipo interno 'variable', exibido como "Manipulador"): operações sobre as
 * variáveis do fluxo, executadas em ordem. `op` ausente = 'set' (fluxos antigos).
 * `value` aceita {{variáveis}}.
 */
export type VariableNode = FlowNodeBase<'variable', { assignments: VariableAssignment[] }>;
export type VariableOp = 'set' | 'add' | 'subtract' | 'append' | 'clear' | 'copy' | 'now';
export interface VariableAssignment {
  id: string;
  varName: string;
  op?: VariableOp;
  value: string;
  /** copy: nome da variável de origem */
  from?: string;
  /** now: formato gravado (no fuso do cliente) */
  format?: 'datetime' | 'date' | 'time';
}
export const VARIABLE_OP_LABEL: Record<VariableOp, string> = {
  set: 'Definir valor', add: 'Somar', subtract: 'Subtrair', append: 'Acrescentar texto',
  clear: 'Limpar', copy: 'Copiar de outra variável', now: 'Data/hora atual',
};
/** Divide o tráfego por peso (teste A/B). Cada ramo é uma saída (sourceHandle = id do ramo). */
export type RandomizerNode = FlowNodeBase<'randomizer', { branches: { id: string; label: string; weight: number }[] }>;
/**
 * Distribui a conversa. round_robin = rodízio entre os atendentes; least_busy = quem tem
 * menos conversas abertas; queue = devolve para a fila "Aguardando". `agentIds` vazio = todos
 * os atendentes ativos que operam o número da conversa. Saídas: 'done' e 'fallback' (ninguém disponível).
 */
export type DistributorNode = FlowNodeBase<'distributor', { mode: 'round_robin' | 'least_busy' | 'queue'; agentIds?: string[] }>;
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
  /**
   * answer: continua conversando (responde, espera a próxima mensagem do contato, responde
   * de novo) em vez de responder uma vez só. Sem isto o bloco é de tiro único e o contato
   * fica sem resposta na segunda pergunta.
   */
  keepTalking?: boolean;
  /**
   * answer + keepTalking: quantas respostas no máximo antes de entregar para humano.
   * É o freio de custo — sem limite, uma conversa sozinha consome interações sem parar.
   */
  maxTurns?: number;
}>;

/**
 * Conectar com outro fluxo: termina este fluxo e começa `flowId` do início, na mesma conversa.
 * Não há retorno. As variáveis seguem para o destino. `flowName` só existe no arquivo
 * exportado (o id não vale em outro cliente).
 */
export type ConnectFlowNode = FlowNodeBase<'connect_flow', { flowId?: string; flowName?: string }>;
/** Saltos entre fluxos seguidos, sem resposta do contato no meio, antes de entregar para humano. */
export const MAX_FLOW_HOPS = 5;

export type FlowNode = StartNode | MessageNode | QuestionNode | MenuNode | ConditionNode | ActionNode | WaitNode | EndNode | ScheduleNode | AiNode | VariableNode | RandomizerNode | DistributorNode | ConnectFlowNode;

/**
 * sourceHandle: menu → id da opção, 'fallback' (tentativas esgotadas) ou 'timeout'; question → null ou 'timeout';
 * action webhook → null ou 'error'; condition → id do ramo | 'no' (Senão; antigo: 'yes' | 'no'); ai → 'done'/id do
 * rótulo ou 'fallback'; randomizer → id do ramo; distributor → 'done' | 'fallback'; demais → undefined
 */
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
  message: 'Conteúdo',
  question: 'Salvar',
  menu: 'Menu',
  condition: 'Condição',
  action: 'Ação',
  wait: 'Atraso inteligente',
  end: 'Fim',
  schedule: 'Agendar horário',
  ai: 'IA',
  variable: 'Manipulador',
  randomizer: 'Randomizador',
  distributor: 'Distribuidor',
  connect_flow: 'Conectar com outro fluxo',
};

/** Prefixos de variáveis que carregam o id do nó que as criou (`menu_<id>`). */
const NODE_VAR_PREFIXES = ['menu_'];

/**
 * Copia um pedaço do desenho (colar cards). Gera ids novos, mantém só as ligações entre os
 * nós copiados, desloca as posições e reescreve as variáveis que carregam o id do nó
 * (`{{menu_<id>}}`) — senão o card colado leria a escolha do menu original.
 * O nó Início não é copiado (o fluxo só pode ter um), exceto com `includeStart` (importação,
 * que renova os ids do fluxo inteiro).
 */
export function cloneFlowFragment(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: { newId: (type: FlowNodeType) => string; offset?: { x: number; y: number }; includeStart?: boolean },
): FlowDefinition {
  const src = opts.includeStart ? nodes : nodes.filter((n) => n.type !== 'start');
  const map = new Map(src.map((n) => [n.id, opts.newId(n.type)]));
  const off = opts.offset ?? { x: 0, y: 0 };
  const rewrite = (data: unknown) => {
    let json = JSON.stringify(data ?? {});
    for (const [from, to] of map) for (const p of NODE_VAR_PREFIXES) json = json.split(`${p}${from}`).join(`${p}${to}`);
    return JSON.parse(json);
  };
  return {
    nodes: src.map((n) => ({ ...n, id: map.get(n.id)!, position: { x: n.position.x + off.x, y: n.position.y + off.y }, data: rewrite(n.data) }) as FlowNode),
    edges: edges
      .filter((e) => map.has(e.source) && map.has(e.target))
      .map((e) => {
        const source = map.get(e.source)!;
        const target = map.get(e.target)!;
        return { id: `e-${source}-${e.sourceHandle ?? 'out'}-${target}`, source, sourceHandle: e.sourceHandle ?? null, target };
      }),
  };
}
