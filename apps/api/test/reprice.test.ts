import { describe, expect, it } from 'vitest';
import { aReajustar, dataDoReajuste, venceu, type AssinaturaParaReajuste } from '../src/modules/billing/reprice';

const sub = (id: string, priceMonth: number | null, status = 'active'): AssinaturaParaReajuste => ({ id, status, priceMonth });

describe('aReajustar', () => {
  it('pega quem paga menos que o preço novo', () => {
    const r = aReajustar([sub('a', 97), sub('b', 147)], 147);
    expect(r.map((x) => x.id)).toEqual(['a']);
  });

  it('não mexe em quem já está no preço novo — e-mail de reajuste sem reajuste queima confiança', () => {
    expect(aReajustar([sub('a', 147)], 147)).toEqual([]);
  });

  it('preço nunca registrado conta como já estando no do plano', () => {
    expect(aReajustar([sub('a', null)], 147)).toEqual([]);
  });

  it('também pega redução de preço: o dono pode baixar e querer passar a todos', () => {
    expect(aReajustar([sub('a', 297)], 147).map((x) => x.id)).toEqual(['a']);
  });

  it.each([['trialing'], ['active'], ['past_due'], ['suspended']])('assinatura viva entra (%s)', (status) => {
    expect(aReajustar([sub('a', 97, status)], 147)).toHaveLength(1);
  });

  it('cancelada fica de fora', () => {
    expect(aReajustar([sub('a', 97, 'canceled')], 147)).toEqual([]);
  });
});

describe('dataDoReajuste', () => {
  const agora = new Date('2026-10-03T12:00:00Z');

  it('soma o aviso prévio', () => {
    expect(dataDoReajuste(30, agora).toISOString().slice(0, 10)).toBe('2026-11-02');
  });

  it('zero dias vale a partir de agora', () => {
    expect(dataDoReajuste(0, agora).getTime()).toBe(agora.getTime());
  });

  it('dias negativos não viram data no passado', () => {
    expect(dataDoReajuste(-10, agora).getTime()).toBe(agora.getTime());
  });
});

describe('venceu', () => {
  const agora = new Date('2026-10-03T12:00:00Z');
  it('sem data agendada, nada vence', () => {
    expect(venceu(null, agora)).toBe(false);
    expect(venceu(undefined, agora)).toBe(false);
  });
  it('data no futuro ainda não', () => {
    expect(venceu(new Date('2026-10-04T00:00:00Z'), agora)).toBe(false);
  });
  it('data no passado ou exata vence', () => {
    expect(venceu(new Date('2026-10-02T00:00:00Z'), agora)).toBe(true);
    expect(venceu(agora, agora)).toBe(true);
  });
});
