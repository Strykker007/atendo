import { describe, expect, it, vi } from 'vitest';
import { AsaasService } from '../src/modules/billing/asaas.service';

/**
 * Mensalidade avulsa (painel de Vencimentos) vencida em assinatura sem gateway → past_due com
 * carência (docs/05-planos-e-cobranca.md). Antes o cliente ficava `active` para sempre.
 */
const DIA = 86_400_000;
const agora = new Date('2026-11-16T12:00:00Z');

function montar(invoices: any[]) {
  const updates: any[] = [];
  const prisma = {
    invoice: { findMany: vi.fn(async () => invoices) },
    subscription: { updateMany: vi.fn(async (a: any) => { updates.push(a); return { count: 1 }; }) },
  };
  const mail = { send: vi.fn(async () => undefined) };
  const usage = { adminEmails: vi.fn(async () => ['admin@exemplo.invalid']) };
  const svc = new AsaasService(prisma as any, usage as any, mail as any, {} as any, {} as any);
  return { svc, updates, mail };
}
const fatura = (over: Partial<any> = {}) => ({
  tenantId: 't1', externalId: 'pay_1', totalAmount: 257, dueAt: new Date('2026-11-09T03:00:00Z'),
  items: [{ key: 'group', kind: 'group', companyId: null, label: 'Farmácia', amount: 257, cycle: 'monthly', replacesPaymentId: null }],
  tenant: { subscription: { plan: { limits: { graceDays: 5 } } } },
  ...over,
});

describe('AsaasService.markOverdueDues', () => {
  it('vencida há dias: past_due com pelo menos 2 dias de aviso a partir de agora, e manda o e-mail', async () => {
    const { svc, updates, mail } = montar([fatura()]);
    expect(await svc.markOverdueDues(undefined, agora)).toBe(1);
    expect(updates[0].where).toMatchObject({ tenantId: 't1', gateway: null });
    expect(updates[0].data.status).toBe('past_due');
    // vencimento + 5 dias (14/11) já passou: vale agora + 2 dias
    expect(updates[0].data.graceUntil.getTime()).toBe(agora.getTime() + 2 * DIA);
    expect(mail.send).toHaveBeenCalledOnce();
  });

  it('vencida ontem: carência do plano contada do vencimento', async () => {
    const dueAt = new Date(agora.getTime() - DIA);
    const { svc, updates } = montar([fatura({ dueAt })]);
    await svc.markOverdueDues(undefined, agora);
    expect(updates[0].data.graceUntil.getTime()).toBe(dueAt.getTime() + 5 * DIA);
  });

  it('cobrança só de empresa (item company) não mexe na assinatura do cliente', async () => {
    const { svc, updates } = montar([fatura({ items: [{ key: 'company:c1', kind: 'company', companyId: 'c1', label: 'Filial', amount: 99, cycle: 'monthly', replacesPaymentId: null }] })]);
    expect(await svc.markOverdueDues(undefined, agora)).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('duas faturas vencidas do mesmo cliente: marca uma vez só', async () => {
    const { svc, updates } = montar([fatura(), fatura({ externalId: 'pay_2' })]);
    expect(await svc.markOverdueDues(undefined, agora)).toBe(1);
    expect(updates).toHaveLength(1);
  });
});
