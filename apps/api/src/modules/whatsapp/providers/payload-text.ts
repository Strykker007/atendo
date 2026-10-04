/**
 * Leitura defensiva de payload bruto, usada pelos dois providers.
 *
 * Existe porque o WhatsApp inventa tipo de mensagem mais rápido do que a gente mapeia: antes,
 * tudo que não era texto/mídia virava `unknown` e o atendente via uma bolha vazia — inclusive
 * em mensagem de banco com código de verificação, que é texto puro dentro de um template.
 */

/** Campos que costumam carregar o texto visível, em ordem de preferência. */
const CAMPOS_DE_TEXTO = [
  'conversation',
  'text',
  'caption',
  'hydratedContentText',
  'contentText',
  'body',
  'selectedDisplayText',
  'displayText',
  'title',
  'description',
  'name',
];

/** Galhos que nunca são o conteúdo: citação, metadados, miniaturas, erros do provider. */
const IGNORAR = new Set(['contextInfo', 'messageContextInfo', 'jpegThumbnail', 'thumbnail', 'errors', 'referral', 'context', 'key']);

/**
 * Primeiro texto não vazio do payload, procurando em profundidade (limitada). Último recurso
 * antes de `unknown`: mostrar *algum* texto é sempre melhor que uma bolha muda.
 */
export function textoQualquer(no: unknown, profundidade = 5): string | undefined {
  if (!no || typeof no !== 'object' || profundidade < 0) return undefined;
  const obj = no as Record<string, unknown>;
  for (const campo of CAMPOS_DE_TEXTO) {
    const v = obj[campo];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const [chave, v] of Object.entries(obj)) {
    if (IGNORAR.has(chave) || !v || typeof v !== 'object') continue;
    const achado = textoQualquer(v, profundidade - 1);
    if (achado) return achado;
  }
  return undefined;
}

/**
 * vCard → nome + telefones. O WhatsApp põe o número "de verdade" no parâmetro `waid` da linha
 * TEL; o valor depois dos dois-pontos é só como o celular formatou.
 */
export function lerVcard(vcard: unknown, nomeExibido?: string): { name: string; phones: string[] } {
  const texto = typeof vcard === 'string' ? vcard : '';
  const linhas = texto.split(/\r?\n/);
  const fn = linhas.find((l) => /^FN[;:]/i.test(l))?.replace(/^FN[^:]*:/i, '').trim();
  const phones = linhas
    .filter((l) => /^(item\d+\.)?TEL/i.test(l))
    .map((l) => /waid=(\d+)/i.exec(l)?.[1] ?? l.replace(/^[^:]*:/, '').trim())
    .filter(Boolean);
  return { name: nomeExibido?.trim() || fn || phones[0] || 'Contato', phones: [...new Set(phones)] };
}

/** JSON embutido em string (nativeFlow manda os parâmetros assim). Inválido = objeto vazio. */
export function jsonSeguro(s: unknown): Record<string, any> {
  if (typeof s !== 'string') return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
