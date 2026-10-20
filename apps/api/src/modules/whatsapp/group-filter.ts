/**
 * Filtro estrito de grupos no webhook da Evolution (docs/grupos.md). Roda no controller,
 * ANTES da fila: evento de grupo não vira job, não toca o banco e não gera log.
 *
 * Grupo existe para o sistema como DESTINO de transmissão (`whatsapp_groups.authorized`) e,
 * só se o admin marcar "Mostrar nas conversas" (`inbox`, recurso `groups_inbox`), como chat
 * livre no painel. Todo o resto que chega de grupo — inclusive de grupo autorizado para
 * transmissão — é descartado aqui. A lista dos liberados vem de memória (`GroupInboxRegistry`):
 * consultar o banco por mensagem de grupo seria o custo que este filtro existe para evitar.
 */

const isGroupJid = (jid: unknown) => typeof jid === 'string' && jid.endsWith('@g.us');

/** Eventos que só existem para grupos: nunca interessam. */
const GROUP_ONLY_EVENTS = new Set(['groups.upsert', 'groups.update', 'group-participants.update']);

/** jid do chat de um item do evento (cada evento põe num lugar) */
function chatOf(item: any): unknown {
  return item?.key?.remoteJid ?? item?.remoteJid ?? item?.id;
}

/** Eventos em que um grupo liberado interessa: a mensagem, o recibo dela e a edição. Presença nunca. */
const INBOX_EVENTS = new Set(['messages.upsert', 'messages.update', 'messages.edited', 'send.message']);
const FILTERED_EVENTS = new Set([...INBOX_EVENTS, 'presence.update']);

/** O corpo traz algo de grupo? Só então o controller busca a lista dos liberados. */
export function hasGroupEvent(body: unknown): boolean {
  const b = body as any;
  const event = typeof b?.event === 'string' ? b.event : '';
  if (GROUP_ONLY_EVENTS.has(event)) return true;
  if (!FILTERED_EVENTS.has(event)) return false;
  const data = b?.data;
  return Array.isArray(data) ? data.some((item) => isGroupJid(chatOf(item))) : isGroupJid(chatOf(data));
}

/**
 * Tira do corpo do webhook tudo o que é de grupo, menos os grupos de `inbox` (liberados para
 * as conversas). Devolve `null` quando não sobra nada — o controller responde 200 e não
 * enfileira. Lote misto (grupo + conversa) segue só com o que passou.
 */
export function stripGroupEvents<T>(body: T, inbox: ReadonlySet<string> = new Set()): T | null {
  const b = body as any;
  const event = typeof b?.event === 'string' ? b.event : '';
  if (GROUP_ONLY_EVENTS.has(event)) return null;
  if (!FILTERED_EVENTS.has(event)) return body;

  const liberado = INBOX_EVENTS.has(event) && inbox.size > 0;
  const fica = (item: unknown) => {
    const jid = chatOf(item);
    return !isGroupJid(jid) || (liberado && inbox.has(jid as string));
  };
  const data = b?.data;
  if (Array.isArray(data)) {
    const kept = data.filter(fica);
    if (!kept.length) return null;
    return kept.length === data.length ? body : ({ ...b, data: kept } as T);
  }
  return fica(data) ? body : null;
}
