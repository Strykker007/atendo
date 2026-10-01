import type { FlowDefinition, FlowTrigger } from '@atendo/shared';

/**
 * Levar um fluxo de um cliente para outro.
 *
 * O `definition` guarda referências que só existem dentro de um cliente — etiqueta,
 * atendente, serviço, arquivo de mídia. Copiar o JSON cru para outro cliente deixaria
 * referências mortas, e no caso da mídia seria pior: a chave carrega o tenant de origem
 * (`media/<tenantId>/…`), então o cliente de destino passaria a servir arquivo alheio.
 *
 * Por isso o formato portável troca o que dá para traduzir (etiqueta vira **nome**, que é
 * único por cliente) e remove o que não dá, sempre avisando o que saiu — um fluxo que chega
 * mudo no destino é pior do que um fluxo que chega avisando o que falta ajustar.
 */

export const PORTABLE_VERSION = 1;

export interface PortableFlow {
  atendo: 'flow';
  version: number;
  name: string;
  description?: string;
  trigger: FlowTrigger;
  definition: FlowDefinition;
}

/** Nome do que foi removido, para mostrar ao usuário. */
export type Warning = string;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Campos de nó que referenciam algo do cliente e não sobrevivem à cópia. */
type AnyNode = { id: string; type: string; data: Record<string, unknown> };

/**
 * Prepara o fluxo para sair do cliente: `tagId` vira `tagName`, o resto das referências é
 * removido com aviso.
 */
export function toPortable(
  flow: { name: string; description?: string | null; trigger: FlowTrigger; definition: FlowDefinition },
  tagNameById: Record<string, string> = {},
): { portable: PortableFlow; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const definition = clone(flow.definition);
  const trigger = clone(flow.trigger);

  for (const node of definition.nodes as unknown as AnyNode[]) {
    const d = node.data;

    if (typeof d.tagId === 'string') {
      const name = tagNameById[d.tagId];
      delete d.tagId;
      if (name) d.tagName = name;
      else warnings.push('Uma etiqueta não existe mais e foi removida de um bloco.');
    }

    if (typeof d.agentId === 'string') {
      delete d.agentId;
      warnings.push('Atribuição a um atendente específico foi removida — escolha o atendente no destino.');
    }

    if (typeof d.serviceId === 'string' || typeof d.professionalId === 'string') {
      delete d.serviceId;
      delete d.professionalId;
      warnings.push('Serviço/profissional fixos do bloco Agendar foram removidos — o fluxo vai perguntar ao contato.');
    }

    if (typeof d.mediaKey === 'string') {
      delete d.mediaKey;
      delete d.mediaType;
      delete d.mediaName;
      warnings.push('Um anexo foi removido — reenvie o arquivo no cliente de destino.');
    }
  }

  if (trigger.numberIds?.length) {
    delete trigger.numberIds;
    warnings.push('O gatilho valia só para alguns números; no destino passa a valer para todos.');
  }

  return {
    portable: {
      atendo: 'flow',
      version: PORTABLE_VERSION,
      name: flow.name,
      description: flow.description ?? undefined,
      trigger,
      definition,
    },
    warnings: dedupe(warnings),
  };
}

/** Nomes de etiqueta citados no arquivo — o destino precisa garantir que existam antes. */
export function tagNamesOf(portable: PortableFlow): string[] {
  const names = (portable.definition.nodes as unknown as AnyNode[])
    .map((n) => n.data.tagName)
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return [...new Set(names)];
}

/**
 * Traz o fluxo para dentro do cliente de destino: `tagName` volta a ser `tagId`.
 * Quem chama resolve/cria as etiquetas antes e passa o mapa pronto.
 */
export function fromPortable(
  portable: PortableFlow,
  tagIdByName: Record<string, string>,
): { name: string; description?: string; trigger: FlowTrigger; definition: FlowDefinition; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const definition = clone(portable.definition);

  for (const node of definition.nodes as unknown as AnyNode[]) {
    const d = node.data;
    if (typeof d.tagName === 'string') {
      const name = d.tagName; // guardar antes de apagar: o aviso precisa dizer QUAL etiqueta
      const id = tagIdByName[name];
      delete d.tagName;
      if (id) d.tagId = id;
      else warnings.push(`A etiqueta "${name}" não pôde ser criada e saiu do bloco.`);
    }
  }

  return {
    name: portable.name,
    description: portable.description,
    trigger: clone(portable.trigger),
    definition,
    warnings: dedupe(warnings),
  };
}

/**
 * Valida o que veio de um arquivo enviado pelo usuário. Não confia em nada: o conteúdo pode
 * ter sido editado à mão entre exportar e importar.
 */
export function parsePortable(raw: unknown): PortableFlow {
  const o = raw as Partial<PortableFlow> | null;
  if (!o || typeof o !== 'object') throw new Error('Arquivo inválido.');
  if (o.atendo !== 'flow') throw new Error('Este arquivo não é um fluxo do Atendo.');
  if (o.version !== PORTABLE_VERSION) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
  if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('O fluxo está sem nome.');
  const def = o.definition as FlowDefinition | undefined;
  if (!def || !Array.isArray(def.nodes) || !Array.isArray(def.edges)) throw new Error('O desenho do fluxo está corrompido.');
  if (!o.trigger || typeof o.trigger !== 'object') throw new Error('O gatilho do fluxo está corrompido.');
  return { ...o, atendo: 'flow', version: PORTABLE_VERSION, name: o.name, trigger: o.trigger, definition: def } as PortableFlow;
}

/** "(cópia)", "(cópia 2)"… a partir dos nomes já usados pelo cliente. */
export function copyName(base: string, taken: string[], max = 80): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? ' (cópia)' : ` (cópia ${i})`;
    const name = base.slice(0, max - suffix.length) + suffix;
    if (!used.has(name)) return name;
  }
}

const dedupe = (v: Warning[]): Warning[] => [...new Set(v)];
