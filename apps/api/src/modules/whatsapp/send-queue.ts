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
export async function enqueueOutbound(queue: Queue<OutboundJob>, m: { id: string; queueSeq: bigint | number; internal?: boolean }, opts?: { minGapMs?: number }) {
  // nota interna nunca entra na fila externa — o worker e o `planSend` também recusam, isto é a 1ª barreira
  if (m.internal) throw new Error(`Nota interna ${m.id} não pode ir para a fila de envio`);
  const minGapMs = Math.max(0, Math.round(opts?.minGapMs ?? 0));
  await queue.add('send', { messageId: m.id, ...(minGapMs > 0 && { minGapMs }) }, { ...OUTBOUND_JOB_OPTS, jobId: outboundJobId(m) });
}

/**
 * "Tentar novamente": a mensagem volta para a fila **na frente** das pendentes da conversa —
 * `queueSeq` = menor pendente − 1. Se ela era a 1ª de um fluxo, tem de chegar antes das que
 * ainda não saíram (as que já saíram não dá para desfazer). Sem pendentes, pega um número novo.
 * O prazo de expiração recomeça. `queueSeq` não é único: repetir o valor de uma mensagem antiga
 * já enviada não atrapalha (a vez só olha as pendentes).
 */
export async function requeueSeq(prisma: PrismaService, messageId: string) {
  const rows = await prisma.$queryRaw<{ queueSeq: bigint }[]>(Prisma.sql`
    UPDATE "messages" m SET "queueSeq" = COALESCE(
        (SELECT MIN(o."queueSeq") - 1 FROM "messages" o
          WHERE o."conversationId" = m."conversationId" AND o."direction" = 'out' AND o."status" = 'pending'
            AND o."internal" = false AND o."id" <> m."id"),
        nextval(pg_get_serial_sequence('messages', 'queueSeq'))),
      "queuedAt" = now()
    WHERE m."id" = ${messageId} RETURNING m."queueSeq"`);
  return rows[0]?.queueSeq;
}

/**
 * Tira da fila o job antigo da mensagem antes de enfileirar de novo: com o mesmo `jobId`
 * (`out-<id>-<queueSeq>`) o BullMQ ignoraria o `add` em silêncio e a mensagem ficaria parada.
 */
export async function removeOutboundJob(queue: Queue<OutboundJob>, m: { id: string; queueSeq: bigint | number }) {
  const job = await queue.getJob(outboundJobId(m));
  if (job) await job.remove().catch(() => undefined);
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

/**
 * Mensagem segurada pela PROTEÇÃO do número (aquecimento, teto de automáticas, ritmo) não é fila
 * parada: na tela ela já aparece com ✓ e sai em segundo plano quando houver vaga. Por isso o prazo
 * de expirar (`maxQueueAgeMin`) passa a contar de `until` — o horário em que ela deve sair — e
 * não de quando entrou. Só expira o que está preso de verdade (número desconectado, job perdido).
 * Teto: depois de `PROTECTION_HOLD_MAX_MS` desde a criação, volta a valer o prazo normal — uma
 * boas-vindas que sairia 6 h depois já não faz sentido.
 */
export const PROTECTION_HOLD_MAX_MS = 6 * 60 * 60_000;

export async function holdForProtection(prisma: PrismaService, m: { id: string; createdAt: Date }, until: number) {
  if (until - m.createdAt.getTime() > PROTECTION_HOLD_MAX_MS) return;
  await prisma.message.updateMany({ where: { id: m.id, status: 'pending' }, data: { queuedAt: new Date(until) } });
}

export const expiredReason = (min: number) => `Não saiu: ficou mais de ${min} min esperando a vez (número desconectado ou o ritmo de proteção do número segurou o envio). Envie de novo se ainda fizer sentido.`;

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
