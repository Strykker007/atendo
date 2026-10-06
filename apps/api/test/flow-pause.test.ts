import { describe, expect, it } from 'vitest';
import { planejarRetomada } from '../src/modules/flows/flow-pause';

const agora = new Date('2026-10-06T12:00:00Z').getTime();

describe('planejarRetomada', () => {
  it('pausado no meio do avanço: volta a rodar do mesmo nó', () => {
    expect(planejarRetomada({ pausedFrom: 'running', waitUntil: null }, false, agora)).toEqual({ status: 'running' });
  });

  it('esperando resposta sem prazo: só volta a esperar', () => {
    expect(planejarRetomada({ pausedFrom: 'waiting', waitUntil: null }, false, agora)).toEqual({ status: 'waiting', job: null });
  });

  it('Aguardar que ainda não venceu: reagenda o resto do tempo', () => {
    const r = planejarRetomada({ pausedFrom: 'waiting', waitUntil: new Date(agora + 90_000) }, true, agora);
    expect(r).toEqual({ status: 'waiting', job: 'resume', delayMs: 90_000 });
  });

  it('prazo que venceu durante a pausa: agenda para agora (o job original foi ignorado)', () => {
    const r = planejarRetomada({ pausedFrom: 'waiting', waitUntil: new Date(agora - 60_000) }, false, agora);
    expect(r).toEqual({ status: 'waiting', job: 'reply-timeout', delayMs: 0 });
  });
});
