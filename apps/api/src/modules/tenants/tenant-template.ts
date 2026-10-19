import { DEFAULT_LOSS_REASONS, DEFAULT_PERMISSIONS, LOSS_REASONS_MAX, SYSTEM_PROFILES, parsePortableFlowFile, type Permission, type PortableFlow } from '@atendo/shared';
import { sanitize } from '../auth/permissions';
import { parsePortableReplyFile, type PortableQuickReply } from '../quick-replies/portable';
import { MAX_CONFLICTS_PER_TAG } from '../tags/conflicts';

/**
 * Modelo de perfil (vertical): o pacote que um cliente novo recebe ao nascer. Puro (sem
 * Nest/Prisma) — validação do arquivo e a matriz de perfis que sai dele.
 *
 * Respostas e fluxos reaproveitam o formato portável que já existe (`quick-replies/portable.ts`
 * e `@atendo/shared` → `portable.ts`): o mesmo arquivo exportado de um cliente cabe no modelo, e
 * nada que só existe dentro de um cliente (ids, anexos, números) entra.
 */

export const TEMPLATE_VERSION = 1;

export interface TemplateProfile {
  name: string;
  /** Papel interno de um perfil padrão renomeado. Ausente mantém compatibilidade com modelos antigos. */
  systemRole?: 'manager' | 'agent';
  description?: string;
  permissions: Permission[];
}

/** Tag com que o cliente nasce: as mesmas opções da tela de Tags. */
export interface TemplateTag {
  name: string;
  /** `#rrggbb`; sem ela, a cor padrão de tag */
  color?: string;
  /** vira coluna do Kanban (etapa do funil) */
  isKanban?: boolean;
  /** aparece para escolha ao encerrar como "Comprou" */
  showOnWon?: boolean;
  /** aparece para escolha ao encerrar como "Não comprou" */
  showOnLost?: boolean;
  /**
   * "Conflita com": nomes de outras tags do modelo (simétrico — basta um dos lados). Marcar uma
   * tira as opostas diretas (`tags/conflicts.ts`). Tag que vira motivo de encerramento não é tag
   * no cliente, então o par com ela é ignorado ao criar.
   */
  conflictsWith?: string[];
}

/**
 * Configurações de atendimento com que o cliente nasce (as mesmas de Configurações →
 * Atendimento). Ausente = o padrão do sistema (com venda, assinatura opcional, Comprou/Não comprou).
 */
export interface TemplateSettings {
  /** encerramento com venda (valor, itens); `false` = atendimento sem venda (condomínio, suporte…) */
  salesEnabled?: boolean;
  /** assinatura do atendente obrigatória */
  requireSignature?: boolean;
  /** nome dos resultados do encerramento ("Resolvido" / "Não resolvido"…) */
  wonLabel?: string;
  lostLabel?: string;
}

/** Só o que veio no modelo, já validado — vira `tenant_settings` na criação e no Aplicar aos clientes. */
export function parseTemplateSettings(raw: unknown): TemplateSettings | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('"settings" deve ser um objeto.');
  const o = raw as Record<string, unknown>;
  const out: TemplateSettings = {};
  for (const k of ['salesEnabled', 'requireSignature'] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'boolean') throw new Error(`"settings.${k}" deve ser verdadeiro ou falso.`);
    out[k] = o[k] as boolean;
  }
  for (const k of ['wonLabel', 'lostLabel'] as const) {
    const v = str(o[k], 30);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** teto de tags num modelo */
export const TEMPLATE_TAGS_MAX = 200;

export interface TemplateContent {
  /** "Gerente" e "Atendente" ajustam os perfis padrão; outros nomes viram perfis extras. "Administrador" é sempre tudo. */
  profiles: TemplateProfile[];
  quickReplies: PortableQuickReply[];
  flows: PortableFlow[];
  /**
   * Tags com que o cliente nasce, na ordem (é a ordem das colunas do Kanban). Ausente = as do
   * formato antigo abaixo (`lossReasons`) ou, sem elas, `DEFAULT_LOSS_REASONS` como tags de
   * encerramento. Presente, as duas abaixo são ignoradas (e o editor não as grava mais).
   */
  tags?: TemplateTag[];
  /**
   * Formato antigo (só leitura):
   * tags de encerramento fora do Kanban ("Não respondeu", "Achou caro"…), do tempo
   * em que motivo de perda era lista à parte. Arquivos e modelos antigos continuam valendo:
   * viram `tags` que aparecem nos dois encerramentos (`provisionedTags`), como era antes.
   */
  lossReasons?: string[];
  /** Cor (`#rrggbb`) de cada uma dessas tags, pelo nome. Ausente = cor padrão. */
  lossReasonColors?: Record<string, string>;
  /** configurações de atendimento (encerramento com/sem venda, assinatura, nomes dos resultados) */
  settings?: TemplateSettings;
}

/** O arquivo `.json` de importar/exportar. */
export interface TemplateFile extends TemplateContent {
  atendo: 'tenant-template';
  version: number;
  name: string;
  description?: string;
}

const ADMIN_PROFILE = SYSTEM_PROFILES.find((p) => p.role === 'tenant_admin')!.name;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max).trim() : '');

