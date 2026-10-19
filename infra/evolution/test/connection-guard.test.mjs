// Testes da guarda de conexão (docs/29-reconexao-evolution.md). Relógio e timers falsos, sem rede e
// sem WhatsApp. A instância falsa imita a Evolution 2.3.7 com os patches: o `__atendoConnect`
// original chama createClient, que aposenta o socket anterior (retire) e numera o novo (adopt); os
// eventos do socket passam por filterStale e pelo connectionUpdate patcheado (onClose/onOpen).
//   node --test infra/evolution/test/connection-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GUARD = process.env.ATENDO_GUARD_PATH ?? new URL('../atendo/connection-guard.cjs', import.meta.url).pathname;
const { createGuard } = require(GUARD);

const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

function fakeClock(start = 1_760_000_000_000) {
  let t = start;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = ++id; timers.set(h, { at: t + Math.max(0, ms), fn }); return h; },
    clearTimer: (h) => { timers.delete(h); },
    pending: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        let next = null;
        for (const [h, v] of timers) if (v.at <= end && (!next || v.at < next[1].at)) next = [h, v];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
      await flush();
    },
  };
}

function setup({ random = () => 0.5, config } = {}) {
  const clock = fakeClock();
  const logs = [];
  const guard = createGuard({ now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random, log: (e) => logs.push({ ...e, t: clock.now() }), boot: 7, config });
  const creations = [];
  let maxRunning = 0;

  function makeInst(name, { createMs = 0, onCreate, hang = false, wuid = '5511999990000@s.whatsapp.net' } = {}) {
    const creds = { me: { id: 'eu' }, noiseKey: 'k' };
    const inst = {
      instance: { name, qrcode: { count: 0 }, wuid },
      stateConnection: { state: 'close' },
      phoneNumber: undefined,
      client: null,
      creds,
      calls: { logout: 0, removeCreds: 0 },
      logoutInstance() { inst.calls.logout += 1; },
      authState: { removeCreds() { inst.calls.removeCreds += 1; } },
      async __atendoConnect() {
        maxRunning = Math.max(maxRunning, guard._running());
        if (hang) return new Promise(() => {});
        if (createMs) await new Promise((r) => clock.setTimer(r, createMs));
        guard.retire(inst); // createClient patcheado
        const sock = makeSock();
        inst.client = sock;
        guard.adopt(inst);
        inst.stateConnection = { state: 'connecting', ...guard.stamp(inst) };
        creations.push({ name, at: clock.now(), gen: sock.__atendoGen });
        onCreate?.(inst, sock);
        return sock;
      },
    };
    return inst;
  }
  function makeSock() {
    const sock = {
      ended: false,
      ws: { isOpen: false, isConnecting: true, close() { this.isOpen = false; this.isConnecting = false; } },
      end() { sock.ended = true; sock.ws.isOpen = false; sock.ws.isConnecting = false; },
    };
    return sock;
  }
  /** evento connection.update emitido pelo socket `sock` (como o ev.process + connectionUpdate patcheado) */
  function emit(inst, sock, update) {
    const events = { 'connection.update': update };
    guard.filterStale(inst, sock, events);
    const u = events['connection.update'];
    if (!u) return false;
    const code = u.lastDisconnect?.error?.output?.statusCode;
    inst.stateConnection = { state: u.connection, statusReason: code ?? 200, ...guard.stamp(inst) };
    if (u.connection === 'open') { sock.ws.isOpen = true; sock.ws.isConnecting = false; guard.onOpen(inst); }
    if (u.connection === 'close') {
      sock.ws.isOpen = false; sock.ws.isConnecting = false;
      if ([401, 402, 403, 406].includes(code)) guard.onDefinitiveClose(inst, code, u.lastDisconnect);
      else guard.onClose(inst, code, u.lastDisconnect);
    }
    return true;
  }
  const close = (code, message = 'Connection Closed', extra = {}) => ({ connection: 'close', lastDisconnect: { error: { message, output: { statusCode: code }, ...extra } } });
  const open = { connection: 'open' };
  const scheduled = (name) => logs.filter((l) => l.evt === 'reconnect.scheduled' && l.instance === name);
  return { clock, guard, logs, creations, makeInst, emit, close, open, scheduled, maxRunning: () => maxRunning };
}

