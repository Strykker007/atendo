import { DEFAULT_LOSS_REASONS, DEFAULT_PERMISSIONS, LOSS_REASONS_MAX, SYSTEM_PROFILES, parsePortableFlowFile, type Permission, type PortableFlow } from '@atendo/shared';
import { sanitize } from '../auth/permissions';
import { parsePortableReplyFile, type PortableQuickReply } from '../quick-replies/portable';

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
  description?: string;
  permissions: Permission[];
}

export interface TemplateContent {
  /** "Gerente" e "Atendente" ajustam os perfis padrão; outros nomes viram perfis extras. "Administrador" é sempre tudo. */
  profiles: TemplateProfile[];
  quickReplies: PortableQuickReply[];
  flows: PortableFlow[];
  /** Motivos de não compra ("Não comprou"). Ausente = `DEFAULT_LOSS_REASONS` do catálogo. */
  lossReasons?: string[];
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
    profiles.push({ name: pname, ...(str(p.description, 200) && { description: str(p.description, 200) }), permissions: sanitize(p.permissions) });
  }

  if (o.quickReplies !== undefined && !Array.isArray(o.quickReplies)) throw new Error('"quickReplies" deve ser uma lista.');
  if (o.flows !== undefined && !Array.isArray(o.flows)) throw new Error('"flows" deve ser uma lista.');
  const quickReplies = o.quickReplies?.length ? parsePortableReplyFile({ atendo: 'quick-reply-bundle', version: 1, items: o.quickReplies }) : [];
  const flows = o.flows?.length ? parsePortableFlowFile({ atendo: 'flow-bundle', version: 1, items: o.flows }) : [];

  let lossReasons: string[] | undefined;
  if (o.lossReasons !== undefined) {
    if (!Array.isArray(o.lossReasons)) throw new Error('"lossReasons" deve ser uma lista.');
    // mesma limpeza da Configuração do cliente: sem vazio, sem repetido (ignorando maiúsculas)
    lossReasons = o.lossReasons.map((m) => str(m, 200)).filter((m, i, l) => m && l.findIndex((x) => x.toLowerCase() === m.toLowerCase()) === i);
    if (lossReasons.length > LOSS_REASONS_MAX) throw new Error(`No máximo ${LOSS_REASONS_MAX} motivos de não compra.`);
  }

  return { profiles, quickReplies, flows, ...(lossReasons && { lossReasons }) };
}

export const templateContent = (f: TemplateFile): TemplateContent => ({ profiles: f.profiles, quickReplies: f.quickReplies, flows: f.flows, ...(f.lossReasons && { lossReasons: f.lossReasons }) });

/** Motivos de não compra com que o cliente nasce. */
export const provisionedLossReasons = (c: TemplateContent | null) => c?.lossReasons ?? [...DEFAULT_LOSS_REASONS];

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
    const t = role === 'tenant_admin' ? undefined : fromTemplate.get(name);
    return { name, role, description: t?.description ?? `Perfil padrão de ${name.toLowerCase()}`, permissions: t ? t.permissions : [...DEFAULT_PERMISSIONS[role]], isSystem: true, customized: !!t };
  });
  const extra = (content?.profiles ?? [])
    .filter((p) => !SYSTEM_PROFILES.some((s) => s.name === p.name))
    .map((p) => ({ name: p.name, description: p.description ?? '', permissions: p.permissions, isSystem: false, customized: false }));
  return [...system, ...extra];
}

/** Resumo para a listagem do Super Admin. */
export const templateSummary = (c: TemplateContent) => ({ profiles: c.profiles.length, quickReplies: c.quickReplies.length, flows: c.flows.length, lossReasons: c.lossReasons?.length ?? null });
