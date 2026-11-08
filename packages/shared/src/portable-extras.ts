import { AGENT_MAX_STAGES, AGENT_TONES, type AgentStage, type AgentTone } from './ai-agent.js';
import { PORTABLE_VERSION, parsePortableFile } from './portable.js';
import { TICKET_PRIORITIES, cleanTicketFields, type TicketField, type TicketPriority } from './tickets.js';

/**
 * Agentes de IA e tipos de ticket no formato portável (docs/20-modelos-de-perfil.md): o mesmo
 * arquivo serve para levar de um cliente a outro e para o modelo de perfil (Farmácia, Clínica…).
 * Nada que só existe dentro de um cliente viaja por id: etiqueta e motivo de encerramento vão
 * pelo nome; departamento não viaja (o destino escolhe o dele); documentos do agente ficam.
 */

export interface PortableAiAgent {
  atendo: 'ai-agent';
  version: number;
  name: string;
  persona: string;
  tone: AgentTone;
  rules: string;
  knowledge: string;
  stages: AgentStage[];
  maxReplies: number;
  isActive: boolean;
  /** alvos das ferramentas pelo NOME no destino (departamento não viaja) */
  targets: { tagNames?: string[]; closeReasonNames?: string[]; contactFields?: string[] };
}

export interface PortableTicketType {
  atendo: 'ticket-type';
  version: number;
  name: string;
  color: string;
  priority: TicketPriority;
  dueDays: number | null;
  fields: TicketField[];
  isActive: boolean;
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const names = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 80)))].slice(0, 50) : []);

export function parsePortableAiAgent(raw: unknown): PortableAiAgent {
  const o = raw as Partial<PortableAiAgent> | null;
  if (!o || typeof o !== 'object') throw new Error('Arquivo inválido.');
  if (o.atendo !== 'ai-agent') throw new Error('Este arquivo não é um agente de IA do Atendo.');
  if (o.version !== PORTABLE_VERSION) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
  const name = s(o.name, 80).trim();
  if (!name) throw new Error('O agente está sem nome.');
  if (!Array.isArray(o.stages) || !o.stages.length) throw new Error(`O agente "${name}" não tem etapas.`);
  if (o.stages.length > AGENT_MAX_STAGES) throw new Error(`O agente "${name}" tem mais de ${AGENT_MAX_STAGES} etapas.`);
  const t = (o.targets ?? {}) as PortableAiAgent['targets'];
  return {
    atendo: 'ai-agent', version: PORTABLE_VERSION, name,
    persona: s(o.persona, 2000), tone: (o.tone && o.tone in AGENT_TONES ? o.tone : 'friendly') as AgentTone,
    rules: s(o.rules, 4000), knowledge: s(o.knowledge, 20000),
    // a validação fina das etapas (ids, destinos, ferramentas) é a da API (`cleanStages`)
    stages: o.stages as AgentStage[],
    maxReplies: Number.isInteger(o.maxReplies) && o.maxReplies! >= 1 && o.maxReplies! <= 100 ? o.maxReplies! : 20,
    isActive: o.isActive !== false,
    targets: { tagNames: names(t.tagNames), closeReasonNames: names(t.closeReasonNames), contactFields: names(t.contactFields) },
  };
}

export function parsePortableTicketType(raw: unknown): PortableTicketType {
  const o = raw as Partial<PortableTicketType> | null;
  if (!o || typeof o !== 'object') throw new Error('Arquivo inválido.');
  if (o.atendo !== 'ticket-type') throw new Error('Este arquivo não é um tipo de ticket do Atendo.');
  if (o.version !== PORTABLE_VERSION) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
  const name = s(o.name, 60).trim();
  if (name.length < 2) throw new Error('O tipo de ticket está sem nome.');
  return {
    atendo: 'ticket-type', version: PORTABLE_VERSION, name,
    color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : '#6366f1',
    priority: (TICKET_PRIORITIES as readonly string[]).includes(o.priority as string) ? (o.priority as TicketPriority) : 'normal',
    dueDays: Number.isInteger(o.dueDays) && o.dueDays! >= 1 && o.dueDays! <= 365 ? o.dueDays! : null,
    fields: cleanTicketFields(o.fields),
    isActive: o.isActive !== false,
  };
}

/** Arquivo individual ou lote (`ai-agent-bundle`). Tudo ou nada. */
export const parsePortableAiAgentFile = (raw: unknown) =>
  parsePortableFile(raw, { kind: 'ai-agent', max: 50, parseItem: parsePortableAiAgent, text: { empty: 'O arquivo não tem agentes.', tooMany: 'No máximo 50 agentes por arquivo.', item: (n) => `Agente ${n}` } });

export const parsePortableTicketTypeFile = (raw: unknown) =>
  parsePortableFile(raw, { kind: 'ticket-type', max: 100, parseItem: parsePortableTicketType, text: { empty: 'O arquivo não tem tipos de ticket.', tooMany: 'No máximo 100 tipos por arquivo.', item: (n) => `Tipo ${n}` } });
