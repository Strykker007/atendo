import { cloneFlowFragment, type FlowDefinition, type FlowNodeType, type FlowTrigger } from './flows.js';

/**
 * Levar itens (fluxos, respostas rápidas…) de um cliente para outro — módulo único de
 * serialização, limpeza e importação. Puro (sem Nest/Prisma): a API usa na exportação e na
 * importação, o editor usa ao colar cards vindos de outra empresa.
 *
 * Os itens guardam referências que só existem dentro de um cliente — etiqueta, atendente,
 * serviço, arquivo de mídia, número, fluxo. Copiar o JSON cru deixaria referências mortas, e no
 * caso da mídia seria pior: a chave carrega o tenant de origem (`media/<tenantId>/…`), então o
 * destino passaria a servir arquivo alheio.
 *
 * Por isso o formato portável troca o que dá para traduzir (etiqueta vira **nome**, que é único
 * por cliente) e remove o que não dá, sempre avisando e marcando o card (`_reconfig`) — um item
 * que chega mudo no destino é pior do que um que chega avisando o que falta ajustar.
 *
 * Novo tipo portável (ex.: Respostas Rápidas): um `atendo: '<tipo>'` + `parse` do item e
 * `parsePortableFile` / `toBundle` / `uniqueName` / `flagReconfig` daqui.
 */

export const PORTABLE_VERSION = 1;

/** Lote: `atendo: '<tipo>-bundle'`; cada item é exatamente o arquivo individual. */
export interface PortableBundle<K extends string, T> {
  atendo: `${K}-bundle`;
  version: number;
  items: T[];
}

export function toBundle<K extends string, T>(kind: K, items: T[], version = PORTABLE_VERSION): PortableBundle<K, T> {
  return { atendo: `${kind}-bundle`, version, items };
}

/**
 * Aceita o arquivo individual ou o lote; devolve sempre a lista de itens. Tudo ou nada: um item
 * inválido recusa o arquivo inteiro (com o número dele na mensagem).
 */
