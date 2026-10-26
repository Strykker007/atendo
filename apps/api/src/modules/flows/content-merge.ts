import type { ContentItem } from '@atendo/shared';

/** Intervalo (s) até o qual dois textos seguidos são "a mesma fala" e podem sair numa mensagem só. */
export const MERGE_MAX_GAP_SEC = 3;

/**
 * Quantos itens, a partir de `i`, saem juntos numa mensagem só (1 = só ele). Só textos seguidos,
 * cada um com intervalo de até `MERGE_MAX_GAP_SEC` — mídia, texto vazio ou pausa maior cortam a
 * sequência. Usado com o número em aquecimento (docs/envio.md#aquecimento): "Boa noite!" + "Em
 * instantes…" a 2 s um do outro contavam duas no teto de automáticas/h; juntas, o cliente lê o
 * mesmo, na mesma ordem, e o número manda metade.
 */
export function quickTextRun(items: ContentItem[], i: number, maxGapSec = MERGE_MAX_GAP_SEC): number {
  const isText = (it: ContentItem | undefined) => !!it && it.kind === 'text' && !!it.text?.trim();
  if (!isText(items[i])) return 1;
  let n = 1;
  while (isText(items[i + n]) && (Number(items[i + n].delay) || 0) <= maxGapSec) n++;
  return n;
}

/** O item que representa os `n` textos a partir de `i` (parágrafos separados por linha em branco). */
export function mergedItem(items: ContentItem[], i: number, n: number): ContentItem {
  if (n <= 1) return items[i];
  return { ...items[i], text: items.slice(i, i + n).map((it) => it.text!.trim()).join('\n\n') };
}
