/**
 * Acesso padrão do perfil (docs/18-perfis-de-acesso.md#acesso-padrão-do-perfil): o que a tela de
 * Acesso define pessoa por pessoa, guardado no perfil para cadastrar equipe em massa. É **cópia**:
 * aplicado, vira o acesso da pessoa, que pode ser ajustado depois sem mexer no perfil.
 */
export interface AccessTemplate {
  /** vê todos os números (menos os reservados); senão, só `numberIds` */
  allNumbers: boolean;
  numberIds: string[];
  /** onde a tela de conversas abre filtrada */
  defaultNumberIds: string[];
  departmentIds: string[];
  /** recebe automaticamente de todos os números que vê; senão, só de `receiveNumberIds` */
  receiveAll: boolean;
  receiveNumberIds: string[];
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []);

/** Lê o JSON do banco/corpo; inválido ou ausente = null (perfil sem padrão). */
export function parseAccessTemplate(v: unknown): AccessTemplate | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    allNumbers: o.allNumbers !== false,
    numberIds: ids(o.numberIds),
    defaultNumberIds: ids(o.defaultNumberIds),
    departmentIds: ids(o.departmentIds),
    receiveAll: o.receiveAll !== false,
    receiveNumberIds: ids(o.receiveNumberIds),
  };
}

/**
 * Recorta o modelo ao que existe no cliente (ids vêm do corpo ou ficaram velhos: número excluído,
 * departamento apagado) e mantém a coerência: abre filtrado e recebe só em número que vê.
 */
export function sanitizeAccessTemplate(t: AccessTemplate, numbers: readonly string[], departments: readonly string[]): AccessTemplate {
  const temNum = new Set(numbers);
  const numberIds = t.numberIds.filter((id) => temNum.has(id));
  const ve = (id: string) => temNum.has(id) && (t.allNumbers || numberIds.includes(id));
  const temDep = new Set(departments);
  return {
    allNumbers: t.allNumbers,
    numberIds: t.allNumbers ? [] : numberIds,
    defaultNumberIds: t.defaultNumberIds.filter(ve),
    departmentIds: t.departmentIds.filter((id) => temDep.has(id)),
    receiveAll: t.receiveAll,
    receiveNumberIds: t.receiveAll ? [] : t.receiveNumberIds.filter(ve),
  };
}
