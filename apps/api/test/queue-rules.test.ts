import { describe, expect, it } from 'vitest';
import { pauseExpired, pickQueueAgent } from '../src/modules/attendance-queue/queue-rules';

describe('pickQueueAgent', () => {
  it('quem chegou no limite não recebe (exemplo: limite 4)', () => {
    // vendedor 1 com 4, vendedor 2 com 2: só o 2 recebe
    expect(pickQueueAgent(['v1', 'v2'], { v1: 4, v2: 2 }, 4)).toBe('v2');
  });
  it('todo mundo no limite: fica na fila', () => {
    expect(pickQueueAgent(['v1', 'v2'], { v1: 4, v2: 4 }, 4)).toBeUndefined();
    expect(pickQueueAgent([], {}, 4)).toBeUndefined();
  });
  it('vai para quem tem menos (por igual)', () => {
    expect(pickQueueAgent(['a', 'b', 'c'], { a: 3, b: 1, c: 2 }, 4)).toBe('b');
  });
  it('empate é sorteado, não por ordem', () => {
    expect(pickQueueAgent(['a', 'b', 'c'], {}, 4, () => 0)).toBe('a');
    expect(pickQueueAgent(['a', 'b', 'c'], {}, 4, () => 0.5)).toBe('b');
    expect(pickQueueAgent(['a', 'b', 'c'], {}, 4, () => 0.99)).toBe('c');
  });
  it('fila de 5 com v1=4 e v2=2 (limite 4): v2 recebe 2 e sobram 3 na fila', () => {
    const open: Record<string, number> = { v1: 4, v2: 2 };
    let entregues = 0;
    for (let i = 0; i < 5; i++) {
      const quem = pickQueueAgent(['v1', 'v2'], open, 4);
      if (!quem) continue;
      open[quem]++;
      entregues++;
    }
    expect(entregues).toBe(2);
    expect(open).toEqual({ v1: 4, v2: 4 });
  });
});

describe('pauseExpired', () => {
  const agora = new Date('2026-11-06T12:00:00Z');
  it('sem prazo nunca vence', () => expect(pauseExpired(null, agora)).toBe(false));
  it('prazo passou', () => expect(pauseExpired(new Date('2026-11-06T11:59:00Z'), agora)).toBe(true));
  it('prazo ainda não chegou', () => expect(pauseExpired(new Date('2026-11-06T12:10:00Z'), agora)).toBe(false));
});
