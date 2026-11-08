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

/**
 * Retrato da conversa guardado no ticket na abertura (docs/tickets.md#aberto-de-uma-conversa):
 * as últimas mensagens até o momento escolhido. O contexto fica no ticket mesmo que a conversa
 * seja apagada, limpa, ou de um setor que quem atende o ticket não vê.
 */
export interface TicketContextMessage {
  id: string;
  at: string;
  /** in = contato; out = equipe/robô; note = nota interna */
  from: 'in' | 'out' | 'note';
  /** atendente que escreveu (saída/nota); nulo = robô/sistema ou contato */
  author: string | null;
  text: string;
  /** a mensagem de onde o ticket foi aberto */
  anchor?: boolean;
}
/** quantas mensagens o retrato guarda */
export const TICKET_CONTEXT_SIZE = 12;

// ---------- tipos de ticket (docs/tickets.md#tipos-de-ticket) ----------
// O ticket é genérico: cada empresa cadastra os TIPOS do seu negócio (Manutenção, Encomenda,
// Retorno…), com setor/prioridade/prazo padrão e campos próprios. Modelos prontos por nicho
// dão o ponto de partida.

export const TICKET_FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'phone'] as const;
export type TicketFieldType = (typeof TICKET_FIELD_TYPES)[number];
export const TICKET_FIELD_TYPE_LABEL: Record<TicketFieldType, string> = {
  text: 'Texto curto', longtext: 'Texto longo', number: 'Número', date: 'Data', select: 'Lista de opções', phone: 'Telefone',
};
export const TICKET_TYPE_MAX_FIELDS = 15;
export const TICKET_FIELD_VALUE_MAX = 1000;

export interface TicketField {
  /** chave estável (minúsculas, sem acento): é o que o fluxo preenche */
  key: string;
  label: string;
  type: TicketFieldType;
  /** `select`: opções */
  options?: string[];
  required?: boolean;
}

export interface TicketType {
  id: string;
  name: string;
  color: string;
  /** setor padrão de quem abre este tipo */
  departmentId: string | null;
  priority: TicketPriority;
  /** prazo padrão em dias corridos (null = sem prazo) */
  dueDays: number | null;
  fields: TicketField[];
  isActive: boolean;
}

/** De onde o ticket veio — aparece na lista e no detalhe. */
export const TICKET_SOURCES = ['panel', 'conversation', 'flow', 'agent'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];
export const TICKET_SOURCE_LABEL: Record<TicketSource, string> = { panel: 'Painel', conversation: 'Conversa', flow: 'Fluxo automático', agent: 'Agente de IA' };

/** "Nº do apartamento" → "n_do_apartamento" */
export const ticketFieldKey = (label: string) =>
  label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'campo';

/** Normaliza a lista de campos de um tipo: chave única, rótulo, tipo conhecido, opções do select. */
export function cleanTicketFields(raw: unknown): TicketField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TicketField[] = [];
  for (const r of raw.slice(0, TICKET_TYPE_MAX_FIELDS)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 60) : '';
    if (!label) continue;
    let key = ticketFieldKey(typeof o.key === 'string' && o.key.trim() ? o.key : label);
    for (let i = 2; seen.has(key); i++) key = `${key.replace(/_\d+$/, '')}_${i}`;
    seen.add(key);
    const type = (TICKET_FIELD_TYPES as readonly string[]).includes(o.type as string) ? (o.type as TicketFieldType) : 'text';
    const options = type === 'select' && Array.isArray(o.options) ? [...new Set(o.options.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 30) : undefined;
    if (type === 'select' && !options?.length) continue;
    out.push({ key, label, type, ...(options && { options }), ...(o.required === true && { required: true }) });
  }
  return out;
}

/**
 * Confere os valores contra os campos do tipo. Devolve só os campos conhecidos, aparados, e quais
 * obrigatórios faltaram. `select` aceita a opção sem diferenciar maiúscula/acento (o fluxo manda o
 * que o contato digitou) e grava a opção cadastrada; fora da lista, guarda o texto (não perde a
 * informação) e avisa em `invalid`.
 */
export function checkTicketValues(fields: TicketField[], raw: Record<string, unknown> | null | undefined): { values: Record<string, string>; missing: string[]; invalid: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const invalid: string[] = [];
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  for (const f of fields) {
    const v = raw?.[f.key];
    let s = v === null || v === undefined ? '' : String(v).trim().slice(0, TICKET_FIELD_VALUE_MAX);
    if (s && f.type === 'select') {
      const hit = f.options?.find((o) => fold(o) === fold(s));
      if (hit) s = hit;
      else invalid.push(f.label);
    }
    if (s && f.type === 'number' && !/^-?\d+([.,]\d+)?$/.test(s.replace(/\s/g, ''))) invalid.push(f.label);
    if (s && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s) && !/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(s)) invalid.push(f.label);
    if (s) values[f.key] = s;
    else if (f.required) missing.push(f.label);
  }
  return { values, missing, invalid };
}

