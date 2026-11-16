import { describe, expect, it } from 'vitest';
import { boletoFirstDueDate, cancelDeadline } from '../src/modules/billing/monthly-billing';

describe('data limite para cancelar (Asaas gera a parcela 40 dias antes)', () => {
  it('parcela de 14/12 já gerada: a próxima ainda não gerada é 14/01, cancelar até 04/12', () => {
    expect(cancelDeadline('2026-12-14', 'monthly', 40, '2026-11-16')).toEqual({ nextCharge: '2027-01-14', cancelBy: '2026-12-04' });
  });

  it('vencimento longe (geração ainda no futuro): a própria parcela é a próxima', () => {
    expect(cancelDeadline('2027-01-30', 'monthly', 40, '2026-11-16')).toEqual({ nextCharge: '2027-01-30', cancelBy: '2026-12-20' });
  });

  it('no dia da geração já não dá mais: passa para a seguinte', () => {
    // 14/01 − 40 = 05/12: em 05/12 a parcela de 14/01 nasce
    expect(cancelDeadline('2026-12-14', 'monthly', 40, '2026-12-05').nextCharge).toBe('2027-02-14');
    expect(cancelDeadline('2026-12-14', 'monthly', 40, '2026-12-04').nextCharge).toBe('2027-01-14');
  });

  it('dia 31 cai no último dia do mês curto', () => {
    expect(cancelDeadline('2026-12-31', 'monthly', 40, '2026-12-25').nextCharge).toBe('2027-02-28');
  });

  it('prazo da conta trocado para 7 dias', () => {
    expect(cancelDeadline('2026-12-14', 'monthly', 7, '2026-11-16')).toEqual({ nextCharge: '2026-12-14', cancelBy: '2026-12-06' });
  });

  it('anual anda 12 meses', () => {
    expect(cancelDeadline('2026-12-14', 'yearly', 40, '2026-11-16').nextCharge).toBe('2027-12-14');
  });
});

describe('1º vencimento do boleto', () => {
  it('mantém o vencimento do cliente quando dá tempo', () => {
    expect(boletoFirstDueDate(new Date('2026-12-10T12:00:00-03:00'), '2026-11-16')).toBe('2026-12-10');
  });
  it('vencido ou perto demais: hoje + 3 dias', () => {
    expect(boletoFirstDueDate(new Date('2026-11-09T12:00:00-03:00'), '2026-11-16')).toBe('2026-11-19');
    expect(boletoFirstDueDate(new Date('2026-11-17T12:00:00-03:00'), '2026-11-16')).toBe('2026-11-19');
  });
});