const credsIntact = (inst) => {
  assert.equal(inst.calls.logout, 0, 'a guarda nunca faz logout');
  assert.equal(inst.calls.removeCreds, 0, 'a guarda nunca remove credenciais');
  assert.deepEqual(inst.creds, { me: { id: 'eu' }, noiseKey: 'k' });
};

// ---------------------------------------------------------------------------

test('conexões simultâneas: uma criação, todos recebem o mesmo socket', async () => {
  const h = setup();
  const inst = h.makeInst('a', { createMs: 500 });
  const ps = Array.from({ length: 5 }, () => h.guard.connect(inst, undefined, 'api'));
  await h.clock.advance(1_000);
  const socks = await Promise.all(ps);
  assert.equal(h.creations.length, 1);
  assert.ok(socks.every((s) => s === socks[0]));
  assert.equal(h.logs.filter((l) => l.evt === 'connect.joined').length, 4);
  credsIntact(inst);
});

test('connect da API com socket vivo não cria outro (era o "conflict: replaced")', async () => {
  const h = setup();
  const inst = h.makeInst('a');
  const s1 = await h.guard.connect(inst);
  h.emit(inst, s1, h.open);
  const s2 = await h.guard.connect(inst, undefined, 'api');
  assert.equal(s2, s1);
  assert.equal(h.creations.length, 1);
});

test('dois restarts concorrentes: um socket novo, o antigo aposentado e encerrado', async () => {
  const h = setup();
  const inst = h.makeInst('a', { createMs: 200 });
  const p0 = h.guard.connect(inst); await h.clock.advance(300); const s1 = await p0;
  h.emit(inst, s1, h.open);
  await h.clock.advance(10_000);
  const [r1, r2] = [h.guard.restart(inst), h.guard.restart(inst)];
  await h.clock.advance(300);
  const [a, b] = await Promise.all([r1, r2]);
  assert.equal(a, b);
  assert.equal(h.creations.length, 2);
  assert.equal(s1.__atendoRetired, true);
  assert.equal(s1.ended, true);
  // terceiro restart logo em seguida: socket recém-criado, nada de criar outro
  await h.guard.restart(inst);
  assert.equal(h.creations.length, 2);
  assert.ok(h.logs.some((l) => l.evt === 'restart.skipped'));
});

test('reconexão agendada disparando durante a criação do socket: junta-se à operação', async () => {
  const h = setup();
  const inst = h.makeInst('a', { createMs: 3_000 });
  const s1 = await (async () => { const p = h.guard.connect(inst); await h.clock.advance(3_000); return p; })();
  h.emit(inst, s1, h.open);
  await h.clock.advance(10_000); // fora da janela de "socket recém-criado"
  const p = h.guard.restart(inst); // criação demora 3 s
  await h.clock.advance(1_000);
  const joined = h.guard.connect(inst, undefined, 'backoff');
  await h.clock.advance(3_000);
  assert.equal(await joined, await p);
  assert.equal(h.creations.length, 2);
});

test('socket antigo emitindo close atrasado não reconecta nem muda o estado', async () => {
  const h = setup();
  const inst = h.makeInst('a');
  const s1 = await h.guard.connect(inst); h.emit(inst, s1, h.open);
  await h.clock.advance(10_000);
  const s2 = await h.guard.restart(inst); h.emit(inst, s2, h.open);
  const delivered = h.emit(inst, s1, h.close(428)); // atrasado, do socket aposentado
  assert.equal(delivered, false);
  assert.equal(inst.stateConnection.state, 'open');
  assert.equal(h.clock.pending() > 0 ? h.scheduled('a').length : 0, 0);
  assert.ok(h.logs.some((l) => l.evt === 'stale.dropped' && l.staleGen === 1 && l.currentGen === 2));
  // o close do socket ATUAL continua valendo
  assert.equal(h.emit(inst, s2, h.close(428)), true);
  assert.equal(h.scheduled('a').length, 1);
});