export function toTemplateFile(t: { name: string; description: string | null; content: TemplateContent }): TemplateFile {
  return { atendo: 'tenant-template', version: TEMPLATE_VERSION, name: t.name, ...(t.description && { description: t.description }), ...t.content };
}

/** Valida o arquivo inteiro. Não confia em nada: pode ter sido editado à mão. Tudo ou nada. */
export function parseTemplateFile(raw: unknown): TemplateFile {
  const o = raw as Partial<TemplateFile> | null;
  if (!o || typeof o !== 'object') throw new Error('Arquivo inválido.');
  if (o.atendo !== 'tenant-template') throw new Error('Este arquivo não é um modelo de perfil.');
  if (o.version !== TEMPLATE_VERSION) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
  const name = str(o.name, 60);
  if (!name) throw new Error('O modelo está sem nome.');
  return { atendo: 'tenant-template', version: TEMPLATE_VERSION, name, ...(str(o.description, 300) && { description: str(o.description, 300) }), ...parseTemplateContent(o) };
}

/** Só o conteúdo — o que o editor do modelo salva. Mesmas regras do arquivo. */
export function parseTemplateContent(raw: unknown): TemplateContent {
  const o = raw as Partial<TemplateContent> | null;
  if (!o || typeof o !== 'object') throw new Error('Conteúdo inválido.');

  if (o.profiles !== undefined && !Array.isArray(o.profiles)) throw new Error('"profiles" deve ser uma lista.');
  const profiles: TemplateProfile[] = [];
  for (const p of (o.profiles ?? []) as Partial<TemplateProfile>[]) {
    const pname = str(p?.name, 60);
    if (!pname) throw new Error('Há um perfil sem nome.');
    // o admin da conta sempre pode tudo: um modelo que tira dele `profiles.manage` deixaria o cliente sem saída
    if (pname === ADMIN_PROFILE) continue;
    if (profiles.some((x) => x.name === pname)) throw new Error(`Perfil "${pname}" repetido.`);
    const systemRole = p.systemRole === 'manager' || p.systemRole === 'agent' ? p.systemRole : undefined;
    if (p.systemRole !== undefined && !systemRole) throw new Error('"systemRole" do perfil deve ser manager ou agent.');
    if (systemRole && profiles.some((x) => x.systemRole === systemRole)) throw new Error(`Há mais de um perfil padrão para ${systemRole}.`);
    profiles.push({ name: pname, ...(systemRole && { systemRole }), ...(str(p.description, 200) && { description: str(p.description, 200) }), permissions: sanitize(p.permissions) });
  }

  if (o.quickReplies !== undefined && !Array.isArray(o.quickReplies)) throw new Error('"quickReplies" deve ser uma lista.');
  if (o.flows !== undefined && !Array.isArray(o.flows)) throw new Error('"flows" deve ser uma lista.');
  const quickReplies = o.quickReplies?.length ? parsePortableReplyFile({ atendo: 'quick-reply-bundle', version: 1, items: o.quickReplies }) : [];
  const flows = o.flows?.length ? parsePortableFlowFile({ atendo: 'flow-bundle', version: 1, items: o.flows }) : [];

  let lossReasons: string[] | undefined;
  if (o.lossReasons !== undefined) {
    if (!Array.isArray(o.lossReasons)) throw new Error('"lossReasons" deve ser uma lista.');
    // viram tags: nome de tag tem 40 caracteres; sem vazio, sem repetido (ignorando maiúsculas)
    lossReasons = o.lossReasons.map((m) => str(m, 40)).filter((m, i, l) => m && l.findIndex((x) => x.toLowerCase() === m.toLowerCase()) === i);
    if (lossReasons.length > LOSS_REASONS_MAX) throw new Error(`No máximo ${LOSS_REASONS_MAX} tags de encerramento.`);
  }

  let lossReasonColors: Record<string, string> | undefined;
  if (o.lossReasonColors !== undefined) {
    if (!o.lossReasonColors || typeof o.lossReasonColors !== 'object' || Array.isArray(o.lossReasonColors)) throw new Error('"lossReasonColors" deve ser um objeto.');
    // só `#rrggbb`, e só de tag que está na lista (a do modelo ou, sem ela, a do catálogo) —
    // cor de tag removida não fica órfã
    const motivos = lossReasons ?? [...DEFAULT_LOSS_REASONS];
    const cores = Object.entries(o.lossReasonColors as Record<string, unknown>);
    if (cores.some(([, v]) => typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))) throw new Error('Cor de tag inválida (use #rrggbb).');
    lossReasonColors = Object.fromEntries(cores.filter(([k]) => motivos.includes(k)).map(([k, v]) => [k, (v as string).toLowerCase()]));
  }

  let tags: TemplateTag[] | undefined;
  if (o.tags !== undefined) {
    if (!Array.isArray(o.tags)) throw new Error('"tags" deve ser uma lista.');
    tags = [];
    for (const t of o.tags as Partial<TemplateTag>[]) {
      const name = str(t?.name, 40);
      // sem vazio e sem repetido (ignorando maiúsculas): o cliente não pode ter duas iguais
      if (!name || tags.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
      if (t.color !== undefined && (typeof t.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(t.color))) throw new Error(`Cor da tag "${name}" inválida (use #rrggbb).`);
      // `showOnClose` (formato de antes de separar Comprou / Não comprou) valia para os dois
      const legado = (t as { showOnClose?: unknown }).showOnClose === true;
      tags.push({ name, ...(t.color && { color: t.color.toLowerCase() }), isKanban: t.isKanban === true, showOnWon: t.showOnWon === true || legado, showOnLost: t.showOnLost === true || legado });
    }
    if (tags.length > TEMPLATE_TAGS_MAX) throw new Error(`No máximo ${TEMPLATE_TAGS_MAX} tags no modelo.`);
    tagConflicts(tags, o.tags as Partial<TemplateTag>[]);
  }

  const settings = parseTemplateSettings(o.settings);
  // com `tags`, o formato antigo sai: uma fonte só do que o cliente recebe
  if (tags) return { profiles, quickReplies, flows, tags, ...(settings && { settings }) };
  return { profiles, quickReplies, flows, ...(lossReasons && { lossReasons }), ...(lossReasonColors && Object.keys(lossReasonColors).length && { lossReasonColors }), ...(settings && { settings }) };
}

