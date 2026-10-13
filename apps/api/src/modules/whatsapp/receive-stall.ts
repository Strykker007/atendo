import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Número que envia mas parou de receber (docs/04-providers-whatsapp.md#parou-de-receber).
 *
 * Na Conexão Web as chaves de decifrar o que chega podem corromper sem derrubar a sessão: o
 * envio segue, a tela mostra "Conectado", e a Evolution descarta em silêncio cada mensagem
 * recebida ("Message ignored with messageStubParameters") — junto vão as confirmações de entrega.
 * Nenhum evento avisa; o único rastro é a falta deles. Caso real: Drog. Kelly I, 12/10/2026,
 * um dia inteiro sem receber antes de alguém perceber.
 *
 * Regra: depois do último sinal de vida do número (mensagem recebida ou confirmação de entrega/
 * leitura), saíram pelo menos `MIN_SENT` mensagens para `MIN_CONVERSATIONS` contatos diferentes
 * e nenhuma foi confirmada. Um contato com o celular desligado não basta — exige dois.
 */
export const MIN_SENT = 3;
export const MIN_CONVERSATIONS = 2;
/** tempo para a confirmação chegar antes de contar a mensagem como sem resposta */
export const ACK_GRACE_MS = 15 * 60_000;
/** até onde olhar para trás: número parado há mais tempo que isso já deveria ter sido notado */
const LOOKBACK = '3 days';

export const isReceiveStalled = (s: { unacked: number; conversations: number }) => s.unacked >= MIN_SENT && s.conversations >= MIN_CONVERSATIONS;

/** Mensagens enviadas sem confirmação desde o último sinal de vida (e desde o QR lido). */
export async function unackedSinceLastSignal(prisma: PrismaService, numberId: string, sessionStartedAt: Date | null) {
  const since = sessionStartedAt ?? new Date(0);
  const graceEnd = new Date(Date.now() - ACK_GRACE_MS);
  const [row] = await prisma.$queryRaw<{ unacked: bigint; conversations: bigint }[]>(Prisma.sql`
    WITH base AS (
      SELECT m.direction, m.status, m."createdAt", m."conversationId"
      FROM messages m JOIN conversations c ON c.id = m."conversationId"
      WHERE c."numberId" = ${numberId} AND m."createdAt" > now() - ${LOOKBACK}::interval AND m."createdAt" > ${since}
    ), sinal AS (
      SELECT max("createdAt") AS t FROM base WHERE direction = 'in' OR status IN ('delivered', 'read')
    )
    SELECT count(*) AS unacked, count(DISTINCT "conversationId") AS conversations
    FROM base, sinal
    WHERE direction = 'out' AND status = 'sent' AND "createdAt" > coalesce(sinal.t, 'epoch'::timestamp) AND "createdAt" < ${graceEnd}
  `);
  return { unacked: Number(row?.unacked ?? 0), conversations: Number(row?.conversations ?? 0) };
}
