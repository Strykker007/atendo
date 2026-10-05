import type { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { SEND_RETRY } from '@atendo/shared';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { OutboundJob } from './queues';

/**
 * Fila de envio única (docs/envio.md). Toda mensagem para o WhatsApp — atendente, fluxo,
 * resposta rápida, boas-vindas/faixa de horário, lembrete, campanha — é gravada `pending` e
 * entra aqui por `enqueueOutbound`. Só o OutboundProcessor fala com o provider.
 *
 * Ordem por conversa: o BullMQ (open source) não tem grupos ordenados, então a ordem vem do
 * banco. Cada mensagem tem um `queueSeq` crescente; o worker só envia a pendente de menor
 * `queueSeq` da conversa ("cabeça"). As outras voltam para a fila atrasadas e são promovidas
 * quando a da frente termina (enviada, falha ou expirada). Conversas diferentes não se
 * bloqueiam — a concorrência do worker continua valendo entre elas.
 */

/** Quanto um job fora da vez espera antes de olhar de novo (a promoção normalmente chega antes). */
export const TURN_RECHECK_MS = 5_000;
/** Número desconectado: a fila dele fica parada; olha de novo nesse intervalo (ou ao reconectar). */
export const DISCONNECTED_RECHECK_MS = 60_000;

export const outboundJobId = (m: { id: string; queueSeq: bigint | number }) => `out-${m.id}-${m.queueSeq}`;

/** Opções de todo job de envio: tentativas e backoff com jitter (`OutboundProcessor`). */
export const OUTBOUND_JOB_OPTS = {
  attempts: SEND_RETRY.attempts,
  backoff: { type: 'send-jitter' },
  removeOnComplete: 1000,
  removeOnFail: 1000,
} as const;

/**
 * Entrega a mensagem (já `pending` no banco) à fila. O `jobId` vem da mensagem: chamar duas
 * vezes para o mesmo enfileiramento não cria dois jobs.
 */
export async function enqueueOutbound(queue: Queue<OutboundJob>, m: { id: string; queueSeq: bigint | number; internal?: boolean }) {
  // nota interna nunca entra na fila externa — o worker e o `planSend` também recusam, isto é a 1ª barreira
  if (m.internal) throw new Error(`Nota interna ${m.id} não pode ir para a fila de envio`);
  await queue.add('send', { messageId: m.id }, { ...OUTBOUND_JOB_OPTS, jobId: outboundJobId(m) });
}

/** Volta uma mensagem com falha para o fim da fila: `queueSeq` novo, prazo de expiração recomeça. */
export async function requeueSeq(prisma: PrismaService, messageId: string) {
  const rows = await prisma.$queryRaw<{ queueSeq: bigint }[]>(Prisma.sql`
    UPDATE "messages" SET "queueSeq" = nextval(pg_get_serial_sequence('messages', 'queueSeq')), "queuedAt" = now()
    WHERE "id" = ${messageId} RETURNING "queueSeq"`);
  return rows[0]?.queueSeq;
}

const PENDING_OUT = { direction: 'out', status: 'pending', internal: false } as const;

/** A pendente mais antiga da conversa — a única que pode sair agora. */
export function headOf(prisma: PrismaService, conversationId: string) {
  return prisma.message.findFirst({
    where: { conversationId, ...PENDING_OUT },
    orderBy: { queueSeq: 'asc' },
    select: { id: true, queueSeq: true, queuedAt: true },
  });
}

/** Adianta o job de uma mensagem que estava esperando a vez (ou a reconexão). */
async function promote(queue: Queue<OutboundJob>, m: { id: string; queueSeq: bigint }) {
  const job = await queue.getJob(outboundJobId(m));
  if (job && (await job.isDelayed())) await job.promote().catch(() => undefined);
}

/** A da frente terminou: chama a próxima da conversa. */
export async function promoteNext(prisma: PrismaService, queue: Queue<OutboundJob>, conversationId: string) {
  const next = await headOf(prisma, conversationId);
  if (next) await promote(queue, next);
}

/**
 * Número voltou a conectar (QR lido): acorda a cabeça de cada conversa dele, da mais antiga
 * para a mais nova. As demais seguem pela promoção em cadeia, e o ritmo do número (por
 * minuto, intervalo do perfil) espalha os envios — nada sai tudo de uma vez.
 */
export async function resumeNumber(prisma: PrismaService, queue: Queue<OutboundJob>, numberId: string) {
  const heads = await prisma.message.findMany({
    where: { numberId, ...PENDING_OUT },
    orderBy: [{ conversationId: 'asc' }, { queueSeq: 'asc' }],
    distinct: ['conversationId'],
    select: { id: true, queueSeq: true },
  });
  heads.sort((a, b) => (a.queueSeq < b.queueSeq ? -1 : 1));
  for (const h of heads) await promote(queue, h);
  return heads.length;
}

// ---------------------------------------------------------------------------------------------
// Decisão do worker (pura, testada em test/send-queue.test.ts)
// ---------------------------------------------------------------------------------------------

export type SendPlan =
  | { action: 'skip' }
  | { action: 'expire'; reason: string }
  /** outra mensagem da conversa está na frente; `staleHead` = a da frente expirou e trava a fila */
  | { action: 'wait_turn'; delayMs: number; staleHead?: string }
  | { action: 'pause'; delayMs: number }
  | { action: 'send' };

export interface PlanInput {
  now: number;
  message: { id: string; status: string; internal: boolean; queuedAt: Date };
  /** pendente mais antiga da conversa (pode ser a própria) */
  head: { id: string; queuedAt: Date } | null;
  numberStatus: string;
  maxQueueAgeMin: number;
}

export const expiredReason = (min: number) => `Expirou na fila: ficou mais de ${min} min sem poder sair (número desconectado ou fila parada). Envie de novo se ainda fizer sentido.`;

export function planSend(i: PlanInput): SendPlan {
  if (i.message.status !== 'pending' || i.message.internal) return { action: 'skip' };
  const maxAge = i.maxQueueAgeMin * 60_000;
  if (i.now - i.message.queuedAt.getTime() > maxAge) return { action: 'expire', reason: expiredReason(i.maxQueueAgeMin) };
  if (i.head && i.head.id !== i.message.id) {
    const stale = i.now - i.head.queuedAt.getTime() > maxAge;
    // número parado: ninguém da conversa vai sair tão cedo, não precisa olhar a cada 5 s
    const recheck = i.numberStatus === 'connected' ? TURN_RECHECK_MS : DISCONNECTED_RECHECK_MS;
    return { action: 'wait_turn', delayMs: stale ? 0 : recheck, ...(stale && { staleHead: i.head.id }) };
  }
  if (i.numberStatus !== 'connected') return { action: 'pause', delayMs: DISCONNECTED_RECHECK_MS };
  return { action: 'send' };
}
