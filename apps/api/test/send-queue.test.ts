import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolveSendLimits, SEND_LIMIT_DEFAULTS, SEND_RETRY } from '@atendo/shared';
import { DISCONNECTED_RECHECK_MS, TURN_RECHECK_MS, enqueueOutbound, outboundJobId, planSend, type PlanInput } from '../src/modules/whatsapp/send-queue';
import { ProviderSendError, isTransientSendError, retryDelayMs } from '../src/modules/whatsapp/providers/provider-error';
import { ConversationsService } from '../src/modules/conversations/conversations.service';

const now = Date.parse('2026-10-06T12:00:00Z');
const at = (msAgo: number) => new Date(now - msAgo);
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  now,
  message: { id: 'm1', status: 'pending', internal: false, queuedAt: at(1000) },
  head: { id: 'm1', queuedAt: at(1000) },
  numberStatus: 'connected',
  maxQueueAgeMin: 30,
  ...over,
});

describe('planSend — decisão do worker', () => {
  it('cabeça da conversa com número conectado: envia', () => {
    expect(planSend(base())).toEqual({ action: 'send' });
  });

  it('já enviada / com falha / nota interna: não faz nada', () => {
    expect(planSend(base({ message: { ...base().message, status: 'sent' } })).action).toBe('skip');
    expect(planSend(base({ message: { ...base().message, status: 'failed' } })).action).toBe('skip');
    expect(planSend(base({ message: { ...base().message, internal: true } })).action).toBe('skip');
  });

  it('outra mensagem da conversa na frente: espera a vez', () => {
    expect(planSend(base({ head: { id: 'm0', queuedAt: at(2000) } }))).toEqual({ action: 'wait_turn', delayMs: TURN_RECHECK_MS });
  });

  it('a da frente expirou e trava a fila: manda expirá-la e reavalia na hora', () => {
    expect(planSend(base({ head: { id: 'm0', queuedAt: at(31 * 60_000) } }))).toEqual({ action: 'wait_turn', delayMs: 0, staleHead: 'm0' });
  });

  it('número desconectado: pausa sem chamar o provider', () => {
    expect(planSend(base({ numberStatus: 'disconnected' }))).toEqual({ action: 'pause', delayMs: DISCONNECTED_RECHECK_MS });
    expect(planSend(base({ numberStatus: 'pending_qr' })).action).toBe('pause');
  });

  it('número desconectado e fora da vez: espera no ritmo lento', () => {
    expect(planSend(base({ numberStatus: 'disconnected', head: { id: 'm0', queuedAt: at(2000) } }))).toEqual({ action: 'wait_turn', delayMs: DISCONNECTED_RECHECK_MS });
  });

  it('ficou na fila além do prazo: expira como falha em vez de sair fora de contexto', () => {
    const p = planSend(base({ message: { ...base().message, queuedAt: at(31 * 60_000) }, numberStatus: 'connected' }));
    expect(p.action).toBe('expire');
    expect(planSend(base({ message: { ...base().message, queuedAt: at(29 * 60_000) } })).action).toBe('send');
  });
});

/**
 * Simulação da fila com vários workers concorrentes, latência aleatória do provider e jobs
 * pegos fora de ordem. Mesmo protocolo do OutboundProcessor: planSend → (envia | atrasa) e,
 * ao terminar, promove a próxima da conversa.
 */
