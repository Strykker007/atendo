import { describe, expect, it } from 'vitest';
import { allocateByRevenue, allocateInfra, marginOf } from '../src/modules/billing/client-costs';

describe('allocateInfra', () => {
  it('divide o lançado no mês por número conectado', () => {
    const r = allocateInfra(300, [{ tenantId: 'a', manual: 0 }, { tenantId: 'a', manual: 0 }, { tenantId: 'b', manual: 0 }]);
    expect(r.perNumber).toBe(100);
    expect(r.byTenant).toEqual({ a: 200, b: 100 });
  });
  it('custo manual vale como exceção e sai da divisão', () => {
    const r = allocateInfra(300, [{ tenantId: 'a', manual: 120 }, { tenantId: 'b', manual: 0 }, { tenantId: 'c', manual: 0 }]);
    expect(r.byTenant).toEqual({ a: 120, b: 90, c: 90 });
  });
  it('sem lançamento de infra no mês: só os manuais', () => {
    expect(allocateInfra(0, [{ tenantId: 'a', manual: 50 }, { tenantId: 'b', manual: 0 }]).byTenant).toEqual({ a: 50, b: 0 });
  });
});

describe('allocateByRevenue', () => {
  it('proporcional ao recebido; a parte das outras entradas não vai para cliente', () => {
    // imposto de 60 sobre 1000 de base (800 de clientes + 200 de outras entradas)
    expect(allocateByRevenue(60, { a: 600, b: 200, c: 0 }, 1000)).toEqual({ a: 36, b: 12 });
  });
  it('nada a dividir = vazio', () => {
    expect(allocateByRevenue(0, { a: 100 }, 100)).toEqual({});
    expect(allocateByRevenue(10, { a: 0 }, 0)).toEqual({});
  });
});

describe('marginOf', () => {
  it('soma os custos e calcula a margem sobre o recebido', () => {
    expect(marginOf({ received: 200, infra: 30, ai: 5, commission: 20, taxes: 12, fees: 3, planCost: 0 })).toEqual({ cost: 70, margin: 130, marginPct: 65 });
  });
  it('cliente sem pagamento no mês: margem negativa e % nula', () => {
    expect(marginOf({ received: 0, infra: 30, ai: 0, commission: 0, taxes: 0, fees: 0, planCost: 0 })).toEqual({ cost: 30, margin: -30, marginPct: null });
  });
});
