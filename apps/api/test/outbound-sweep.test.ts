import { describe, expect, it } from 'vitest';
import { SWEEP_GRACE_MS, sweepAction } from '../src/modules/whatsapp/outbound-sweep';

const MIN = 60_000;
const now = Date.UTC(2026, 9, 26, 12, 0);
const ago = (ms: number) => new Date(now - ms);
const base = { now, maxQueueAgeMin: 30 };

describe('sweepAction — mensagem pendente sem job na fila', () => {
  it('recém-criada não é órfã (o job pode estar sendo gravado)', () => {
    expect(sweepAction({ ...base, createdAt: ago(SWEEP_GRACE_MS - 1000), queuedAt: ago(SWEEP_GRACE_MS - 1000), jobState: null })).toBe('ok');
  });

  it.each(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'])('job vivo (%s) não mexe', (jobState) => {
    expect(sweepAction({ ...base, createdAt: ago(10 * MIN), queuedAt: ago(10 * MIN), jobState })).toBe('ok');
  });

  it('sem job e dentro do prazo: volta para a fila', () => {
    expect(sweepAction({ ...base, createdAt: ago(5 * MIN), queuedAt: ago(5 * MIN), jobState: null })).toBe('requeue');
  });

  it('job terminado com a mensagem ainda pendente também é órfã', () => {
    expect(sweepAction({ ...base, createdAt: ago(5 * MIN), queuedAt: ago(5 * MIN), jobState: 'completed' })).toBe('requeue');
    expect(sweepAction({ ...base, createdAt: ago(5 * MIN), queuedAt: ago(5 * MIN), jobState: 'failed' })).toBe('requeue');
  });

  it('sem job e passou do prazo da fila: não enviada (caso de 26/10, 6 h parada)', () => {
    expect(sweepAction({ ...base, createdAt: ago(6 * 60 * MIN), queuedAt: ago(6 * 60 * MIN), jobState: null })).toBe('expire');
  });

  it('o prazo conta do queuedAt: segurada pela proteção (no futuro) volta para a fila, não expira', () => {
    expect(sweepAction({ ...base, createdAt: ago(50 * MIN), queuedAt: new Date(now + 10 * MIN), jobState: null })).toBe('requeue');
  });
});