test('408 repetido: backoff exponencial com jitter até o teto de 5 min', async () => {
  const h = setup({ random: () => 1 }); // jitter no máximo
  const inst = h.makeInst('a', { onCreate: (i, s) => h.clock.setTimer(() => h.emit(i, s, h.close(408, 'Timed Out')), 30_000) });
  await h.guard.connect(inst);
  await h.clock.advance(40 * 60_000);
  const delays = h.scheduled('a').map((l) => l.delayMs);
  assert.deepEqual(delays.slice(0, 9), [2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000]);
  assert.ok(delays.every((d) => d <= 300_000));
  assert.ok(h.creations.length < 15, `${h.creations.length} conexões em 40 min`);
  credsIntact(inst);
});

test('515 logo após parear: reconecta rápido sem contar tentativa; repetido demais vira backoff', async () => {
  const h = setup();
  const inst = h.makeInst('a', { onCreate: (i, s) => h.clock.setTimer(() => h.emit(i, s, h.close(515, 'Stream Errored (restart required)', { data: { attrs: { code: '515' } } })), 100) });
  await h.guard.connect(inst);
  await h.clock.advance(5_000);
  const first = h.scheduled('a').slice(0, 3);
  assert.ok(first.every((l) => l.kind === 'restart_required' && l.delayMs <= 1_000 && l.streamCode === '515'));
  assert.equal(first.at(-1).attempt, 0);
  await h.clock.advance(60_000);
  const later = h.scheduled('a').slice(3);
  assert.ok(later.length > 0 && later.every((l) => l.kind === 'backoff'), 'depois de 3 em 2 min, 515 segue o backoff');
});

test('515 único depois do pareamento seguido de open: recupera sem esperar', async () => {
  const h = setup();
  let n = 0;
  const inst = h.makeInst('a', { onCreate: (i, s) => h.clock.setTimer(() => h.emit(i, s, n++ === 0 ? h.close(515) : h.open), 100) });
  await h.guard.connect(inst);
  await h.clock.advance(3_000);
  assert.equal(inst.stateConnection.state, 'open');
  assert.equal(h.creations.length, 2);
  assert.ok(h.creations[1].at - h.creations[0].at < 1_500);
});

test('440 da sessão atual (outra conexão externa): espera longa crescente e para de disputar', async () => {
  const h = setup({ random: () => 0 });
  const inst = h.makeInst('a', { onCreate: (i, s) => h.clock.setTimer(() => { h.emit(i, s, h.open); h.clock.setTimer(() => h.emit(i, s, h.close(440, 'Stream Errored (conflict)', { data: { attrs: { type: 'replaced' } } })), 5_000); }, 100) });
  await h.guard.connect(inst);
  await h.clock.advance(60 * 60_000);
  const s440 = h.scheduled('a');
  assert.deepEqual(s440.map((l) => l.delayMs), [30_000, 60_000, 120_000, 240_000]);
  assert.ok(s440.every((l) => l.kind === 'replaced_external'));
  assert.ok(h.logs.some((l) => l.evt === 'reconnect.parked' && l.replacedInWindow === 5));
  assert.equal(h.creations.length, 5);
  assert.equal(h.guard.inspect(inst).parked, true);
  // conectar pelo painel desestaciona
  await h.guard.connect(inst, undefined, 'api');
  assert.equal(h.creations.length, 6);
  credsIntact(inst);
});

test('440 vindo de socket nosso aposentado (concorrência interna) é descartado, não conta', async () => {
  const h = setup();
  const inst = h.makeInst('a');
  const s1 = await h.guard.connect(inst); h.emit(inst, s1, h.open);
  await h.clock.advance(10_000);
  await h.guard.restart(inst);
  h.emit(inst, s1, h.close(440));
  assert.equal(h.guard.inspect(inst).replacedInWindow, 0);
  assert.equal(h.scheduled('a').length, 0);
});