export function parsePortableFile<T>(
  raw: unknown,
  spec: { kind: string; version?: number; max: number; parseItem: (raw: unknown) => T; text: { empty: string; tooMany: string; item: (n: number) => string } },
): T[] {
  const o = raw as Partial<PortableBundle<string, unknown>> | null;
  if (o && typeof o === 'object' && o.atendo === `${spec.kind}-bundle`) {
    if (o.version !== (spec.version ?? PORTABLE_VERSION)) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
    if (!Array.isArray(o.items) || !o.items.length) throw new Error(spec.text.empty);
    if (o.items.length > spec.max) throw new Error(spec.text.tooMany);
    return o.items.map((it, i) => {
      try {
        return spec.parseItem(it);
      } catch (e) {
        throw new Error(`${spec.text.item(i + 1)}: ${e instanceof Error ? e.message : 'inválido'}`);
      }
    });
  }
  return [spec.parseItem(raw)];
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

/** Conflito de nome na importação: mantém o nome se estiver livre, senão "(cópia)". */
export const uniqueName = (base: string, taken: string[], max = 80) => (taken.includes(base) ? copyName(base, taken, max) : base);

/**
 * Marca no próprio item o que precisa ser reconfigurado no destino. O editor mostra o aviso no
 * card e apaga a marca quando o bloco é editado; o motor ignora o campo.
 */
export const RECONFIG_KEY = '_reconfig';
export function flagReconfig(d: Record<string, unknown>, what: string) {
  const list = Array.isArray(d[RECONFIG_KEY]) ? (d[RECONFIG_KEY] as string[]) : [];
  if (!list.includes(what)) d[RECONFIG_KEY] = [...list, what];
}

export const dedupe = (v: string[]): string[] => [...new Set(v)];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------
// Fluxos
// ---------------------------------------------------------------------------

export interface PortableFlow {
  atendo: 'flow';
  version: number;
  name: string;
  description?: string;
  trigger: FlowTrigger;
  definition: FlowDefinition;
}
export type PortableFlowBundle = PortableBundle<'flow', PortableFlow>;

/** Nomes do cliente de origem, para traduzir id → nome (o que não estiver aqui sai com aviso). */
export interface SourceNames {
  tagNameById?: Record<string, string>;
  flowNameById?: Record<string, string>;
}

type AnyNode = { id: string; type: string; data: Record<string, unknown> };

/** Header de webhook que carrega credencial: não sai do cliente. */
export const isSensitiveHeader = (key: string) => {
  const k = key.trim().toLowerCase();
  return k === 'x-api-key' || k.includes('authorization') || k.includes('token') || k.includes('secret');
};

/** Marca de importação: todo webhook importado/colado de outra empresa pede revisão. */
export const WEBHOOK_REVIEW_FLAG = 'revisar configuração';

/**
 * Algum webhook do desenho tem corpo próprio? O corpo viaja na exportação (é conteúdo), mas pode
 * ter token escrito à mão — a tela avisa antes de baixar o arquivo.
 */
export function hasWebhookBody(def: FlowDefinition): boolean {
  return (def.nodes as unknown as AnyNode[]).some((n) => n.type === 'action' && n.data.kind === 'webhook' && typeof n.data.body === 'string' && n.data.body.trim() !== '');
}

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
 * Tira do desenho tudo que é do cliente de origem: `tagId` vira `tagName`; atendente, serviço,
 * profissional, anexo, destino do Conectar, URL e headers sensíveis do webhook (`isSensitiveHeader`)
 * saem com aviso e marca `_reconfig`. Devolve uma cópia — o original não é tocado.
 */
export function scrubFlowDefinition(def: FlowDefinition, names: SourceNames = {}): { definition: FlowDefinition; warnings: string[] } {
  const warnings: string[] = [];
  const definition = clone(def);
  const tagNameById = names.tagNameById ?? {};
  const flowNameById = names.flowNameById ?? {};

  for (const node of definition.nodes as unknown as AnyNode[]) {
    const d = node.data;

    for (const holder of tagHolders(node)) {
      if (typeof holder.tagId !== 'string') continue;
      const name = tagNameById[holder.tagId];
      delete holder.tagId;
      if (name) holder.tagName = name;
      else {
        warnings.push('Uma etiqueta não existe mais e foi removida de um bloco.');
        flagReconfig(d, 'etiqueta');
      }
    }

    if (typeof d.agentId === 'string') {
      delete d.agentId;
      warnings.push('Atribuição a um atendente específico foi removida — escolha o atendente no destino.');
      flagReconfig(d, 'atendente');
    }

    if (Array.isArray(d.agentIds) && d.agentIds.length) {
      delete d.agentIds;
      warnings.push('Os atendentes do Distribuidor foram removidos — no destino ele distribui entre todos até você escolher.');
      flagReconfig(d, 'atendentes');
    }

    if (typeof d.serviceId === 'string' || typeof d.professionalId === 'string') {
      delete d.serviceId;
      delete d.professionalId;
      warnings.push('Serviço/profissional fixos do bloco Agendar foram removidos — o fluxo vai perguntar ao contato.');
      flagReconfig(d, 'serviço/profissional');
    }

    if (typeof d.mediaKey === 'string') {
      delete d.mediaKey;
      delete d.mediaType;
      delete d.mediaName;
      warnings.push('Um anexo foi removido — reenvie o arquivo no cliente de destino.');
      flagReconfig(d, 'anexo');
    }

    // Conteúdo com várias mensagens: cada anexo carrega o tenant na chave
    if (node.type === 'message' && Array.isArray(d.items)) {
      for (const it of d.items as Record<string, unknown>[]) {
        if (typeof it.mediaKey !== 'string') continue;
        delete it.mediaKey;
        warnings.push('Um anexo foi removido — reenvie o arquivo no cliente de destino.');
        flagReconfig(d, 'anexo');
      }
    }

    // o id do fluxo de destino não existe em outro cliente; o nome fica só como referência no card
    if (node.type === 'connect_flow' && typeof d.flowId === 'string') {
      const name = flowNameById[d.flowId];
      delete d.flowId;
      if (name) d.flowName = name;
      warnings.push('O destino de "Conectar com outro fluxo" foi removido — escolha o fluxo no cliente de destino.');
      flagReconfig(d, 'fluxo de destino');
    }

    if (node.type === 'action') {
      // a URL do webhook costuma levar token na query: não sai do cliente
      if (typeof d.url === 'string' && d.url) {
        delete d.url;
        warnings.push('A URL de um webhook foi removida (pode conter token) — informe-a no destino.');
        flagReconfig(d, 'URL do webhook');
      }
      // header de credencial (Authorization, X-Api-Key, *token*, *secret*) sai inteiro; os demais ficam
      if (Array.isArray(d.headers)) {
        const headers = d.headers as { key?: string }[];
        const kept = headers.filter((h) => !isSensitiveHeader(h.key ?? ''));
        if (kept.length !== headers.length) {
          d.headers = kept;
          warnings.push('Headers de autenticação de um webhook foram removidos (Authorization, X-Api-Key, token, secret) — informe-os no destino.');
          flagReconfig(d, 'headers do webhook');
        }
      }
    }
  }

  return { definition, warnings: dedupe(warnings) };
}

/** Nomes de etiqueta citados no desenho portável — o destino precisa garantir que existam antes. */
export function flowTagNames(def: FlowDefinition): string[] {
  const names = (def.nodes as unknown as AnyNode[])
    .flatMap((n) => tagHolders(n).map((h) => h.tagName))
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return [...new Set(names)];
}

/**
 * Traz o desenho para o cliente de destino: `tagName` volta a ser `tagId`. Quem chama resolve
 * (ou cria) as etiquetas antes e passa o mapa. Etiqueta sem correspondência sai do bloco, com
 * aviso e marca `_reconfig`. Todo webhook é marcado "revisar configuração": URL, headers e
 * corpo vieram de outro lugar.
 */
export function restoreFlowDefinition(def: FlowDefinition, tagIdByName: Record<string, string>): { definition: FlowDefinition; warnings: string[] } {
  const warnings: string[] = [];
  const definition = clone(def);
  for (const node of definition.nodes as unknown as AnyNode[]) {
    if (node.type === 'action' && node.data.kind === 'webhook') flagReconfig(node.data, WEBHOOK_REVIEW_FLAG);
    for (const holder of tagHolders(node)) {
      if (typeof holder.tagName !== 'string') continue;
      const name = holder.tagName; // guardar antes de apagar: o aviso precisa dizer QUAL etiqueta
      const id = tagIdByName[name];
      delete holder.tagName;
      if (id) holder.tagId = id;
      else {
        warnings.push(`A etiqueta "${name}" não existe aqui e saiu do bloco.`);
        flagReconfig(node.data, 'etiqueta');
      }
    }
  }
  return { definition, warnings: dedupe(warnings) };
}

/**
 * Ids novos para todos os nós (inclusive o Início) e ligações, reescrevendo `{{menu_<id>}}`.
 * Usado na importação: o arquivo pode vir de um fluxo que ainda existe no mesmo cliente.
 */
export function renewFlowIds(def: FlowDefinition, newId: (type: FlowNodeType) => string): FlowDefinition {
  return cloneFlowFragment(def.nodes, def.edges, { newId, includeStart: true });
}

/** Prepara o fluxo para sair do cliente. Ver `scrubFlowDefinition` para o que não viaja. */
export function flowToPortable(
  flow: { name: string; description?: string | null; trigger: FlowTrigger; definition: FlowDefinition },
  names: SourceNames = {},
): { portable: PortableFlow; warnings: string[] } {
  const { definition, warnings } = scrubFlowDefinition(flow.definition, names);
  const trigger = clone(flow.trigger);
  if (trigger.numberIds?.length) {
    delete trigger.numberIds;
    warnings.push('O gatilho valia só para alguns números; no destino passa a valer para todos.');
  }
  return {
    portable: { atendo: 'flow', version: PORTABLE_VERSION, name: flow.name, description: flow.description ?? undefined, trigger, definition },
    warnings: dedupe(warnings),
  };
}

/** Fluxo pronto para gravar no destino: etiquetas resolvidas e ids novos. */
export function flowFromPortable(
  portable: PortableFlow,
  tagIdByName: Record<string, string>,
  newId: (type: FlowNodeType) => string,
): { name: string; description?: string; trigger: FlowTrigger; definition: FlowDefinition; warnings: string[] } {
  const { definition, warnings } = restoreFlowDefinition(portable.definition, tagIdByName);
  return { name: portable.name, description: portable.description, trigger: clone(portable.trigger), definition: renewFlowIds(definition, newId), warnings };
}

/**
 * Valida um fluxo vindo de arquivo enviado pelo usuário. Não confia em nada: o conteúdo pode ter
 * sido editado à mão entre exportar e importar.
 */
export function parsePortableFlow(raw: unknown): PortableFlow {
  const o = raw as Partial<PortableFlow> | null;
  if (!o || typeof o !== 'object') throw new Error('Arquivo inválido.');
  if (o.atendo !== 'flow') throw new Error('Este arquivo não é um fluxo do Atendo.');
  if (o.version !== PORTABLE_VERSION) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
  if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('O fluxo está sem nome.');
  const def = o.definition as FlowDefinition | undefined;
  if (!def || !Array.isArray(def.nodes) || !Array.isArray(def.edges)) throw new Error('O desenho do fluxo está corrompido.');
  if (!o.trigger || typeof o.trigger !== 'object') throw new Error('O gatilho do fluxo está corrompido.');
  return { atendo: 'flow', version: PORTABLE_VERSION, name: o.name.trim().slice(0, 80), description: typeof o.description === 'string' ? o.description.slice(0, 300) : undefined, trigger: o.trigger, definition: def };
}

/** Arquivo de fluxos: individual ou lote (até 100). */
export const parsePortableFlowFile = (raw: unknown) =>
  parsePortableFile(raw, {
    kind: 'flow',
    max: 100,
    parseItem: parsePortableFlow,
    text: { empty: 'O arquivo não tem nenhum fluxo.', tooMany: 'No máximo 100 fluxos por arquivo.', item: (n) => `Fluxo ${n} do arquivo` },
  });
