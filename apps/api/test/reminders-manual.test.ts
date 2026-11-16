import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reminderMail } from '../src/modules/billing/monthly-billing';
import { MonthlyBillingService } from '../src/modules/billing/monthly-billing.service';

/** Lembretes de quem não tem assinatura no Asaas (docs/05#lembretes-da-mensalidade). */
const plano = { isFree: false, priceMonth: 257, billingCycle: 'monthly', limits: {} };

function montar(opts: { invoice?: any; periodEnd: string }) {
  const enviados: any[] = [];
  const redisKeys = new Set<string>();
  const prisma: any = {
    subscription: { findUnique: vi.fn(async () => ({ tenantId: 't1', gateway: null, status: 'active', currentPeriodEnd: new Date(opts.periodEnd), priceMonth: null, units: 1, plan: plano })) },
    invoice: {
      findFirst: vi.fn(async () => opts.invoice ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ billingEmail: 'fin@exemplo.invalid' })) },
  };
  const redis: any = { set: vi.fn(async (k: string) => (redisKeys.has(k) ? null : (redisKeys.add(k), 'OK'))), del: vi.fn() };
  const mail: any = { send: vi.fn(async (m: any) => { enviados.push(m); }) };
  const usage: any = { adminEmails: vi.fn(async () => ['admin@exemplo.invalid']) };
  const asaas: any = { getPixQrCode: vi.fn(async () => ({ payload: 'PIX-COPIA-E-COLA', encodedImage: '' })) };
  const svc = new MonthlyBillingService(prisma, asaas, mail, usage, redis);
  return { svc, enviados };
}

describe('lembrete sem gateway', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-16T15:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('sem cobrança gerada, vencendo em 3 dias: "vence em" levando a Vencimentos, uma vez só', async () => {
    const { svc, enviados } = montar({ periodEnd: '2026-11-20T02:59:59Z' });
    await svc.remindManual('t1');
    await svc.remindManual('t1');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].subject).toContain('vence em 19/11');
    expect(enviados[0].text).toContain('/plano/vencimentos');
  });

  it('com Pix avulso de Vencimentos em aberto: e-mail com o Pix copia e cola', async () => {
    const invoice = { id: 'i1', externalId: 'pay_1', totalAmount: 257, dueAt: new Date('2026-11-16T03:00:00Z'), hostedUrl: 'https://asaas/i/1', remindedSoonAt: new Date(), remindedDueAt: null, items: [{ kind: 'group' }] };
    const { svc, enviados } = montar({ invoice, periodEnd: '2026-12-09T02:59:59Z' });
    await svc.remindManual('t1');
    expect(enviados[0].subject).toContain('vence hoje');
    expect(enviados[0].text).toContain('PIX-COPIA-E-COLA');
  });

  it('sem cobrança, venceu ontem: um aviso de vencida; vencida há mais tempo não manda nada', async () => {
    const ontem = montar({ periodEnd: '2026-11-16T02:59:59Z' });
    await ontem.svc.remindManual('t1');
    expect(ontem.enviados[0].subject).toContain('venceu em 15/11');
    const antiga = montar({ periodEnd: '2026-11-09T02:59:59Z' });
    await antiga.svc.remindManual('t1');
    expect(antiga.enviados).toHaveLength(0);
  });

  it('assunto do aviso de vencida', () => {
    expect(reminderMail({ brand: 'VogoChat', kind: 'overdue', value: 257, dueDate: '2026-11-15', pixPayload: null, qrUrl: null, payUrl: 'u', invoiceUrl: null }).subject).toMatch(/^Sua mensalidade VogoChat de R\$.257,00 venceu em 15\/11\/2026$/);
  });
});