test('DNS indisponível por 1 h (o caso das ~19/s): poucas tentativas, espaçadas', async () => {
  const h = setup();
  const enotfound = { message: 'getaddrinfo ENOTFOUND web.whatsapp.com', code: 'ENOTFOUND' };
  const inst = h.makeInst('a', { wuid: undefined, onCreate: (i, s) => h.clock.setTimer(() => h.emit(i, s, { connection: 'close', lastDisconnect: { error: { ...enotfound, output: { statusCode: undefined } } } }), 50) });
  await h.guard.connect(inst);
  await h.clock.advance(60 * 60_000);
  // antes: 19/s × 3600 s ≈ 68 mil
  assert.ok(h.creations.length <= 30, `${h.creations.length} conexões em 1 h`); // teto: 1 a cada 2,5–5 min
  const last = h.scheduled('a').at(-1);
  assert.equal(last.netCode, 'ENOTFOUND');
  assert.ok(last.delayMs >= 150_000);
});

test('WebSocket encerrado (428) entra no mesmo backoff', async () => {
  const h = setup({ random: () => 0 });
  const inst = h.makeInst('a');
  const s = await h.guard.connect(inst); h.emit(inst, s, h.open);
  h.emit(inst, s, h.close(428));
  const [l] = h.scheduled('a');
  assert.equal(l.code, 428);
  assert.equal(l.delayMs, 1_000);
});

test('recuperação depois de indisponibilidade: loga a volta e, estável 1 min, zera a contagem', async () => {
  const h = setup({ random: () => 1 });
  let down = true;
  const inst = h.makeInst('a', { onCreate: (i, s) => h.clock.setTimer(() => h.emit(i, s, down ? h.close(408) : h.open), 100) });
  await h.guard.connect(inst);
  await h.clock.advance(3 * 60_000);
  const attempts = h.guard.inspect(inst).attempt;
  assert.ok(attempts >= 4);
  down = false;
  await h.clock.advance(10 * 60_000);
  const rec = h.logs.find((l) => l.evt === 'reconnect.recovered');
  assert.ok(rec && rec.attempts === attempts && rec.downtimeMs > 3 * 60_000);
  assert.equal(h.guard.inspect(inst).attempt, 0);
  // nova queda começa do 1º degrau
  h.emit(inst, inst.client, h.close(408));
  assert.equal(h.scheduled('a').at(-1).delayMs, 2_000);
  credsIntact(inst);
});

test('open que cai antes de 1 min não zera o backoff (conexão oscilando)', async () => {
  const h = setup({ random: () => 1 });
  const inst = h.makeInst('a', { onCreate: (i, s) => h.clock.setTimer(() => { h.emit(i, s, h.open); h.clock.setTimer(() => h.emit(i, s, h.close(428)), 10_000); }, 100) });
  await h.guard.connect(inst);
  await h.clock.advance(10 * 60_000);
  const d = h.scheduled('a').map((l) => l.delayMs);
  assert.ok(d.at(-1) > d[0] * 8, `deveria crescer: ${d.join(',')}`);
});

test('cancelamento: logout, remoção e queda definitiva matam o timer pendente', async () => {
  for (const how of ['logout', 'remove', 'definitive']) {
    const h = setup();
    const inst = h.makeInst('a');
    const s = await h.guard.connect(inst); h.emit(inst, s, h.open);
    h.emit(inst, s, h.close(428));
    assert.equal(h.guard.inspect(inst).pending, true);
    if (how === 'definitive') h.guard.onDefinitiveClose(inst, 401);
    else h.guard.cancel(inst, how);
    await h.clock.advance(60 * 60_000);
    assert.equal(h.creations.length, 1, how);
    assert.equal(h.guard.inspect(inst).pending, false);
    // close recuperável depois de cancelado não reagenda
    h.emit(inst, s, h.close(428));
    assert.equal(h.guard.inspect(inst).pending, false, how);
  }
});

