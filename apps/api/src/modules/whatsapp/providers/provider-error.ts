/**
 * Erro de provider em texto legível. Meta e Evolution devolvem o motivo em formatos
 * diferentes (string, array de strings, objeto aninhado) — sem isto, um erro estruturado
 * virava "[object Object]" no chat e no log, que não ajuda ninguém a resolver nada.
 */
export function describeProviderError(raw: unknown, fallback: string): string {
  const text = flatten(raw);
  return text || fallback;
}

function flatten(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth > 3) return '';
  if (Array.isArray(value)) return value.map((v) => flatten(v, depth + 1)).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    // campos que os providers usam para o texto do erro, do mais específico ao mais genérico
    for (const k of ['message', 'error', 'description', 'detail', 'reason', 'title']) {
      if (k in o) {
        const t = flatten(o[k], depth + 1);
        if (t) return t;
      }
    }
    // último recurso: o JSON, que ao menos é diagnosticável
    try {
      const json = JSON.stringify(o);
      return json === '{}' ? '' : json.slice(0, 300);
    } catch {
      return '';
    }
  }
  return '';
}
