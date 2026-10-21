import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppNumber } from '@prisma/client';
import { InboundService } from '../src/modules/conversations/inbound.service';
import { ContactsSyncScheduler, CONTACTS_SYNC_EVERY_MS } from '../src/modules/whatsapp/contacts-sync';

const number = { id: 'number', tenantId: 'tenant' } as WhatsAppNumber;
function setup() {
  const prisma = {
    phonebookEntry: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    contact: { findUnique: vi.fn().mockImplementation(async ({ where }) => ({ id: where.tenantId_phone.phone, name: 'Antigo', nameSource: 'agenda' })), update: vi.fn().mockResolvedValue({}) },
    message: { findFirst: vi.fn().mockResolvedValue(null) },
    conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'conversation-a' }, { id: 'conversation-b' }, { id: 'conversation-a' }]) },
  };
  const gateway = { emitConversation: vi.fn() };
  const service = new InboundService(prisma as never, {} as never, gateway as never, {} as never, {} as never, {} as never, {} as never);
  return { prisma, gateway, service };
}

describe('sincronização da agenda em lote', () => {
  it('emite só ao fim, uma vez por conversa, com contatos e tenant filtrados', async () => {
    const { prisma, gateway, service } = setup();
    prisma.contact.update.mockImplementation(async () => { expect(gateway.emitConversation).not.toHaveBeenCalled(); return {}; });
    const result = await service.syncPhonebook(number, [{ phone: '1', name: ' Ana  Silva ' }, { phone: '1', name: 'Ana Silva' }, { phone: '2', name: 'Bia' }]);
    expect(result).toEqual({ total: 3, changed: 2 });
    expect(prisma.contact.update).toHaveBeenCalledTimes(2);
    expect(prisma.contact.update).toHaveBeenCalledWith({ where: { id: '1', tenantId: 'tenant' }, data: { name: 'Ana Silva', nameSource: 'agenda' } });
    expect(prisma.phonebookEntry.upsert.mock.calls[0][0].create.name).toBe('Ana Silva');
    expect(prisma.conversation.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', contactId: { in: ['1', '2'] } } });
    expect(gateway.emitConversation.mock.calls).toEqual([['tenant', { id: 'conversation-a' }], ['tenant', { id: 'conversation-b' }]]);
  });
  it('ignora diferenças de espaços no registro salvo, sem consultas por contato ou eventos', async () => {
    const { prisma, gateway, service } = setup();
    prisma.phonebookEntry.findMany.mockResolvedValue([{ phone: '1', name: '  Flávia \t Rezende ' }] as never);
    expect(await service.syncPhonebook(number, [{ phone: '1', name: 'Flávia Rezende' }])).toEqual({ total: 1, changed: 0 });
    expect(prisma.contact.findUnique).not.toHaveBeenCalled();
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    expect(gateway.emitConversation).not.toHaveBeenCalled();
  });
  it('webhook continua emitindo imediatamente, com nome normalizado', async () => {
    const { prisma, gateway, service } = setup();
    await service.applyContactName(number, { phone: '1', name: ' Flávia  Rezende ' });
    expect(prisma.contact.update.mock.calls[0][0].data.name).toBe('Flávia Rezende');
    expect(prisma.conversation.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', contactId: '1' } });
    expect(gateway.emitConversation).toHaveBeenCalledTimes(2);
  });
  it('webhook não grava nem emite por diferença de espaços', async () => {
    const { prisma, gateway, service } = setup();
    prisma.phonebookEntry.findUnique.mockResolvedValue({ name: 'Flávia  Rezende', previousName: null } as never);
    prisma.contact.findUnique.mockResolvedValue({ id: '1', name: ' Flávia\tRezende ', nameSource: 'agenda' });
    await service.applyContactName(number, { phone: '1', name: 'Flávia Rezende' });
    expect(prisma.phonebookEntry.upsert).not.toHaveBeenCalled();
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(gateway.emitConversation).not.toHaveBeenCalled();
  });
  it('falha parcial ainda notifica o que foi gravado', async () => {
    const { prisma, gateway, service } = setup();
    prisma.contact.update.mockRejectedValueOnce(new Error('falha')).mockResolvedValue({});
    await expect(service.syncPhonebook(number, [{ phone: '1', name: 'Ana' }])).rejects.toThrow('falha');
    expect(gateway.emitConversation).not.toHaveBeenCalled();
    prisma.contact.update.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('falha'));
    await expect(service.syncPhonebook(number, [{ phone: '1', name: 'Ana' }, { phone: '2', name: 'Bia' }])).rejects.toThrow('falha');
    expect(prisma.conversation.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', contactId: { in: ['1'] } } });
    expect(gateway.emitConversation).toHaveBeenCalledTimes(2);
  });
});

describe('agendamento da agenda', () => {
  it('substitui o mesmo scheduler por cron às 03:00 de São Paulo', async () => {
    const queue = { upsertJobScheduler: vi.fn() };
    await new ContactsSyncScheduler(queue as never).onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith('contacts-sync', { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' }, { name: 'sync', data: {} });
  });
  it('mantém o bloqueio manual por 24 h', async () => {
    const queue = { getJob: vi.fn().mockResolvedValue({ finishedOn: Date.now(), remove: vi.fn() }), add: vi.fn() };
    expect(CONTACTS_SYNC_EVERY_MS).toBe(86400000);
    await expect(new ContactsSyncScheduler(queue as never).enqueue('number')).rejects.toThrow('já foi sincronizada hoje');
    expect(queue.add).not.toHaveBeenCalled();
  });
});
