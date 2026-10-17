/**
 * Filtro estrito de grupos no webhook da Evolution (docs/grupos.md). Roda no controller,
 * ANTES da fila: evento de grupo não vira job, não toca o banco e não gera log.
 *
 * Grupo só existe para o sistema como DESTINO de transmissão, e só se o admin o autorizou
 * (`whatsapp_groups.authorized`). Mesmo autorizado ele não abre atendimento — então o que
 * chega de um grupo é descartado aqui, autorizado ou não. Descartar sem consultar a lista
 * branca é de propósito: a consulta seria um acesso ao banco por mensagem de grupo, e grupo
 * movimentado manda centenas por minuto.
 */

const isGroupJid = (jid: unknown) => typeof jid === 'string' && jid.endsWith('@g.us');

/** Eventos que só existem para grupos: nunca interessam. */
const GROUP_ONLY_EVENTS = new Set(['groups.upsert', 'groups.update', 'group-participants.update']);

/** jid do chat de um item do evento (cada evento põe num lugar) */
function chatOf(item: any): unknown {
  return item?.key?.remoteJid ?? item?.remoteJid ?? item?.id;
}

/**
 * Tira do corpo do webhook tudo o que é de grupo. Devolve `null` quando não sobra nada —
 * o controller responde 200 e não enfileira. Lote misto (grupo + conversa) segue só com as
 * conversas.
 */
export function stripGroupEvents<T>(body: T): T | null {
  const b = body as any;
  const event = typeof b?.event === 'string' ? b.event : '';
  if (GROUP_ONLY_EVENTS.has(event)) return null;
  if (!['messages.upsert', 'messages.update', 'messages.edited', 'presence.update', 'send.message'].includes(event)) return body;

  const data = b?.data;
  if (Array.isArray(data)) {
    const kept = data.filter((item) => !isGroupJid(chatOf(item)));
    if (!kept.length) return null;
    return kept.length === data.length ? body : ({ ...b, data: kept } as T);
  }
  return isGroupJid(chatOf(data)) ? null : body;
}
