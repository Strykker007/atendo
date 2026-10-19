import { Prisma, type SupportTicket } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Fila do canal de suporte (docs/chat-interno.md#fila-de-suporte). O canal é um só por cliente e
 * nunca some; o **ticket** é cada atendimento dentro dele:
 *
 *   cliente escreve, sem ticket ativo  → abre (`open`, entra na fila)
 *   suporte responde ou assume         → `in_progress`, com responsável
 *   suporte encerra                    → `resolved`, sai da fila; a próxima mensagem abre outro
 *
 * No máximo um ticket ativo por canal (índice único parcial na migração): duas mensagens
 * simultâneas do cliente não abrem dois.
 */
export const ACTIVE_TICKET: Prisma.SupportTicketWhereInput = { status: { in: ['open', 'in_progress'] } };

export const TICKET_SELECT = {
  id: true, number: true, status: true, assigneeId: true, assigneeName: true, openedAt: true, firstResponseAt: true, resolvedAt: true, resolvedByName: true,
} as const;
export type PresentedTicket = Pick<SupportTicket, keyof typeof TICKET_SELECT>;

export function activeTicket(prisma: PrismaService, chatId: string) {
  return prisma.supportTicket.findFirst({ where: { chatId, ...ACTIVE_TICKET }, select: { ...TICKET_SELECT, tenantId: true, chatId: true } });
}

/** Já existe um ativo (outra mensagem abriu no mesmo instante): não é erro. */
const conflito = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Atualiza o ticket depois de uma mensagem no canal. Devolve `true` quando a fila mudou (abriu,
 * assumiu, primeira resposta) — quem chama avisa as telas.
 */
export async function ticketOnMessage(
  prisma: PrismaService,
  chat: { id: string; tenantId: string },
  author: { id: string; name: string },
  fromSupport: boolean,
  at: Date,
): Promise<boolean> {
  const t = await activeTicket(prisma, chat.id);
  if (!fromSupport) {
    if (t) return false;
    return prisma.supportTicket.create({ data: { tenantId: chat.tenantId, chatId: chat.id, openedAt: at } }).then(() => true, (err) => { if (conflito(err)) return false; throw err; });
  }
  // suporte puxando conversa sem ticket: já nasce com ele
  if (!t) {
    return prisma.supportTicket
      .create({ data: { tenantId: chat.tenantId, chatId: chat.id, status: 'in_progress', assigneeId: author.id, assigneeName: author.name, openedAt: at, firstResponseAt: at } })
      .then(() => true, (err) => { if (conflito(err)) return false; throw err; });
  }
  const data: Prisma.SupportTicketUpdateInput = {};
  if (!t.firstResponseAt) data.firstResponseAt = at;
  // responder assume o atendimento que estava na fila
  if (t.status === 'open') Object.assign(data, { status: 'in_progress', assigneeId: author.id, assigneeName: author.name });
  if (!Object.keys(data).length) return false;
  await prisma.supportTicket.update({ where: { id: t.id }, data });
  return true;
}

/** Posição na fila (1 = o próximo a ser atendido) — o cliente vê "você é o 3º da fila". */
export async function queuePosition(prisma: PrismaService, t: { status: string; openedAt: Date }) {
  if (t.status !== 'open') return null;
  return 1 + (await prisma.supportTicket.count({ where: { status: 'open', openedAt: { lt: t.openedAt } } }));
}
