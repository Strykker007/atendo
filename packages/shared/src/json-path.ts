/**
 * Caminhos simples em JSON para o bloco "API externa": `cliente.nome`, `itens[0].preco`,
 * `itens.0.preco`, `$.total`, `["chave com espaço"]`. Sem filtros nem curingas — de propósito:
 * é para quem não programa ler o que a API devolveu.
 */
import { HTTP_VAR_MAX } from './flows.js';

/** Quebra o caminho em chaves; `null` = caminho mal escrito. */
export function parseJsonPath(path: string): (string | number)[] | null {
  let s = path.trim();
  if (s === '$' || s === '') return [];
  if (s.startsWith('$')) s = s.slice(1);
  const out: (string | number)[] = [];
  const re = /^(?:\.?([^.[\]]+)|\[(\d+)\]|\[\s*"([^"]*)"\s*\]|\[\s*'([^']*)'\s*\])/;
  while (s.length) {
    const m = re.exec(s);
    if (!m) return null;
    if (m[1] !== undefined) out.push(/^\d+$/.test(m[1]) ? Number(m[1]) : m[1]);
    else if (m[2] !== undefined) out.push(Number(m[2]));
    else out.push(m[3] ?? m[4] ?? '');
    s = s.slice(m[0].length);
  }
  return out;
}

/** Valor no caminho; `undefined` = não existe. */
export function readJsonPath(data: unknown, path: string): unknown {
  const keys = parseJsonPath(path);
  if (!keys) return undefined;
  let cur: unknown = data;
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      if (typeof k !== 'number') return undefined;
      cur = cur[k];
    } else {
      // chave própria só: nada de `__proto__`/`constructor` herdados
      const key = String(k);
      if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

/** Valor como texto de variável: texto/número/sim-não como estão; objeto e lista viram JSON; vazio = ''. */
export function jsonValueText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.slice(0, HTTP_VAR_MAX);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v).slice(0, HTTP_VAR_MAX); } catch { return ''; }
}

/** Nome de variável sugerido a partir do caminho: `cliente.endereco.cidade` → `cidade`, `itens[0].preco` → `preco`. */
export function suggestVarName(path: string): string {
  const keys = parseJsonPath(path) ?? [];
  const last = [...keys].reverse().find((k) => typeof k === 'string') as string | undefined;
  const base = (last ?? 'api').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return (/^\d/.test(base) ? `api_${base}` : base || 'api').slice(0, 40);
}

/**
 * Lista os caminhos da resposta para a tela escolher (folhas e listas), com uma prévia do valor.
 * Corta em `max` e não desce mais que `depth` níveis; em lista, mostra só o primeiro item.
 */
export function listJsonPaths(data: unknown, max = 150, depth = 6): { path: string; preview: string; kind: 'text' | 'number' | 'boolean' | 'null' | 'list' | 'object' }[] {
  const out: { path: string; preview: string; kind: 'text' | 'number' | 'boolean' | 'null' | 'list' | 'object' }[] = [];
  const keyPart = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `["${k.replace(/"/g, '')}"]`);
  const walk = (v: unknown, path: string, d: number) => {
    if (out.length >= max) return;
    if (Array.isArray(v)) {
      if (path) out.push({ path, preview: `lista com ${v.length} ${v.length === 1 ? 'item' : 'itens'}`, kind: 'list' });
      if (v.length && d < depth) walk(v[0], `${path}[0]`, d + 1);
      return;
    }
    if (v !== null && typeof v === 'object') {
      if (path && d >= depth) { out.push({ path, preview: jsonValueText(v).slice(0, 60), kind: 'object' }); return; }
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}${keyPart(k)}`, d + 1);
      return;
    }
    const kind = v === null ? 'null' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'text';
    out.push({ path: path || '$', preview: jsonValueText(v).slice(0, 60), kind });
  };
  walk(data, '', 0);
  // sem o ponto inicial: `cliente.nome`, não `.cliente.nome`
  return out.map((p) => ({ ...p, path: p.path.startsWith('.') ? p.path.slice(1) : p.path }));
}
