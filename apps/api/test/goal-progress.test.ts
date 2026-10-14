import { describe, expect, it } from 'vitest';
import { goalProgress } from '../src/modules/goals/goal-progress';

describe('goalProgress', () => {
  it('sem meta: só o realizado', () => {
    const p = goalProgress({ revenue: 500, won: 2 }, null, 0.5);
    expect(p.attainment).toBeNull();
    expect(p.status).toBeNull();
    expect(p.revenue).toBe(500);
  });
  it('metade do mês, metade da meta = no ritmo; projeção dobra', () => {
    const p = goalProgress({ revenue: 5000, won: 5 }, { revenueTarget: 10000, wonTarget: null }, 0.5);
    expect(p.revenuePct).toBe(50);
    expect(p.status).toBe('on_track');
    expect(p.revenueProjection).toBe(10000);
  });
  it('abaixo do esperado: perto (≥ 80%) e atrás', () => {
    expect(goalProgress({ revenue: 4200, won: 0 }, { revenueTarget: 10000, wonTarget: null }, 0.5).status).toBe('close');
    expect(goalProgress({ revenue: 2000, won: 0 }, { revenueTarget: 10000, wonTarget: null }, 0.5).status).toBe('behind');
  });
  it('bateu a meta', () => {
    const p = goalProgress({ revenue: 12000, won: 3 }, { revenueTarget: 10000, wonTarget: null }, 0.7);
    expect(p.status).toBe('done');
    expect(p.revenuePct).toBe(120);
  });
  it('duas metas: atingimento é a média e o status é o pior', () => {
    const p = goalProgress({ revenue: 10000, won: 2 }, { revenueTarget: 10000, wonTarget: 10 }, 0.5);
    expect(p.attainment).toBe(60);
    expect(p.status).toBe('behind');
  });
  it('mês que ainda não começou não está atrasado', () => {
    expect(goalProgress({ revenue: 0, won: 0 }, { revenueTarget: 1000, wonTarget: null }, 0).status).toBe('on_track');
  });
});
