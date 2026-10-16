import { describe, it, expect, vi } from 'vitest';
import { saveFlowContactField, saveHttpContactMappings } from '../src/modules/flows/contact-field';
import { assertOwnContactFields } from '../src/modules/flows/flow-validation';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { FlowDefinition } from '@atendo/shared';

const database = () => ({ conversation: { findFirstOrThrow: vi.fn().mockResolvedValue({ contactId: 'contact' }) }, contact: { update: vi.fn() }, contactAttribute: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() } });
describe('destinos da ficha no fluxo', () => {
  it('grava campo fixo com isolamento e limite', async () => {
    const db = database();
    await saveFlowContactField(db as unknown as PrismaService, 'tenant', 'conversation', 'name', 'x'.repeat(1200));
    expect(db.conversation.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: 'conversation', tenantId: 'tenant' }, select: { contactId: true } });
    expect(db.contact.update).toHaveBeenCalledWith({ where: { id: 'contact', tenantId: 'tenant' }, data: { name: 'x'.repeat(1000), nameSource: 'manual' } });
  });
  it('cria o campo livre no contato, preservando o rótulo', async () => {
    const db = database(); db.contactAttribute.findFirst.mockResolvedValueOnce({ id: 'catalog' }).mockResolvedValueOnce(null);
    await saveFlowContactField(db as unknown as PrismaService, 'tenant', 'conversation', 'attribute:Pedido', '{"total":10}');
    expect(db.contactAttribute.create).toHaveBeenCalledWith({ data: { tenantId: 'tenant', contactId: 'contact', label: 'Pedido', type: 'text', value: '{"total":10}' } });
  });
  it('rejeita campo livre ausente no tenant', async () => {
    const db = database(); db.contactAttribute.findFirst.mockResolvedValue(null);
    const def = { nodes: [{ type: 'http', data: { mappings: [{ contactField: 'attribute:Segredo' }] } }], edges: [] } as unknown as FlowDefinition;
    await expect(assertOwnContactFields(db as unknown as PrismaService, 'tenant', def)).rejects.toThrow('não existe nesta empresa');
    expect(db.contactAttribute.findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant', label: 'Segredo' }, select: { id: true } });
  });
});


describe('mapeamento HTTP → ficha', () => {
  const data = { mappings: [{ id: 'm', path: 'cliente.nome', varName: 'nome', contactField: 'name' as const }] };
  it('persiste o valor mapeado', async () => {
    const db = database();
    await saveHttpContactMappings(db as unknown as PrismaService, 'tenant', 'conversation', data, { ok: true, status: 200, body: '{}', vars: { nome: 'Ana' }, missing: [] });
    expect(db.contact.update).toHaveBeenCalledWith({ where: { id: 'contact', tenantId: 'tenant' }, data: { name: 'Ana', nameSource: 'manual' } });
  });
  it('falha ou caminho ausente preserva a ficha', async () => {
    const db = database();
    for (const outcome of [{ ok: false, missing: [] }, { ok: true, missing: ['cliente.nome'] }]) {
      await saveHttpContactMappings(db as unknown as PrismaService, 'tenant', 'conversation', data, { ...outcome, status: 500, body: '', vars: { nome: '' } });
    }
    expect(db.contact.update).not.toHaveBeenCalled();
  });
});