/**
 * Lê o "Conflita com" de cada tag: só nomes de tags da lista (ignorando maiúsculas; grava o nome
 * como está na lista), sem ela mesma e sem repetir. Nome que não está na lista some em silêncio
 * (como a cor de tag removida). Contando os dois lados, cada tag tem no máximo
 * `MAX_CONFLICTS_PER_TAG` opostas — o mesmo teto da tela de Tags.
 */
function tagConflicts(tags: TemplateTag[], raw: Partial<TemplateTag>[]) {
  const canon = new Map(tags.map((t) => [t.name.toLowerCase(), t.name]));
  const byName = new Map(raw.map((r) => [str(r?.name, 40)?.toLowerCase(), r]));
  const grau = new Map<string, Set<string>>();
  for (const t of tags) {
    const lista = byName.get(t.name.toLowerCase())?.conflictsWith;
    if (lista === undefined) continue;
    if (!Array.isArray(lista)) throw new Error(`"conflictsWith" da tag "${t.name}" deve ser uma lista de nomes.`);
    const nomes = [...new Set(lista.map((n) => (typeof n === 'string' ? canon.get(n.trim().toLowerCase()) : undefined)).filter((n): n is string => !!n && n !== t.name))];
    if (nomes.length) t.conflictsWith = nomes;
    for (const n of nomes) {
      grau.set(t.name, (grau.get(t.name) ?? new Set()).add(n));
      grau.set(n, (grau.get(n) ?? new Set()).add(t.name));
    }
  }
  for (const [nome, opostas] of grau) if (opostas.size > MAX_CONFLICTS_PER_TAG) throw new Error(`A tag "${nome}" conflita com mais de ${MAX_CONFLICTS_PER_TAG} tags.`);
}

