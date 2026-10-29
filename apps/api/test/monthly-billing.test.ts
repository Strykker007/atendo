import { describe, expect, it } from 'vitest';
import { diasEntre, enrollSkip, firstDueDate, qrSignature, qrSignatureOk, reminderKind, reminderMail } from '../src/modules/billing/monthly-billing';

const CNPJ = '60.943.778/0001-66';
const manual = { gateway: null, status: 'active', billingCycle: 'monthly', isFree: false, value: 297, document: CNPJ };

describe('mensalidade por Pix — quem migra', () => {
  it('cobrança manual, plano pago mensal, ativo e com CNPJ válido: migra', () => {
    expect(enrollSkip(manual)).toBeNull();
    expect(enrollSkip({ ...manual, status: 'trialing' })).toBeNull();
    expect(enrollSkip({ ...manual, status: 'past_due' })).toBeNull();
  });

  it('fica de fora: já tem gateway, gratuito/personalizado, sem valor, suspenso, sem documento', () => {
    expect(enrollSkip({ ...manual, gateway: 'asaas' })).toBe('already');
    expect(enrollSkip({ ...manual, gateway: 'stripe' })).toBe('already');
    expect(enrollSkip({ ...manual, isFree: true })).toBe('free');
    expect(enrollSkip({ ...manual, billingCycle: 'custom' })).toBe('free');
    expect(enrollSkip({ ...manual, value: 0 })).toBe('no_price');
    expect(enrollSkip({ ...manual, status: 'suspended' })).toBe('not_live');
    expect(enrollSkip({ ...manual, status: 'canceled' })).toBe('not_live');
    expect(enrollSkip({ ...manual, document: null })).toBe('no_document');
    // dígito verificador errado não vai para o Asaas
    expect(enrollSkip({ ...manual, document: '60.943.778/0001-67' })).toBe('no_document');
  });

  it('1º vencimento no Asaas = o que o cliente já tinha; atrasado vira hoje', () => {
    expect(firstDueDate(new Date('2026-11-12T03:00:00Z'), '2026-10-29')).toBe('2026-11-12');
    expect(firstDueDate(new Date('2026-10-20T03:00:00Z'), '2026-10-29')).toBe('2026-10-29');
    // 23h em Brasília ainda é o mesmo dia (não pula para o seguinte pelo UTC)
    expect(firstDueDate(new Date('2026-11-13T02:00:00Z'), '2026-10-29')).toBe('2026-11-12');
  });
});

describe('mensalidade por Pix — lembretes', () => {
  const nada = { soon: false, due: false };
  it('"em breve" de 5 dias antes até a véspera, uma vez só', () => {
    expect(diasEntre('2026-11-07', '2026-11-12')).toBe(5);
    expect(reminderKind('2026-11-06', '2026-11-12', nada)).toBeNull();
    expect(reminderKind('2026-11-07', '2026-11-12', nada)).toBe('soon');
    // migrou com o vencimento a 3 dias: recebe já
    expect(reminderKind('2026-11-09', '2026-11-12', nada)).toBe('soon');
    expect(reminderKind('2026-11-09', '2026-11-12', { soon: true, due: false })).toBeNull();
  });

  it('"vence hoje" no dia, uma vez só; vencida fica com o aviso de atraso', () => {
    expect(reminderKind('2026-11-12', '2026-11-12', { soon: true, due: false })).toBe('due');
    expect(reminderKind('2026-11-12', '2026-11-12', { soon: true, due: true })).toBeNull();
    expect(reminderKind('2026-11-13', '2026-11-12', nada)).toBeNull();
  });

  it('e-mail com valor, vencimento, QR e o Pix copia e cola', () => {
    // o real formatado usa espaço não separável ("R$ 297,00"): compara como texto comum
    const sp = (t: string) => t.replace(/\u00a0/g, ' ');
    const r = reminderMail({ brand: 'VogoChat', kind: 'soon', value: 297, dueDate: '2026-11-12', pixPayload: '00020126580014br.gov.bcb.pix', qrUrl: 'https://api.x/billing/pix/pay_1/qr.png?s=abc', payUrl: 'https://app.x/plano?pagar=1', invoiceUrl: 'https://asaas/i/1' });
    const m = { subject: sp(r.subject), text: sp(r.text), html: sp(r.html) };
    expect(m.subject).toBe('Sua mensalidade VogoChat de R$ 297,00 vence em 12/11/2026');
    for (const parte of ['R$ 297,00', '12/11/2026', '00020126580014br.gov.bcb.pix', 'https://app.x/plano?pagar=1']) {
      expect(m.text).toContain(parte);
      expect(m.html).toContain(parte);
    }
    expect(m.html).toContain('<img src="https://api.x/billing/pix/pay_1/qr.png?s=abc"');
    expect(reminderMail({ brand: 'VogoChat', kind: 'due', value: 297, dueDate: '2026-11-12', pixPayload: null, qrUrl: null, payUrl: 'u', invoiceUrl: null }).subject).toContain('vence hoje');
  });

  it('URL do QR só abre com a assinatura daquela cobrança', () => {
    const sig = qrSignature('segredo', 'pay_1');
    expect(qrSignatureOk('segredo', 'pay_1', sig)).toBe(true);
    expect(qrSignatureOk('segredo', 'pay_2', sig)).toBe(false);
    expect(qrSignatureOk('outro', 'pay_1', sig)).toBe(false);
    expect(qrSignatureOk('segredo', 'pay_1', undefined)).toBe(false);
  });
});