test('timer novo substitui o anterior: nunca duas tentativas agendadas para a mesma instância', async () => {
  const h = setup();
  const inst = h.makeInst('a');
  const s = await h.guard.connect(inst); h.emit(inst, s, h.open);
  h.emit(inst, s, h.close(428));
  h.guard.onClose(inst, 428, undefined); // repetido
  h.guard.onClose(inst, 408, undefined);
  assert.equal(h.clock.pending(), 1);
  await h.clock.advance(10 * 60_000);
  assert.equal(h.creations.length, 2);
});

test('createClient travado: a trava solta no prazo, sem deadlock, e a próxima tentativa segue', async () => {
  const h = setup();
  const inst = h.makeInst('a', { hang: true });
  const p = h.guard.connect(inst, undefined, 'backoff').catch((e) => e);
  await h.clock.advance(61_000);
  assert.match(String((await p).message), /não terminou em 60000 ms/);
  assert.equal(h.guard.inspect(inst).inflight, false);
  assert.equal(h.guard.inspect(inst).pending, true, 'falha de criação reagenda');
  assert.equal(h.guard._running(), 0, 'vaga global liberada');
});

test('50 instâncias caindo juntas: sem tempestade (≤3 simultâneas, ≥200 ms entre criações)', async () => {
  const h = setup({ random: Math.random });
  const insts = Array.from({ length: 50 }, (_, i) => h.makeInst(`n${i}`, { createMs: 300 }));
  for (const inst of insts) { const p = h.guard.connect(inst); await h.clock.advance(400); h.emit(inst, await p, h.open); }
  await h.clock.advance(2 * 60_000);
  h.creations.length = 0;
  const t0 = h.clock.now();
  for (const inst of insts) h.emit(inst, inst.client, h.close(428)); // queda de rede geral
  await h.clock.advance(60_000);
  assert.equal(h.creations.length, 50, 'todas voltam a tentar dentro de 1 min');
  assert.ok(h.maxRunning() <= 3);
  const ats = h.creations.map((c) => c.at).sort((a, b) => a - b);
  for (let i = 1; i < ats.length; i++) assert.ok(ats[i] - ats[i - 1] >= 200, 'espaçamento global');
  assert.ok(ats[0] - t0 >= 1_000, 'ninguém reconecta na hora');
  for (const inst of insts) credsIntact(inst);
});

test('carimbo de ordem: seq cresce sempre; boot é monotônico entre reinícios mesmo com relógio atrasado', () => {
  const h = setup();
  const inst = h.makeInst('a');
  const a = h.guard.stamp(inst); const b = h.guard.stamp(inst);
  assert.equal(a.atendoBoot, 7);
  assert.ok(b.atendoSeq > a.atendoSeq);
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const file = join(dir, 'boot');
  writeFileSync(file, '9999999999');
  const g = createGuard({ bootFile: file, now: () => 1_000, log: () => {} });
  assert.equal(g.boot, 10_000_000_000);
  assert.equal(readFileSync(file, 'utf8'), '10000000000');
  const g2 = createGuard({ bootFile: join(dir, 'nao-existe', 'x'), now: () => 5_000_000, log: () => {} });
  assert.equal(g2.boot, 5_000, 'sem arquivo: piso do relógio');
});

test('log de reconexão sem dados sensíveis', async () => {
  const h = setup();
  const inst = h.makeInst('a');
  const s = await h.guard.connect(inst); h.emit(inst, s, h.open);
  h.guard.onClose(inst, 428, { error: { message: 'x'.repeat(500), output: { statusCode: 428 }, data: { attrs: { code: '428' }, creds: { noiseKey: 'SEGREDO' } } } });
  const raw = JSON.stringify(h.logs);
  assert.ok(!raw.includes('SEGREDO'));
  const l = h.scheduled('a').at(-1);
  assert.equal(l.message.length, 160);
  assert.deepEqual(Object.keys(l).sort(), ['attempt', 'code', 'delayMs', 'evt', 'gen', 'instance', 'kind', 'message', 'netCode', 'streamCode', 't'].sort());
});