async function simulate(opts: { conversations: number; perConversation: number; workers: number; seed: number; disconnectUntilTick?: number }) {
  let s = opts.seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  type M = { id: string; conv: string; seq: number; status: 'pending' | 'sent' | 'failed'; queuedAt: Date };
  const msgs: M[] = [];
  let seq = 0;
  for (let i = 0; i < opts.perConversation; i++) {
    for (let c = 0; c < opts.conversations; c++) msgs.push({ id: `c${c}-${i}`, conv: `c${c}`, seq: ++seq, status: 'pending', queuedAt: new Date(now) });
  }
  // jobs entram embaralhados: a fila não garante ordem de processamento
  let ready = [...msgs].sort(() => rnd() - 0.5).map((m) => m.id);
  const delayed = new Set<string>();
  const sent: M[] = [];
  let tick = 0;
  let numberStatus = opts.disconnectUntilTick ? 'disconnected' : 'connected';
  const providerCalls: string[] = [];

  const head = (conv: string) => msgs.filter((m) => m.conv === conv && m.status === 'pending').sort((a, b) => a.seq - b.seq)[0] ?? null;
  const promoteNext = (conv: string) => {
    const h = head(conv);
    if (h && delayed.delete(h.id)) ready.push(h.id);
  };

  const worker = async () => {
    while (msgs.some((m) => m.status === 'pending')) {
      tick++;
      if (opts.disconnectUntilTick && tick >= opts.disconnectUntilTick && numberStatus !== 'connected') {
        numberStatus = 'connected';
        // resumeNumber: acorda a cabeça de cada conversa
        for (const c of new Set(msgs.map((m) => m.conv))) promoteNext(c);
      }
      const id = ready.shift();
      if (!id) {
        // nada pronto: o "relógio" do atraso devolve os atrasados (recheck)
        if (delayed.size && rnd() < 0.2) { const [first] = delayed; delayed.delete(first); ready.push(first); }
        await new Promise((r) => setTimeout(r, 0));
        continue;
      }
      const m = msgs.find((x) => x.id === id)!;
      const h = head(m.conv);
      const plan = planSend({ now, message: { id: m.id, status: m.status, internal: false, queuedAt: m.queuedAt }, head: h && { id: h.id, queuedAt: h.queuedAt }, numberStatus, maxQueueAgeMin: 30 });
      if (plan.action === 'skip') continue;
      if (plan.action === 'wait_turn' || plan.action === 'pause') { delayed.add(m.id); continue; }
      if (plan.action !== 'send') throw new Error(plan.action);
      providerCalls.push(m.id);
      // latência variável do provider: mídia grande demora mais que texto curto
      for (let i = Math.floor(rnd() * 5); i > 0; i--) await new Promise((r) => setTimeout(r, 0));
      m.status = 'sent';
      sent.push(m);
      promoteNext(m.conv);
    }
  };
  await Promise.all(Array.from({ length: opts.workers }, worker));
  return { sent, providerCalls, msgs };
}

