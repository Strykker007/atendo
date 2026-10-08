/**
 * O WhatsApp derrubou a sessão do "aparelho conectado" (Evolution: `401 device_removed`).
 *
 * Acontece quando o WhatsApp desconfia do uso (conexão via QR, denúncias, conteúdo) ou
 * quando alguém remove o aparelho em "Aparelhos conectados" no celular. Reconectar logo em
 * seguida é o que costuma transformar a queda em restrição da conta — caso real: Drogaria
 * Total, duas quedas em 17h com reconexão em 2 min, e o número terminou restrito.
 *
 * Então a queda abre uma pausa de reconexão: 2h na primeira; 24h se cair de novo dentro de 24h.
 * Não é bloqueio duro — o cliente pode reconectar confirmando que entendeu o risco.
 */
const HORA = 3_600_000;
/** janela em que uma nova queda conta como repetição */
export const REMOVAL_STREAK_MS = 24 * HORA;
const PAUSA_PRIMEIRA_MS = 2 * HORA;
const PAUSA_REPETIDA_MS = 24 * HORA;

/** Nova contagem e fim da pausa depois de uma queda em `now`. Puro (testável). */
export function planRemoval(prev: { waRemovedAt: Date | null; waRemovedCount: number }, now: Date) {
  const seguida = !!prev.waRemovedAt && now.getTime() - prev.waRemovedAt.getTime() < REMOVAL_STREAK_MS;
  const count = seguida ? prev.waRemovedCount + 1 : 1;
  return { waRemovedAt: now, waRemovedCount: count, reconnectBlockedUntil: new Date(now.getTime() + (count > 1 ? PAUSA_REPETIDA_MS : PAUSA_PRIMEIRA_MS)) };
}
