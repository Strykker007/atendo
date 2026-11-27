import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Número de envio da conversa (docs/troca-de-numero.md). Só API oficial.
 *
 * A conversa continua sendo UMA (`numberId` = o número em que ela nasceu, base do escopo, das
 * listas e da distribuição). `channelNumberId` diz por onde ela envia agora; cada mensagem guarda
 * o número por onde passou (`Message.numberId`), e é por ele que o worker envia.
 *
 * Conversa que nunca trocou (`channelChangedAt` nulo) segue exatamente a regra antiga: canal =
 * `numberId`, janela = `lastInboundAt`.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type ChannelFields = {
  id: string;
  contactId: string;
  numberId: string;
  channelNumberId: string | null;
  channelChangedAt: Date | null;
  channelLastInboundAt: Date | null;
  lastInboundAt: Date | null;
};

/** Por onde a conversa envia agora. */
export const channelIdOf = (c: Pick<ChannelFields, 'numberId' | 'channelNumberId'>) => c.channelNumberId ?? c.numberId;

/**
 * Última mensagem do contato por `numberId`, para a janela de 24h da Meta (que é por número).
 * Soma esta conversa (mensagens que entraram por aquele número) e a conversa própria do contato
 * naquele número, se existir — ele pode ter escrito lá antes da troca.
 */
export async function lastInboundOn(db: Db, c: ChannelFields, numberId: string): Promise<Date | null> {
  // regra antiga, intacta: conversa que nunca trocou responde pelo próprio número
  if (!c.channelChangedAt && numberId === c.numberId) return c.lastInboundAt;
  if (c.channelChangedAt && numberId === channelIdOf(c)) return c.channelLastInboundAt;
  const [aqui, outra] = await Promise.all([
    db.message.findFirst({ where: { conversationId: c.id, numberId, direction: 'in', internal: false, type: { not: 'call' } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.conversation.aggregate({ where: { contactId: c.contactId, numberId, id: { not: c.id } }, _max: { lastInboundAt: true } }),
  ]);
  const datas = [aqui?.createdAt, outra._max.lastInboundAt].filter((d): d is Date => !!d);
  return datas.length ? new Date(Math.max(...datas.map((d) => d.getTime()))) : null;
}

/**
 * A conversa do contato que usa este número como canal: a que envia por ele agora e, depois, a
 * que já enviou (a mais recente). `null` = nenhuma — quem chamou segue com a conversa do próprio
 * número, como sempre. Só número oficial tem canal; QR Code nem consulta.
 */
export async function channelConversation(db: Db, number: { id: string; provider: string }, contactId: string, where: Prisma.ConversationWhereInput = {}) {
  if (number.provider !== 'meta') return null;
  return (await db.conversation.findFirst({ where: { ...where, contactId, channelNumberId: number.id } }))
    ?? (await db.conversation.findFirst({ where: { ...where, contactId, channelHistory: { has: number.id } }, orderBy: { lastMessageAt: 'desc' } }));
}
