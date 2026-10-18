import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import { NumberStatus } from '@atendo/shared';
import {
  connectionOrder,
  EVOLUTION_MEDIA_TIMEOUT_MS,
  EVOLUTION_TIMEOUT_MS,
  EvolutionProvider,
  evolutionFetchError,
  evolutionTimeoutMs,
} from '../src/modules/whatsapp/providers/evolution.provider';
import { isTransientSendError, ProviderTimeoutError } from '../src/modules/whatsapp/providers/provider-error';
import { BOOT_SWITCH_WINDOW_MS, connKeys, eventTime, isDefinitiveClose, ORDER_LUA, ORDER_SEQ_LUA, orderDecision, parseStoredOrder } from '../src/modules/whatsapp/connection-events';
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

  it('sem carimbo, date_time mais velho NUNCA sobrescreve (sem atalho por diferença de horário)', () => {
    const last = t('2026-10-18T12:00:00Z');
    expect(orderDecision({ at: last - 10 * 3_600_000, lastAt: last })).toEqual({ apply: false, reason: 'older_than_last' });
  });

  // carimbo da guarda de conexão (docs/29)
  const o = (boot: number, seq: number) => ({ boot, seq });
  it('com carimbo: (boot, seq) estritamente crescente; igual é retentativa duplicada', () => {
    expect(orderDecision({ order: o(5, 10), lastOrder: o(5, 9), at: null, lastAt: null }).apply).toBe(true);
    expect(orderDecision({ order: o(5, 9), lastOrder: o(5, 10), at: null, lastAt: null })).toEqual({ apply: false, reason: 'older_than_last' });
    expect(orderDecision({ order: o(5, 10), lastOrder: o(5, 10), at: null, lastAt: null })).toEqual({ apply: false, reason: 'duplicate' });
    expect(orderDecision({ order: o(6, 1), lastOrder: o(5, 900), at: null, lastAt: null }).apply).toBe(true); // processo novo
  });

  it('com carimbo, o date_time não importa (relógio da Evolution pode estar errado)', () => {
    expect(orderDecision({ order: o(5, 11), lastOrder: o(5, 10), at: 1, lastAt: 9_999_999 }).apply).toBe(true);
  });

  it('boot anterior: atrasado enquanto o processo antigo podia estar vivo; depois, contador recomeçado', () => {
    const seenAt = 1_000_000;
    const last = { ...o(9, 3), seenAt };
    expect(orderDecision({ order: o(8, 50), lastOrder: last, at: null, lastAt: null, receivedAt: seenAt + 60_000 })).toEqual({ apply: false, reason: 'older_than_last' });
    expect(orderDecision({ order: o(1, 1), lastOrder: last, at: null, lastAt: null, receivedAt: seenAt + BOOT_SWITCH_WINDOW_MS + 1 })).toEqual({ apply: true, reason: 'boot_reset' });
  });

  it('parser lê o carimbo; sem ele (imagem antiga) cai no date_time', () => {
    expect(connectionOrder({ atendoBoot: 1760000000, atendoSeq: 42, atendoGen: 3 })).toEqual({ boot: 1760000000, seq: 42, gen: 3 });
    expect(connectionOrder({ state: 'open' })).toBeUndefined();
    expect(connectionOrder({ atendoBoot: 'x', atendoSeq: 1 })).toBeUndefined();
    expect(connectionOrder({ atendoBoot: 1, atendoSeq: -1 })).toBeUndefined();
    const c = provider.parseWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'open', statusReason: 200, atendoBoot: 7, atendoSeq: 9, atendoGen: 2 } }).connection!;
    expect(c.order).toEqual({ boot: 7, seq: 9, gen: 2 });
  });

  it('parseStoredOrder', () => {
    expect(parseStoredOrder('7:9:123')).toEqual({ boot: 7, seq: 9, seenAt: 123 });
    expect(parseStoredOrder('')).toBeNull();
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
  it.skipIf(!process.env.REDIS_TEST_URL)('Lua do date_time: estrito, sem atalho', async () => {
    const r = new Redis(process.env.REDIS_TEST_URL!);
    const k = connKeys.lastAt(`teste-${Date.now()}`);
    try {
      expect(await r.eval(ORDER_LUA, 1, k, 5_000_000, 60)).toEqual([1, '']);
      expect(await r.eval(ORDER_LUA, 1, k, 4_000_000, 60)).toEqual([0, '5000000']);
      expect(await r.eval(ORDER_LUA, 1, k, 1, 60)).toEqual([0, '5000000']); // muito mais velho também não
      expect(await r.eval(ORDER_LUA, 1, k, 5_000_000, 60)).toEqual([1, '5000000']); // empate aplica
      expect(await r.ttl(k)).toBeGreaterThan(0);
    } finally { await r.del(k); r.disconnect(); }
  });

  it.skipIf(!process.env.REDIS_TEST_URL)('Lua do carimbo: mesma regra da função pura', async () => {
    const r = new Redis(process.env.REDIS_TEST_URL!);
    const k = connKeys.lastOrder(`teste-${Date.now()}`);
    const W = BOOT_SWITCH_WINDOW_MS;
    const ev = (boot: number, seq: number, now: number) => r.eval(ORDER_SEQ_LUA, 1, k, boot, seq, now, 60, W);
    try {
      expect(await ev(9, 3, 1_000)).toEqual([1, '']);
      expect(await r.get(k)).toBe('9:3:1000');
      expect(await ev(9, 3, 2_000)).toEqual([0, '9:3:1000']); // duplicata
      expect(await ev(9, 2, 2_000)).toEqual([0, '9:3:1000']); // atrasado
      expect(await ev(9, 4, 3_000)).toEqual([1, '9:3:1000']);
      expect(await r.get(k)).toBe('9:4:1000'); // seenAt é de quando o boot apareceu
      expect(await ev(8, 99, 1_000 + W)).toEqual([0, '9:4:1000']); // boot velho dentro da janela (conta do seenAt)
      expect(await ev(10, 1, 5_000)).toEqual([1, '9:4:1000']); // processo novo
      expect(await r.get(k)).toBe('10:1:5000');
      expect(await ev(1, 1, 5_000 + W + 1)).toEqual([1, '10:1:5000']); // contador recomeçou
      expect(await r.get(k)).toBe(`1:1:${5_000 + W + 1}`);
      expect(await r.ttl(k)).toBeGreaterThan(0);
    } finally { await r.del(k); r.disconnect(); }
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
