import { describe, expect, it } from 'vitest';
import { planRemoval } from '../src/modules/whatsapp/number-removal';

const t0 = new Date('2026-10-06T19:09:00Z');
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);

describe('planRemoval', () => {
  it('primeira queda: pausa de 2h', () => {
    const r = planRemoval({ waRemovedAt: null, waRemovedCount: 0 }, t0);
    expect(r.waRemovedCount).toBe(1);
    expect(r.reconnectBlockedUntil).toEqual(h(2));
  });
  it('nova queda dentro de 24h: conta como repetida e pausa 24h', () => {
    const r = planRemoval({ waRemovedAt: t0, waRemovedCount: 1 }, h(17));
    expect(r.waRemovedCount).toBe(2);
    expect(r.reconnectBlockedUntil).toEqual(h(17 + 24));
  });
  it('queda depois de 24h recomeça a contagem', () => {
    const r = planRemoval({ waRemovedAt: t0, waRemovedCount: 3 }, h(30));
    expect(r.waRemovedCount).toBe(1);
    expect(r.reconnectBlockedUntil).toEqual(h(32));
  });
});
