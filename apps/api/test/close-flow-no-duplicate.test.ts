import { describe, expect, it, vi } from 'vitest';
import { ConversationsService } from '../src/modules/conversations/conversations.service';

/**
 * Fluxo de encerramento (pesquisa/pós-venda) reabre a conversa sem evento para falar e o nó final
 * encerra de novo: isso não pode virar um segundo atendimento nem apagar o desfecho de quem encerrou.
 */
function montar(ultimoToStatus: string | null) {
  const updates: any[] = [];
  const eventos: any[] = [];
  const prisma: any = {
    conversation: {
      findUnique: vi.fn(async () => ({ status: 'waiting', botPausedAt: null })),
      findFirst: vi.fn(async () => ({ id: 'c1', tenantId: 't1' })),
      update: vi.fn(async (a: any) => { updates.push(a.data); return { id: 'c1', tenantId: 't1', ...a.data }; }),
    },
    conversationEvent: {
      findFirst: vi.fn(async (a: any) => (a.where.toStatus ? (ultimoToStatus ? { toStatus: ultimoToStatus } : null) : null)),
      create: vi.fn(async (a: any) => { eventos.push(a.data); return a.data; }),
      findMany: vi.fn(async () => []),
    },
    flowRun: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    message: { findFirst: vi.fn(async () => null) },
    conversationTag: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    tag: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (x: any) => (Array.isArray(x) ? Promise.all(x) : x(prisma))),
  };
  const gateway = { emitConversation: vi.fn(), emitKanban: vi.fn(), emitEvent: vi.fn(), emit: vi.fn() };
  const svc = new ConversationsService(prisma, {} as any, gateway as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, updates, eventos };
}

describe('setStatusSystem: encerrar depois do fluxo de encerramento', () => {
  it('último evento de status já é o encerramento: fecha sem novo evento e sem mexer no desfecho', async () => {
    const { svc, updates, eventos } = montar('closed');
    await svc.setStatusSystem('c1', 'closed');
    expect(eventos.filter((e) => e.type === 'closed')).toHaveLength(0);
    expect(updates[0].status).toBe('closed');
    expect(updates[0]).not.toHaveProperty('lastCloseOutcome');
    expect(updates[0]).not.toHaveProperty('lastCloseReasonId');
  });

  it('atendimento novo (último evento é a reabertura): continua registrando o encerramento', async () => {
    const { svc, updates, eventos } = montar('waiting');
    await svc.setStatusSystem('c1', 'closed');
    expect(eventos.filter((e) => e.type === 'closed')).toHaveLength(1);
    expect(updates[0].lastCloseOutcome).toBe('none');
  });
});
