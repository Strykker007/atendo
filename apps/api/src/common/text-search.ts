/**
 * Busca textual de contatos/agenda sobre a coluna gerada `searchText` (nome, e-mail e telefone
 * sem acento e em minúsculas — ver a migração contact_search).
 *
 * - sem acento e sem diferença de maiúsculas: "joao" acha "João";
 * - por pedaços, em qualquer ordem: "silva maria" acha "Maria da Silva" (cada palavra é um AND);
 * - telefone com máscara vira só dígitos: "(62) 99999-9999" acha 5562999999999.
 *
 * O `contains` do Prisma vira `LIKE '%x%'` (curingas escapados), atendido pelo índice trigram.
 */

/** Mesma dobra da coluna gerada: minúsculas e sem acento. */
export const foldSearch = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** no máximo 5 palavras — cada uma é um LIKE a mais na query */
const MAX_TOKENS = 5;

export function searchTokens(raw: string | null | undefined): string[] {
  const term = String(raw ?? '').trim().slice(0, 100);
  if (!term) return [];
  // só cara de telefone: um token só de dígitos, senão "+55 (62)" viraria pedaços soltos
  if (/^[\d\s()+.-]+$/.test(term)) {
    const digits = term.replace(/\D/g, '');
    return digits ? [digits] : [];
  }
  return foldSearch(term)
    .split(/\s+/)
    .map((t) => (/^[\d()+.-]+$/.test(t) ? t.replace(/\D/g, '') : t))
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
}

/**
 * Filtro para espalhar no `where` de `contact`/`phonebookEntry` (ou numa relação `contact: {…}`).
 * Termo vazio = `{}`, sem filtro.
 */
export function textSearch(raw: string | null | undefined): { AND?: { searchText: { contains: string } }[] } {
  const tokens = searchTokens(raw);
  return tokens.length ? { AND: tokens.map((t) => ({ searchText: { contains: t } })) } : {};
}