/** Pares "conflita com" do modelo (um por par, nomes em minúsculas para casar com o cliente). */
export function templateTagConflictPairs(tags: TemplateTag[]): [string, string][] {
  const vistos = new Set<string>();
  const out: [string, string][] = [];
  for (const t of tags) for (const o of t.conflictsWith ?? []) {
    const [a, b] = [t.name.toLowerCase(), o.toLowerCase()].sort();
    if (a === b || vistos.has(`${a}\u0000${b}`)) continue;
    vistos.add(`${a}\u0000${b}`);
    out.push([a, b]);
  }
  return out;
}

export const templateContent = (f: TemplateFile): TemplateContent => ({ profiles: f.profiles, quickReplies: f.quickReplies, flows: f.flows, ...(f.tags ? { tags: f.tags } : { ...(f.lossReasons && { lossReasons: f.lossReasons }), ...(f.lossReasonColors && { lossReasonColors: f.lossReasonColors }) }), ...(f.settings && { settings: f.settings }) });

/**
 * Tags com que o cliente nasce, na ordem: as do modelo; em modelo antigo, a lista de motivos
 * (ou a do catálogo) como tags de encerramento fora do Kanban, com as cores que tinham.
 */
export function provisionedTags(c: TemplateContent | null): TemplateTag[] {
  if (c?.tags) return c.tags;
  const cores = provisionedLossReasonColors(c);
  return provisionedLossReasons(c).map((name) => ({ name, ...(cores[name] && { color: cores[name] }), isKanban: false, showOnWon: true, showOnLost: true }));
}

/** Tags de encerramento com que o cliente nasce. */
export const provisionedLossReasons = (c: TemplateContent | null) => c?.lossReasons ?? [...DEFAULT_LOSS_REASONS];

/** Cores dessas tags — só as de tags que ele recebe. */
export const provisionedLossReasonColors = (c: TemplateContent | null) => {
  const motivos = provisionedLossReasons(c);
  return Object.fromEntries(Object.entries(c?.lossReasonColors ?? {}).filter(([k]) => motivos.includes(k)));
};

/**
 * Perfis que o cliente novo recebe: os três padrão sempre (Administrador com tudo; Gerente e
 * Atendente com a matriz do modelo, se ele trouxer) + os extras do modelo.
 *
 * Padrão que veio do modelo nasce `customized`: senão o alinhamento ao catálogo
 * (`ensureSystemProfiles`) desfaria a matriz no primeiro acesso à tela de perfis.
 */
export function provisionedProfiles(content: TemplateContent | null): { name: string; description: string; permissions: Permission[]; isSystem: boolean; customized: boolean; role?: 'tenant_admin' | 'manager' | 'agent' }[] {
  const fromTemplate = new Map((content?.profiles ?? []).map((p) => [p.name, p]));
  const system = SYSTEM_PROFILES.map(({ name, role }) => {
    const t = role === 'tenant_admin' ? undefined : (content?.profiles ?? []).find((p) => p.systemRole === role) ?? fromTemplate.get(name);
    return { name: t?.name ?? name, role, description: t?.description ?? `Perfil padrão de ${(t?.name ?? name).toLowerCase()}`, permissions: t ? t.permissions : [...DEFAULT_PERMISSIONS[role]], isSystem: true, customized: !!t };
  });
  const extra = (content?.profiles ?? [])
    .filter((p) => !p.systemRole && !SYSTEM_PROFILES.some((s) => s.name === p.name))
    .map((p) => ({ name: p.name, description: p.description ?? '', permissions: p.permissions, isSystem: false, customized: false }));
  return [...system, ...extra];
}

/** Resumo para a listagem do Super Admin. */
export const templateSummary = (c: TemplateContent) => ({ profiles: c.profiles.length, quickReplies: c.quickReplies.length, flows: c.flows.length, tags: provisionedTags(c).length });
