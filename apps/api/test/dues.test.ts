import { describe, expect, it } from 'vitest';
import { amountOf, dueState, endOfMonthBrt, groupUnits, nextPeriodEnd, payableUntil } from '../src/modules/billing/dues';

const co = (billingType: 'INDIVIDUAL' | 'CONSOLIDATED_GROUP', isActive = true) => ({ billingType, isActive });

describe('groupUnits', () => {
  it('cliente INDIVIDUAL paga uma unidade, com quantas empresas tiver', () => {
    expect(groupUnits('INDIVIDUAL', [co('CONSOLIDATED_GROUP'), co('CONSOLIDATED_GROUP')])).toBe(1);
  });
  it('grupo conta só as ativas que herdam a assinatura', () => {
    expect(groupUnits('CONSOLIDATED_GROUP', [co('CONSOLIDATED_GROUP'), co('CONSOLIDATED_GROUP'), co('INDIVIDUAL'), co('CONSOLIDATED_GROUP', false)])).toBe(2);
  });
  it('grupo sem empresas paga ao menos uma unidade', () => {
    expect(groupUnits('CONSOLIDATED_GROUP', [])).toBe(1);
  });
});

describe('amountOf', () => {
  it('multiplica por unidades e anualiza', () => {
    expect(amountOf(99.9, 'monthly', 3)).toBe(299.7);
    expect(amountOf(50, 'yearly')).toBe(600);
  });
});

describe('vencimentos', () => {
  const now = new Date('2026-10-08T15:00:00Z');
  it('classifica atrasado, a vencer e em dia', () => {
    expect(dueState(new Date('2026-10-07T15:00:00Z'), now)).toBe('overdue');
    expect(dueState(new Date('2026-10-14T15:00:00Z'), now)).toBe('due_soon');
    expect(dueState(new Date('2026-10-30T15:00:00Z'), now)).toBe('ok');
  });
  it('próximo vencimento anda a partir do vencimento, não de hoje', () => {
    expect(nextPeriodEnd(new Date('2026-09-10T12:00:00Z'), 'monthly').toISOString()).toBe('2026-10-10T12:00:00.000Z');
  });
  it('dá para pagar o que vence no mês ou nos próximos 7 dias', () => {
    expect(endOfMonthBrt(now).toISOString()).toBe('2026-11-01T02:59:59.999Z');
    const fimDoMes = new Date('2026-10-28T12:00:00Z');
    expect(payableUntil(fimDoMes).getTime()).toBe(fimDoMes.getTime() + 7 * 86_400_000);
  });
});
