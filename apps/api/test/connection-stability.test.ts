import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import { NumberStatus } from '@atendo/shared';
import {
  EVOLUTION_MEDIA_TIMEOUT_MS,
  EVOLUTION_TIMEOUT_MS,
  EvolutionProvider,
  evolutionFetchError,
  evolutionTimeoutMs,
} from '../src/modules/whatsapp/providers/evolution.provider';
import { isTransientSendError, ProviderTimeoutError } from '../src/modules/whatsapp/providers/provider-error';
import { connKeys, eventTime, isDefinitiveClose, MAX_EVENT_LAG_MS, ORDER_LUA, orderDecision } from '../src/modules/whatsapp/connection-events';
import { nextProbeState, PROBE_AFTER_SILENCE_MS, shouldProbe } from '../src/modules/whatsapp/session-probe';

const provider = new EvolutionProvider();
const INSTANCE = 'tenant-1-num-1';

// ---------- 1. timeouts ----------

describe('prazo das chamadas à Evolution', () => {
  it('rotas comuns 15 s; mídia, agenda, grupos e restart 60 s', () => {
    expect(evolutionTimeoutMs('/instance/connectionState/x')).toBe(EVOLUTION_TIMEOUT_MS);
    expect(evolutionTimeoutMs('/message/sendText/x')).toBe(EVOLUTION_TIMEOUT_MS);
    for (const p of ['/message/sendMedia/x', '/message/sendWhatsAppAudio/x', '/chat/getBase64FromMediaMessage/x', '/chat/findContacts/x', '/group/fetchAllGroups/x?getParticipants=false', '/instance/restart/x']) {
      expect(evolutionTimeoutMs(p)).toBe(EVOLUTION_MEDIA_TIMEOUT_MS);
    }
  });

  it('o "digitando…" (delay) que a Evolution segura soma ao prazo', () => {
    expect(evolutionTimeoutMs('/message/sendText/x', 4_000)).toBe(EVOLUTION_TIMEOUT_MS + 4_000);
    expect(evolutionTimeoutMs('/message/sendMedia/x', 2_500)).toBe(EVOLUTION_MEDIA_TIMEOUT_MS + 2_500);
    expect(evolutionTimeoutMs('/message/sendText/x', -5)).toBe(EVOLUTION_TIMEOUT_MS);
  });

  // servidor local que aceita e nunca responde: o erro real do fetch do Node
  const hanging = () => new Promise<Server>((resolve) => { const s = createServer(() => {}); s.listen(0, '127.0.0.1', () => resolve(s)); });

  it('prazo estourado vira ProviderTimeoutError — ambíguo, nunca reenviado', async () => {
    const s = await hanging();
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/message/sendText/x`;
    const err = await fetch(url, { signal: AbortSignal.timeout(50) }).then(() => null, (e) => e);
    s.closeAllConnections(); s.close();
    const mapped = evolutionFetchError(err, '/message/sendText/x', 15_000);
    expect(mapped).toBeInstanceOf(ProviderTimeoutError);
    expect(mapped.message).toMatch(/não respondeu em 15 s \(message\/sendText\)/);
    expect(isTransientSendError(mapped)).toBe(false);
    expect((mapped as ProviderTimeoutError).getStatus()).toBe(504);
  });

  it('conexão recusada (Evolution fora do ar) é transitória: a requisição nem chegou', async () => {
    const s = await hanging();
    const port = (s.address() as AddressInfo).port;
    await new Promise((r) => s.close(r));
    const err = await fetch(`http://127.0.0.1:${port}/x`).then(() => null, (e) => e);
    const mapped = evolutionFetchError(err, '/message/sendText/x', 15_000);
    expect(mapped.message).toMatch(/Evolution indisponível \(ECONNREFUSED\)/);
    expect(isTransientSendError(mapped)).toBe(true);
  });

  it('outros erros passam como estão (classificação anterior mantida)', () => {
    const e = new Error('qualquer');
    expect(evolutionFetchError(e, '/x/y', 1000)).toBe(e);
  });
});

// ---------- 3. códigos de fechamento ----------

describe('connection.update: fechamento definitivo × recuperável', () => {
  const parse = (data: object, extra: object = {}) => provider.parseWebhook({ event: 'connection.update', instance: INSTANCE, data, ...extra }).connection!;

  it.each([401, 402, 403, 406])('close %i é definitivo (precisa de QR) e vira loggedOut', (code) => {
    const c = parse({ state: 'close', statusReason: code });
    expect(c).toMatchObject({ status: NumberStatus.DISCONNECTED, loggedOut: true, statusReason: code, state: 'close' });
  });

  it.each([408, 428, 440, 500, 515])('close %i não é definitivo', (code) => {
    expect(parse({ state: 'close', statusReason: code }).loggedOut).toBe(false);
  });

  it('open traz o 200 e o date_time do webhook', () => {
    const c = parse({ state: 'open', statusReason: 200, wuid: '5562999998888@s.whatsapp.net' }, { date_time: '2026-10-18T09:00:00.123Z' });
    expect(c).toMatchObject({ status: NumberStatus.CONNECTED, statusReason: 200, at: '2026-10-18T09:00:00.123Z', loggedOut: false });
  });

  it('statusReason ausente ou inválido não quebra', () => {
    expect(parse({ state: 'close' })).toMatchObject({ loggedOut: false, statusReason: undefined });
    expect(parse({ state: 'close', statusReason: 'x' }).statusReason).toBeUndefined();
  });

  it('isDefinitiveClose só vale para close', () => {
    expect(isDefinitiveClose('open', 401)).toBe(false);
    expect(isDefinitiveClose('close', undefined)).toBe(false);
  });
});