describe('fila — ordem por conversa sob concorrência', () => {
  it('cada conversa sai na ordem em que enfileirou, com 20 workers e jobs embaralhados', async () => {
    for (const seed of [1, 7, 42, 1337]) {
      const { sent } = await simulate({ conversations: 6, perConversation: 8, workers: 20, seed });
      expect(sent).toHaveLength(48);
      for (let c = 0; c < 6; c++) {
        const order = sent.filter((m) => m.conv === `c${c}`).map((m) => m.seq);
        expect(order, `seed ${seed} conversa ${c}`).toEqual([...order].sort((a, b) => a - b));
      }
    }
  });

  it('conversas diferentes seguem em paralelo (uma não espera a outra terminar)', async () => {
    const { sent } = await simulate({ conversations: 4, perConversation: 5, workers: 8, seed: 3 });
    // se fosse uma fila global serial por conversa, a primeira conversa terminaria antes da segunda começar
    const firstOfC1 = sent.findIndex((m) => m.conv === 'c1');
    const lastOfC0 = sent.map((m) => m.conv).lastIndexOf('c0');
    expect(firstOfC1).toBeLessThan(lastOfC0);
  });

  it('número desconectado: nada vai ao provider até reconectar; depois retoma em ordem', async () => {
    const { sent, providerCalls } = await simulate({ conversations: 3, perConversation: 4, workers: 10, seed: 9, disconnectUntilTick: 200 });
    expect(providerCalls).toHaveLength(12);
    for (let c = 0; c < 3; c++) {
      const order = sent.filter((m) => m.conv === `c${c}`).map((m) => m.seq);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });
});

describe('retry — transitório × permanente', () => {
  it('rede, timeout, 5xx, 429 e sessão caída são transitórios', () => {
    expect(isTransientSendError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientSendError(new Error('The operation was aborted due to timeout'))).toBe(true);
    expect(isTransientSendError(new ProviderSendError('Evolution 500', 500))).toBe(true);
    expect(isTransientSendError(new ProviderSendError('Too many', 429))).toBe(true);
    expect(isTransientSendError(new ProviderSendError('Connection Closed', 400))).toBe(true);
    // limite de taxa da Meta vem como 400 + código
    expect(isTransientSendError(new ProviderSendError('rate limit', 400, 130429))).toBe(true);
  });

  it('número inválido, mídia recusada, tipo não suportado e credencial são permanentes', () => {
    expect(isTransientSendError(new ProviderSendError('exists: false', 400))).toBe(false);
    expect(isTransientSendError(new ProviderSendError('Invalid parameter', 400, 100))).toBe(false);
    expect(isTransientSendError(new ProviderSendError('token expirado', 401, 190))).toBe(false);
    expect(isTransientSendError(new BadRequestException('Tipo não suportado pela Meta: sticker'))).toBe(false);
  });

  it('backoff exponencial com jitter, dentro do teto', () => {
    const opts = SEND_RETRY;
    expect(retryDelayMs(1, opts, () => 0.5)).toBe(opts.baseDelayMs);
    expect(retryDelayMs(2, opts, () => 0.5)).toBe(opts.baseDelayMs * 2);
    expect(retryDelayMs(3, opts, () => 0.5)).toBe(opts.baseDelayMs * 4);
    // variação: ± jitter em torno do exponencial
    expect(retryDelayMs(1, opts, () => 0)).toBe(opts.baseDelayMs * (1 - opts.jitter));
    expect(retryDelayMs(1, opts, () => 1)).toBe(opts.baseDelayMs * (1 + opts.jitter));
    expect(retryDelayMs(30, opts, () => 0.5)).toBe(opts.maxDelayMs);
  });
});

describe('limites por conexão', () => {
  it('padrão do provider, Evolution mais conservador que Meta', () => {
    expect(resolveSendLimits('evolution')).toEqual(SEND_LIMIT_DEFAULTS.evolution);
    expect(SEND_LIMIT_DEFAULTS.evolution.ratePerMinute).toBeLessThan(SEND_LIMIT_DEFAULTS.meta.ratePerMinute);
  });
  it('sobrescreve só o que a conexão configurou e ignora valor fora da faixa', () => {
    const l = resolveSendLimits('meta', { ratePerMinute: 30, convBurstMax: 0 });
    expect(l.ratePerMinute).toBe(30);
    expect(l.convBurstMax).toBe(SEND_LIMIT_DEFAULTS.meta.convBurstMax);
  });
});

describe('deduplicação', () => {
  it('o jobId vem da mensagem + posição na fila: enfileirar duas vezes não cria dois jobs', async () => {
    const add = vi.fn();
    await enqueueOutbound({ add } as never, { id: 'abc', queueSeq: 7n });
    await enqueueOutbound({ add } as never, { id: 'abc', queueSeq: 7n });
    expect(add.mock.calls[0][2].jobId).toBe(outboundJobId({ id: 'abc', queueSeq: 7n }));
    expect(add.mock.calls[1][2].jobId).toBe(add.mock.calls[0][2].jobId);
    // "Tentar novamente" ganha posição nova → job novo
    expect(outboundJobId({ id: 'abc', queueSeq: 9n })).not.toBe(outboundJobId({ id: 'abc', queueSeq: 7n }));
  });

  it('nota interna nunca entra na fila de envio externo', async () => {
    const add = vi.fn();
    await expect(enqueueOutbound({ add } as never, { id: 'n1', queueSeq: 1n, internal: true })).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
  });

  const existing = { id: 'm-1', conversationId: 'c1', mediaUrl: null, quotedMessage: null, idempotencyKey: 'k1' };
  const author = { id: 'u1', role: 'agent' } as never;
  const conv = { id: 'c1', tenantId: 't1', numberId: 'n1', status: 'in_progress', assigneeId: 'u1', lastInboundAt: new Date(), number: { id: 'n1', tenantId: 't1', isActive: true, status: 'connected', provider: 'evolution', label: 'Loja' } };

  function service(prisma: Record<string, unknown>) {
    const queue = { add: vi.fn() };
    const svc = new ConversationsService(prisma as never, { canSend: vi.fn().mockResolvedValue({ ok: true }) } as never, { emitMessage: vi.fn(), emitConversation: vi.fn() } as never, { signedUrl: (k: string) => k } as never, {} as never, queue as never);
    return { svc, queue };
  }

  it('clique duplo / reenvio do front com a mesma chave devolve a mensagem já criada', async () => {
    const create = vi.fn();
    const { svc, queue } = service({
      conversation: { findFirst: vi.fn().mockResolvedValue(conv) },
      message: { findUnique: vi.fn().mockResolvedValue(existing), create },
    });
    const r = await svc.send('t1', author, 'c1', { type: 'text', text: 'oi', idempotencyKey: 'k1' });
    expect(r.id).toBe('m-1');
    expect(create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('duas requisições simultâneas com a mesma chave: a que perde o unique devolve a da outra', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    const { svc, queue } = service({
      conversation: { findFirst: vi.fn().mockResolvedValue(conv), update: vi.fn() },
      message: { findUnique, findFirst: vi.fn(), create: vi.fn().mockRejectedValue(p2002) },
    });
    const r = await svc.send('t1', author, 'c1', { type: 'text', text: 'oi', idempotencyKey: 'k1' });
    expect(r.id).toBe('m-1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('envio do sistema (campanha, lembrete) com chave repetida não duplica', async () => {
    const create = vi.fn();
    const { svc, queue } = service({ message: { findUnique: vi.fn().mockResolvedValue(existing), create }, conversation: { findUnique: vi.fn() } });
    const r = await svc.sendAsSystem('c1', 'Lembrete', undefined, undefined, { idempotencyKey: 'reminder-a1-1440' });
    expect(r.id).toBe('m-1');
    expect(create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
