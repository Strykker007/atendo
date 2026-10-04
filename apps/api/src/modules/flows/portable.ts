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

/**
 * Arquivo com vários fluxos. Cada item é exatamente um `PortableFlow` — o mesmo que a
 * exportação individual gera —, então importar um lote é importar cada item.
 */
export interface PortableFlowBundle {
  atendo: 'flow-bundle';
  version: number;
  items: PortableFlow[];
}

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
 * Marca no próprio card o que precisa ser reconfigurado no destino. O editor mostra o aviso
 * no card e apaga a marca quando o bloco é editado; o motor ignora o campo.
 */
const flag = (d: Record<string, unknown>, what: string) => {
  const list = Array.isArray(d._reconfig) ? (d._reconfig as string[]) : [];
  if (!list.includes(what)) d._reconfig = [...list, what];
};

/**
 * Onde um nó guarda etiqueta: no próprio `data` (Ação, Condição antiga) e em cada regra dos
 * ramos da Condição.
 */
function tagHolders(node: AnyNode): Record<string, unknown>[] {
  const out = [node.data];
  if (node.type === 'condition' && Array.isArray(node.data.branches)) {
    for (const b of node.data.branches as { rules?: Record<string, unknown>[] }[]) out.push(...(b.rules ?? []));
  }
  return out;
}

/**
 * Prepara o fluxo para sair do cliente: `tagId` vira `tagName`, o resto das referências é
 * removido com aviso.
 */
export function toPortable(
  flow: { name: string; description?: string | null; trigger: FlowTrigger; definition: FlowDefinition },
  tagNameById: Record<string, string> = {},
  flowNameById: Record<string, string> = {},
): { portable: PortableFlow; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const definition = clone(flow.definition);
  const trigger = clone(flow.trigger);

  for (const node of definition.nodes as unknown as AnyNode[]) {
    const d = node.data;

    for (const holder of tagHolders(node)) {
      if (typeof holder.tagId !== 'string') continue;
      const name = tagNameById[holder.tagId];
      delete holder.tagId;
      if (name) holder.tagName = name;
      else {
        warnings.push('Uma etiqueta não existe mais e foi removida de um bloco.');
        flag(d, 'etiqueta');
      }
    }

    if (typeof d.agentId === 'string') {
      delete d.agentId;
      warnings.push('Atribuição a um atendente específico foi removida — escolha o atendente no destino.');
      flag(d, 'atendente');
    }

    if (Array.isArray(d.agentIds) && d.agentIds.length) {
      delete d.agentIds;
      warnings.push('Os atendentes do Distribuidor foram removidos — no destino ele distribui entre todos até você escolher.');
      flag(d, 'atendentes');
    }

    if (typeof d.serviceId === 'string' || typeof d.professionalId === 'string') {
      delete d.serviceId;
      delete d.professionalId;
      warnings.push('Serviço/profissional fixos do bloco Agendar foram removidos — o fluxo vai perguntar ao contato.');
      flag(d, 'serviço/profissional');
    }

    if (typeof d.mediaKey === 'string') {
      delete d.mediaKey;
      delete d.mediaType;
      delete d.mediaName;
      warnings.push('Um anexo foi removido — reenvie o arquivo no cliente de destino.');
      flag(d, 'anexo');
    }

    // Conteúdo com várias mensagens: cada anexo carrega o tenant na chave
    if (node.type === 'message' && Array.isArray(d.items)) {
      for (const it of d.items as Record<string, unknown>[]) {
        if (typeof it.mediaKey !== 'string') continue;
        delete it.mediaKey;
        warnings.push('Um anexo foi removido — reenvie o arquivo no cliente de destino.');
        flag(d, 'anexo');
      }
    }

    // o id do fluxo de destino não existe em outro cliente; o nome fica só como referência no card
    if (node.type === 'connect_flow' && typeof d.flowId === 'string') {
      const name = flowNameById[d.flowId];
      delete d.flowId;
      if (name) d.flowName = name;
      warnings.push('O destino de "Conectar com outro fluxo" foi removido — escolha o fluxo no cliente de destino.');
      flag(d, 'fluxo de destino');
    }

    // a URL do webhook costuma levar token na query: não sai do cliente
    if (node.type === 'action' && typeof d.url === 'string' && d.url) {
      delete d.url;
      warnings.push('A URL de um webhook foi removida (pode conter token) — informe-a no destino.');
      flag(d, 'URL do webhook');
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
    .flatMap((n) => tagHolders(n).map((h) => h.tagName))
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
    for (const holder of tagHolders(node)) {
      if (typeof holder.tagName !== 'string') continue;
      const name = holder.tagName; // guardar antes de apagar: o aviso precisa dizer QUAL etiqueta
      const id = tagIdByName[name];
      delete holder.tagName;
      if (id) holder.tagId = id;
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

export function toBundle(items: PortableFlow[]): PortableFlowBundle {
  return { atendo: 'flow-bundle', version: PORTABLE_VERSION, items };
}

/** Aceita o arquivo individual ou o lote; devolve sempre a lista de fluxos. */
export function parsePortableFile(raw: unknown): PortableFlow[] {
  const o = raw as Partial<PortableFlowBundle> | null;
  if (o && typeof o === 'object' && o.atendo === 'flow-bundle') {
    if (o.version !== PORTABLE_VERSION) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
    if (!Array.isArray(o.items) || !o.items.length) throw new Error('O arquivo não tem nenhum fluxo.');
    if (o.items.length > 100) throw new Error('No máximo 100 fluxos por arquivo.');
    return o.items.map((it, i) => {
      try {
        return parsePortable(it);
      } catch (e) {
        throw new Error(`Fluxo ${i + 1} do arquivo: ${e instanceof Error ? e.message : 'inválido'}`);
      }
    });
  }
  return [parsePortable(raw)];
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