// ---------- 5. evento atrasado ----------

describe('ordem dos connection.update', () => {
  const t = (iso: string) => eventTime(iso)!;

  it('evento mais velho que o último aplicado é ignorado', () => {
    expect(orderDecision({ at: t('2026-10-18T09:00:00Z'), lastAt: t('2026-10-18T09:00:05Z') })).toEqual({ apply: false, reason: 'older_than_last' });
  });

  it('mais novo ou empatado aplica', () => {
    expect(orderDecision({ at: t('2026-10-18T09:00:05Z'), lastAt: t('2026-10-18T09:00:00Z') }).apply).toBe(true);
    expect(orderDecision({ at: t('2026-10-18T09:00:00Z'), lastAt: t('2026-10-18T09:00:00Z') }).apply).toBe(true);
    expect(orderDecision({ at: t('2026-10-18T09:00:00Z'), lastAt: null }).apply).toBe(true);
  });

  it('diferença maior que a janela de retentativa = relógio da Evolution voltou: aplica', () => {
    const last = t('2026-10-18T12:00:00Z');
    expect(orderDecision({ at: last - MAX_EVENT_LAG_MS, lastAt: last }).apply).toBe(false);
    expect(orderDecision({ at: last - MAX_EVENT_LAG_MS - 1, lastAt: last }).apply).toBe(true);
  });

  it('sem date_time aplica (como antes), marcando o motivo', () => {
    expect(orderDecision({ at: null, lastAt: 123 })).toEqual({ apply: true, reason: 'no_timestamp' });
    expect(eventTime(undefined)).toBeNull();
    expect(eventTime('lixo')).toBeNull();
  });

  it('webhook que chegou antes da correção do health check é velho', () => {
    expect(orderDecision({ at: 1, lastAt: null, receivedAt: 1_000, healthAt: 2_000 })).toEqual({ apply: false, reason: 'older_than_health_check' });
    expect(orderDecision({ at: 1, lastAt: null, receivedAt: 3_000, healthAt: 2_000 }).apply).toBe(true);
  });

  // Lua real: só com REDIS_TEST_URL (os testes não sobem Redis — test/setup.ts)
  it.skipIf(!process.env.REDIS_TEST_URL)('script Lua: compara e grava num passo só', async () => {
    const r = new Redis(process.env.REDIS_TEST_URL!);
    const k = connKeys.lastAt(`teste-${Date.now()}`);
    try {
      const lag = MAX_EVENT_LAG_MS;
      const base = 10 * lag;
      expect(await r.eval(ORDER_LUA, 1, k, base, 60, lag)).toEqual([1, '']);
      expect(await r.eval(ORDER_LUA, 1, k, base - 1000, 60, lag)).toEqual([0, String(base)]); // atrasado
      expect(await r.get(k)).toBe(String(base));
      expect(await r.eval(ORDER_LUA, 1, k, base, 60, lag)).toEqual([1, String(base)]); // empate aplica
      expect(await r.eval(ORDER_LUA, 1, k, base + 1000, 60, lag)).toEqual([1, String(base)]);
      expect(await r.eval(ORDER_LUA, 1, k, base - 2 * lag, 60, lag)).toEqual([1, String(base + 1000)]); // relógio voltou
      expect(await r.get(k)).toBe(String(base - 2 * lag));
      expect(await r.ttl(k)).toBeGreaterThan(0);
    } finally {
      await r.del(k);
      r.disconnect();
    }
  });
});

// ---------- 6. sonda de sessão ----------

describe('sonda de sessão "conectada mas inoperante"', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('só sonda número quieto há 30 min ou sem sinal conhecido', () => {
    expect(shouldProbe(null)).toBe(true);
    expect(shouldProbe(PROBE_AFTER_SILENCE_MS)).toBe(true);
    expect(shouldProbe(PROBE_AFTER_SILENCE_MS - 1)).toBe(false);
  });

  it('marca na 2ª falha seguida, avisa uma vez e desmarca quando responde', () => {
    let s = nextProbeState(null, false, now, 'timeout');
    expect(s).toMatchObject({ event: null, state: { fails: 1 } });
    s = nextProbeState(s.state, false, now, 'timeout');
    expect(s.event).toBe('flagged');
    expect(s.state.flaggedAt).toBe(now.toISOString());
    s = nextProbeState(s.state, false, now, 'timeout');
    expect(s.event).toBeNull(); // não repete o aviso
    expect(s.state.fails).toBe(3);
    s = nextProbeState(s.state, true, now);
    expect(s).toEqual({ event: 'recovered', state: { fails: 0, lastOkAt: now.toISOString() } });
  });

  it('falha isolada seguida de sucesso não avisa nada', () => {
    const f = nextProbeState(null, false, now);
    expect(nextProbeState(f.state, true, now).event).toBeNull();
  });
});
