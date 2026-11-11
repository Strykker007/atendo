import { describe, expect, it } from 'vitest';
import { exemptMode, isTicketExempt } from '../src/modules/ignored-contacts/ignored-contacts';

// docs/contatos-isentos.md#conversa-livre
function fake(list: { phone: string; freeChat: boolean }[], own: string[] = []) {
  return {
    ignoredContact: { findMany: async ({ where }: any) => list.filter((l) => where.phone.in.includes(l.phone)) },
    whatsAppNumber: { findFirst: async ({ where }: any) => (own.some((p) => where.phone.in.includes(p)) ? { id: 'n' } : null) },
  } as never;
}

describe('modo do contato isento', () => {
  it('fora da lista = atendimento comum', async () => {
    expect(await exemptMode(fake([]), 't', '5562999990000')).toBe('none');
  });
  it('na lista = isento (segue a fila)', async () => {
    expect(await exemptMode(fake([{ phone: '5562999990000', freeChat: false }]), 't', '5562999990000')).toBe('exempt');
  });
  it('marcado "Conversa livre" = livre, com ou sem o nono dígito', async () => {
    expect(await exemptMode(fake([{ phone: '556299990000', freeChat: true }]), 't', '5562999990000')).toBe('free');
  });
  it('número da própria conta é isento comum', async () => {
    const p = fake([], ['5562999990000']);
    expect(await exemptMode(p, 't', '5562999990000')).toBe('exempt');
    expect(await isTicketExempt(p, 't', '5562999990000')).toBe(true);
  });
});
