import { describe, expect, it, vi } from 'vitest';
import { holdForProtection, planSend, PROTECTION_HOLD_MAX_MS } from '../src/modules/whatsapp/send-queue';

const prismaMock = () => ({ message: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } });

describe('mensagem segurada pela proteção do número', () => {
  it('o prazo de expirar passa a contar de quando ela deve sair', async () => {
    const prisma = prismaMock();
    const until = Date.now() + 45 * 60_000;
    await holdForProtection(prisma as never, { id: 'm1', createdAt: new Date() }, until);
    expect(prisma.message.updateMany).toHaveBeenCalledWith({ where: { id: 'm1', status: 'pending' }, data: { queuedAt: new Date(until) } });
    // 45 min segurada pelo aquecimento: na reentrada não expira (prazo de 30 min)
    const plan = planSend({ now: until + 1000, message: { id: 'm1', status: 'pending', internal: false, queuedAt: new Date(until) }, head: null, numberStatus: 'connected', maxQueueAgeMin: 30 });
    expect(plan.action).toBe('send');
  });

  it('passou de 6 h desde a criação: volta o prazo normal', async () => {
    const prisma = prismaMock();
    const createdAt = new Date(Date.now() - PROTECTION_HOLD_MAX_MS);
    await holdForProtection(prisma as never, { id: 'm1', createdAt }, Date.now() + 60_000);
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
  });
});