export interface TicketTypePresetItem { name: string; color: string; priority: TicketPriority; dueDays: number | null; fields: TicketField[] }
export interface TicketTypePreset { niche: string; label: string; types: TicketTypePresetItem[] }

const f = (label: string, type: TicketFieldType = 'text', extra: Partial<TicketField> = {}): TicketField => ({ key: ticketFieldKey(label), label, type, ...extra });

/** Pontos de partida por nicho. A empresa importa e ajusta (nome, campos, setor). */
export const TICKET_TYPE_PRESETS: TicketTypePreset[] = [
  {
    niche: 'condominio', label: 'Condomínio / portaria',
    types: [
      { name: 'Manutenção', color: '#f59e0b', priority: 'normal', dueDays: 3, fields: [f('Bloco'), f('Unidade', 'text', { required: true }), f('Local', 'select', { options: ['Unidade', 'Área comum', 'Garagem', 'Elevador', 'Fachada'] }), f('Problema', 'longtext', { required: true })] },
      { name: 'Reserva de área', color: '#3b82f6', priority: 'normal', dueDays: 2, fields: [f('Área', 'select', { options: ['Salão de festas', 'Churrasqueira', 'Quadra', 'Academia'], required: true }), f('Data', 'date', { required: true }), f('Unidade', 'text', { required: true })] },
      { name: 'Encomenda / entrega', color: '#10b981', priority: 'low', dueDays: 1, fields: [f('Unidade', 'text', { required: true }), f('Remetente'), f('Código de rastreio')] },
      { name: 'Ocorrência', color: '#ef4444', priority: 'high', dueDays: 1, fields: [f('Unidade'), f('O que aconteceu', 'longtext', { required: true })] },
    ],
  },
  {
    niche: 'farmacia', label: 'Farmácia / drogaria',
    types: [
      { name: 'Encomenda de produto', color: '#10b981', priority: 'normal', dueDays: 2, fields: [f('Produto', 'text', { required: true }), f('Quantidade', 'number'), f('Retirada ou entrega', 'select', { options: ['Retirada', 'Entrega'] }), f('Endereço')] },
      { name: 'Entrega', color: '#3b82f6', priority: 'high', dueDays: 1, fields: [f('Endereço', 'text', { required: true }), f('Itens', 'longtext'), f('Forma de pagamento', 'select', { options: ['Pix', 'Cartão', 'Dinheiro'] })] },
      { name: 'Troca / devolução', color: '#f59e0b', priority: 'normal', dueDays: 3, fields: [f('Produto', 'text', { required: true }), f('Motivo', 'longtext')] },
    ],
  },
  {
    niche: 'clinica', label: 'Clínica / consultório',
    types: [
      { name: 'Retorno', color: '#3b82f6', priority: 'normal', dueDays: 7, fields: [f('Paciente', 'text', { required: true }), f('Profissional'), f('Data desejada', 'date')] },
      { name: 'Resultado de exame', color: '#10b981', priority: 'normal', dueDays: 3, fields: [f('Paciente', 'text', { required: true }), f('Exame', 'text', { required: true })] },
      { name: 'Autorização de convênio', color: '#f59e0b', priority: 'high', dueDays: 2, fields: [f('Paciente', 'text', { required: true }), f('Convênio', 'text', { required: true }), f('Procedimento')] },
    ],
  },
  {
    niche: 'servicos', label: 'Serviços / assistência técnica',
    types: [
      { name: 'Ordem de serviço', color: '#f59e0b', priority: 'normal', dueDays: 5, fields: [f('Equipamento', 'text', { required: true }), f('Defeito', 'longtext', { required: true }), f('Endereço')] },
      { name: 'Orçamento', color: '#3b82f6', priority: 'normal', dueDays: 2, fields: [f('O que precisa', 'longtext', { required: true }), f('Endereço')] },
      { name: 'Garantia', color: '#ef4444', priority: 'high', dueDays: 3, fields: [f('Nota ou pedido'), f('Problema', 'longtext', { required: true })] },
    ],
  },
  {
    niche: 'geral', label: 'Genérico',
    types: [
      { name: 'Solicitação', color: '#6366f1', priority: 'normal', dueDays: 3, fields: [f('Detalhes', 'longtext')] },
      { name: 'Reclamação', color: '#ef4444', priority: 'high', dueDays: 2, fields: [f('Motivo', 'longtext', { required: true })] },
    ],
  },
];
