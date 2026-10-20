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

/**
 * Segunda regra, para número com pouco envio: SILÊNCIO anormal. A primeira depende de mensagens
 * sem confirmação — mas se nada chega, quase ninguém responde, e ela demora horas para juntar
 * as 3 (Drog. Kelly I, 17/10/2026: parou às 11:12, só marcaria às 13:51). Aqui: nenhum sinal de
 * vida há `SILENCE_MS` num horário em que, no MESMO dia da semana passada, o número recebeu
 * pelo menos `SILENCE_MIN_EXPECTED` mensagens. Mesmo dia da semana: noite, domingo e loja
 * fechada não viram alarme. Só vale com pelo menos UMA enviada sem confirmação depois do último
 * sinal (health.scheduler.ts): silêncio sozinho (loja parada, feriado) não acende o aviso.
 * Marcado, só desmarca com sinal de vida depois da marcação — mensagem recebida ou entrega
 * confirmada desmarca na hora (`InboundService.voltouAReceber`).
 */
export const SILENCE_MS = 60 * 60_000;
export const SILENCE_MIN_EXPECTED = 5;

export const isSilentTooLong = (s: { silentMs: number | null; expected: number }) =>
  s.silentMs !== null && s.silentMs >= SILENCE_MS && s.expected >= SILENCE_MIN_EXPECTED;

/** Há quanto tempo o número não dá sinal (null = sem sinal recente) e quanto recebeu na mesma hora 7 dias atrás. */
export async function silenceVsLastWeek(prisma: PrismaService, numberId: string, sessionStartedAt: Date | null) {
  const since = sessionStartedAt ?? new Date(0);
  const semanaPassada = Date.now() - 7 * 86_400_000;
  const [de, ate] = [new Date(semanaPassada - SILENCE_MS), new Date(semanaPassada)];
  const [row] = await prisma.$queryRaw<{ last: Date | null; expected: bigint }[]>(Prisma.sql`
    SELECT
      (SELECT max("createdAt") FROM messages
        WHERE "numberId" = ${numberId} AND NOT internal AND "createdAt" > now() - ${LOOKBACK}::interval AND "createdAt" > ${since}
          AND (direction = 'in' OR status IN ('delivered', 'read'))) AS last,
      (SELECT count(*) FROM messages
        WHERE "numberId" = ${numberId} AND direction = 'in'
          AND "createdAt" > ${de} AND "createdAt" <= ${ate}) AS expected
  `);
  // sessão nova sem sinal ainda: a regra de cima cobre; aqui só com um último sinal conhecido
  const silentMs = row?.last ? Date.now() - new Date(row.last).getTime() : null;
  return { silentMs, expected: Number(row?.expected ?? 0) };
}

/** Mensagens enviadas sem confirmação desde o último sinal de vida (e desde o QR lido). */
export async function unackedSinceLastSignal(prisma: PrismaService, numberId: string, sessionStartedAt: Date | null) {
  const since = sessionStartedAt ?? new Date(0);
  const graceEnd = new Date(Date.now() - ACK_GRACE_MS);
  const [row] = await prisma.$queryRaw<{ unacked: bigint; conversations: bigint }[]>(Prisma.sql`
    WITH base AS (
      SELECT m.direction, m.status, m."createdAt", m."conversationId"
      FROM messages m JOIN conversations c ON c.id = m."conversationId"
      -- nota interna nasce 'delivered' e nunca vai ao WhatsApp: contá-la como sinal de vida zerava a
      -- detecção (Drogaria Marttins, 19/10/2026: uma nota às 15:22 escondeu o número parado desde 11:57)
      WHERE c."numberId" = ${numberId} AND NOT m.internal AND m."createdAt" > now() - ${LOOKBACK}::interval AND m."createdAt" > ${since}
    ), sinal AS (
      SELECT max("createdAt") AS t FROM base WHERE direction = 'in' OR status IN ('delivered', 'read')
    )
    SELECT count(*) AS unacked, count(DISTINCT "conversationId") AS conversations
    FROM base, sinal
    WHERE direction = 'out' AND status = 'sent' AND "createdAt" > coalesce(sinal.t, 'epoch'::timestamp) AND "createdAt" < ${graceEnd}
  `);
  return { unacked: Number(row?.unacked ?? 0), conversations: Number(row?.conversations ?? 0) };
}
