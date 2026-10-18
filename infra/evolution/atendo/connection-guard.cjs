'use strict';
// Guarda de conexão da Evolution 2.3.7 (docs/29-reconexao-evolution.md). Carregado no topo do bundle
// (patch-evolution-connection.mjs); os pontos de chamada no código minificado só delegam para cá.
//
// O que a 2.3.7 fazia e este módulo impede:
//  - reconectava NA HORA em todo close recuperável (408/428/440/500/515, DNS): ~19 tentativas/s com o
//    WhatsApp fora do ar (doc 26 › evidências);
//  - createClient trocava `this.client` sem encerrar o socket anterior, e os handlers do antigo
//    continuavam vivos: o close dele disparava outra reconexão → dois sockets com as mesmas
//    credenciais → 440 (connectionReplaced) → reconexão imediata dos dois, em ciclo;
//  - restart, connect da API e reconexão podiam rodar juntos para a mesma instância.
//
// Regras: uma operação de conexão por instância (as outras recebem a mesma promessa); geração por
// socket, e o connection.update de socket aposentado é descartado; backoff exponencial com jitter
// e um só timer por instância; 515 rápido (reinício esperado após parear); 440 da sessão ATUAL =
// outra conexão externa usando as credenciais → espera longa e, repetindo, para de disputar;
// limite global de criação de sockets (tempestade quando todas caem juntas).
//
// Nunca apaga credenciais nem chaves: só decide QUANDO chamar o connect original da Evolution.

const fs = require('node:fs');

const MIN = 60_000;
const DEFAULTS = {
  baseDelayMs: 2_000, // 1ª tentativa de rede: 1–2 s
  maxDelayMs: 5 * MIN, // teto: 2,5–5 min
  fast515: { minMs: 300, maxMs: 1_000, maxInWindow: 3, windowMs: 2 * MIN },
  qrCycle: { minMs: 1_000, maxMs: 2_000 },
  replaced: { baseMs: 30_000, maxMs: 30 * MIN, parkAfter: 5, windowMs: 60 * MIN },
  stableMs: 60_000, // aberto por 1 min = recuperado, zera a contagem
  maxConcurrent: 3, // criações de socket simultâneas no processo
  minGapMs: 200, // e no máximo ~5 por segundo
  opTimeoutMs: 60_000, // trava de conexão nunca fica presa além disto
  recentCreateMs: 5_000, // restart logo depois de um socket novo não cria outro
};

function defaultLog(entry) {
  try {
    process.stdout.write(`${JSON.stringify({ atendo: 'connection-guard', time: new Date().toISOString(), ...entry })}\n`);
  } catch {
    /* log nunca derruba conexão */
  }
}

/** Motivo do fechamento sem dados sensíveis: só mensagem curta e o código do stream:error. */
function describeDisconnect(lastDisconnect) {
  const err = lastDisconnect?.error;
  const data = err?.data;
  const streamCode = data?.attrs?.code ?? data?.content?.[0]?.attrs?.code;
  return {
    message: typeof err?.message === 'string' ? err.message.slice(0, 160) : undefined,
    streamCode: typeof streamCode === 'string' ? streamCode : undefined,
    // DNS/rede: o Baileys embrulha o erro do ws na mensagem ("WebSocket Error (getaddrinfo ENOTFOUND …)")
    netCode: typeof err?.code === 'string' ? err.code : typeof err?.cause?.code === 'string' ? err.cause.code
      : /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b/.exec(String(err?.message ?? ''))?.[1],
  };
}

function readBoot(file, now) {
  // número de boot monotônico entre reinícios: arquivo no volume da Evolution + piso no relógio
  const floor = Math.floor(now() / 1000);
  if (!file) return floor;
  let prev = 0;
  try { prev = Number(fs.readFileSync(file, 'utf8')) || 0; } catch { /* primeiro boot */ }
  const boot = Math.max(prev + 1, floor);
  try { fs.writeFileSync(file, String(boot)); } catch { /* sem volume: só o relógio */ }
  return boot;
}

function createGuard(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts.config };
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? setTimeout;
  const clearTimer = opts.clearTimer ?? clearTimeout;
  const random = opts.random ?? Math.random;
  const log = opts.log ?? defaultLog;
  const boot = opts.boot ?? readBoot(opts.bootFile, now);
  const states = new WeakMap();
  let seq = 0;

  // ---- limite global (semáforo + espaçamento) ----
  let running = 0;
  let lastStart = 0;
  const waiting = [];
  const pump = () => {
    if (!waiting.length || running >= cfg.maxConcurrent) return;
    const wait = Math.max(0, lastStart + cfg.minGapMs - now());
    if (wait > 0) {
      if (!pump.timer) pump.timer = setTimer(() => { pump.timer = null; pump(); }, wait);
      return;
    }
    running += 1;
    lastStart = now();
    waiting.shift()();
    pump();
  };
  const acquire = () => new Promise((resolve) => { waiting.push(resolve); pump(); });
  const release = () => { running -= 1; pump(); };

  const name = (inst) => inst?.instance?.name ?? inst?.instanceName ?? '?';
  function st(inst) {
    let s = states.get(inst);
    if (!s) {
      s = { gen: 0, attempt: 0, inflight: null, timer: null, stableTimer: null, cancelled: false, parked: false, replaced: [], r515: [], downSince: null, lastCreatedAt: 0, qrAtStart: 0 };
      states.set(inst, s);
    }
    return s;
  }
  const jitter = (min, max) => Math.round(min + random() * (max - min));
  const clearTimers = (s) => {
    if (s.timer) { clearTimer(s.timer); s.timer = null; }
    if (s.stableTimer) { clearTimer(s.stableTimer); s.stableTimer = null; }
  };
  const live = (inst) => {
    const c = inst?.client;
    return !!c && !c.__atendoRetired && !!(c.ws?.isOpen || c.ws?.isConnecting);
  };

  /** Conecta pela Evolution (método original `__atendoConnect`), uma operação por instância. */
  function connect(inst, number, reason = 'api', { force = false } = {}) {
    const s = st(inst);
    const manual = reason === 'api' || reason === 'restart';
    if (manual) { s.cancelled = false; s.parked = false; }
    if (s.inflight) {
      log({ evt: 'connect.joined', instance: name(inst), reason, gen: s.gen });
      return s.inflight;
    }
    if (!manual && (s.cancelled || s.parked)) {
      log({ evt: 'connect.skipped', instance: name(inst), reason, why: s.cancelled ? 'cancelled' : 'parked' });
      return Promise.resolve(inst.client);
    }
    if (!force && live(inst)) {
      log({ evt: 'connect.skipped', instance: name(inst), reason, why: 'socket_alive', gen: s.gen });
      return Promise.resolve(inst.client);
    }
    if (s.timer) { clearTimer(s.timer); s.timer = null; }
    s.qrAtStart = inst?.instance?.qrcode?.count ?? 0;
    const op = (async () => {
      await acquire();
      let to;
      try {
        log({ evt: 'connect.start', instance: name(inst), reason, attempt: s.attempt, gen: s.gen + 1 });
        const timeout = new Promise((_, rej) => { to = setTimer(() => rej(new Error(`connect não terminou em ${cfg.opTimeoutMs} ms`)), cfg.opTimeoutMs); });
        return await Promise.race([inst.__atendoConnect(number), timeout]);
      } finally {
        clearTimer(to);
        release();
      }
    })();
    s.inflight = op;
    const done = () => { if (s.inflight === op) s.inflight = null; };
    op.then(done, (err) => {
      done();
      log({ evt: 'connect.failed', instance: name(inst), reason, attempt: s.attempt, error: String(err?.message ?? err).slice(0, 160) });
      // falha ao CRIAR (banco, versão do WA Web…): mesma regra de rede, sem chamada imediata
      if (!manual) scheduleNetwork(inst, s, undefined, { message: 'create_failed' });
    });
    return op;
  }

  /** Reiniciar (rota /instance/restart, patch-evolution-restart): força socket novo, uma vez. */
  function restart(inst) {
    const s = st(inst);
    s.cancelled = false; s.parked = false; s.attempt = 0;
    if (s.inflight) return s.inflight;
    if (now() - s.lastCreatedAt < cfg.recentCreateMs && live(inst)) {
      log({ evt: 'restart.skipped', instance: name(inst), why: 'socket_just_created', gen: s.gen });
      return Promise.resolve(inst.client);
    }
    clearTimers(s);
    return connect(inst, inst.phoneNumber, 'restart', { force: true });
  }

  /** Antes de `this.client = makeWASocket(...)`: aposenta o socket atual (eventos dele viram descartáveis). */
  function retire(inst) {
    const old = inst?.client;
    if (!old || old.__atendoRetired) return;
    old.__atendoRetired = true;
    log({ evt: 'socket.retired', instance: name(inst), gen: old.__atendoGen ?? st(inst).gen });
    try { old.ws?.close(); } catch { /* já fechado */ }
    try { old.end?.(undefined); } catch { /* já encerrado */ }
  }

  /** Depois de criar: numera o socket. */
  function adopt(inst) {
    const s = st(inst);
    s.gen += 1;
    s.lastCreatedAt = now();
    if (inst.client) inst.client.__atendoGen = s.gen;
    log({ evt: 'socket.created', instance: name(inst), gen: s.gen });
  }

  /** Começo do ev.process: connection.update de socket aposentado/substituído não pode reconectar nada. */
  function filterStale(inst, sock, events) {
    if (!events?.['connection.update']) return;
    if (sock === inst.client && !sock?.__atendoRetired) return;
    const u = events['connection.update'];
    log({ evt: 'stale.dropped', instance: name(inst), staleGen: sock?.__atendoGen, currentGen: st(inst).gen, connection: u.connection, code: u.lastDisconnect?.error?.output?.statusCode });
    delete events['connection.update'];
  }

  /** Carimbo do estado de conexão (vai no webhook connection.update): ordem confiável no Atendo. */
  function stamp(inst) {
    seq += 1;
    return { atendoBoot: boot, atendoSeq: seq, atendoGen: st(inst).gen };
  }

  function schedule(inst, s, delayMs, info) {
    if (s.timer) clearTimer(s.timer);
    s.downSince ??= now();
    log({ evt: 'reconnect.scheduled', instance: name(inst), gen: s.gen, attempt: s.attempt, delayMs, ...info });
    s.timer = setTimer(() => {
      s.timer = null;
      if (s.cancelled || s.parked) return;
      if (live(inst) && inst.stateConnection?.state === 'open') return;
      connect(inst, inst.phoneNumber, 'backoff').catch(() => { /* connect já reagenda */ });
    }, delayMs);
  }

  function scheduleNetwork(inst, s, code, why) {
    s.attempt += 1;
    const exp = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** (s.attempt - 1));
    schedule(inst, s, jitter(exp / 2, exp), { code, kind: 'backoff', ...why });
  }

  /** close recuperável (no lugar do `await this.connectToWhatsapp()` imediato da 2.3.7). */
  function onClose(inst, code, lastDisconnect) {
    const s = st(inst);
    if (s.stableTimer) { clearTimer(s.stableTimer); s.stableTimer = null; }
    const why = describeDisconnect(lastDisconnect);
    if (s.cancelled) { log({ evt: 'close.ignored', instance: name(inst), code, why: 'cancelled', ...why }); return; }
    const t = now();

    // 440: o socket ATUAL foi substituído. Os nossos antigos já foram aposentados (e o evento deles,
    // descartado em filterStale) — então é outra conexão com as mesmas credenciais: não disputar.
    if (code === 440) {
      s.replaced = s.replaced.filter((x) => t - x < cfg.replaced.windowMs).concat(t);
      const n = s.replaced.length;
      if (n >= cfg.replaced.parkAfter) {
        s.parked = true;
        s.downSince ??= t;
        log({ evt: 'reconnect.parked', instance: name(inst), gen: s.gen, code, replacedInWindow: n, hint: 'outra sessão está usando estas credenciais; conferir aparelhos conectados e outro servidor/container com a mesma sessão; reconectar pelo painel', ...why });
        return;
      }
      const exp = Math.min(cfg.replaced.maxMs, cfg.replaced.baseMs * 2 ** (n - 1));
      schedule(inst, s, jitter(exp, Math.min(cfg.replaced.maxMs, exp * 2)), { code, kind: 'replaced_external', replacedInWindow: n, ...why });
      return;
    }
    // 515: reinício pedido pelo servidor (normal logo depois de parear) — rápido, sem contar tentativa
    if (code === 515) {
      s.r515 = s.r515.filter((x) => t - x < cfg.fast515.windowMs).concat(t);
      if (s.r515.length <= cfg.fast515.maxInWindow) {
        schedule(inst, s, jitter(cfg.fast515.minMs, cfg.fast515.maxMs), { code, kind: 'restart_required', inWindow: s.r515.length, ...why });
        return;
      }
    }
    // ciclo do QR (instância ainda sem pareamento que mostrou QR nesta conexão): gerar o próximo logo
    const qrNow = inst?.instance?.qrcode?.count ?? 0;
    if (!inst?.instance?.wuid && qrNow > s.qrAtStart) {
      schedule(inst, s, jitter(cfg.qrCycle.minMs, cfg.qrCycle.maxMs), { code, kind: 'qr_cycle', ...why });
      return;
    }
    // 408, 428, 500, 503, DNS/rede, desconhecido
    scheduleNetwork(inst, s, code, why);
  }

  function onOpen(inst) {
    const s = st(inst);
    if (s.timer) { clearTimer(s.timer); s.timer = null; }
    if (s.downSince !== null) {
      log({ evt: 'reconnect.recovered', instance: name(inst), gen: s.gen, attempts: s.attempt, downtimeMs: now() - s.downSince });
      s.downSince = null;
    }
    const gen = s.gen;
    if (s.stableTimer) clearTimer(s.stableTimer);
    s.stableTimer = setTimer(() => {
      s.stableTimer = null;
      if (s.gen === gen && inst.stateConnection?.state === 'open') { s.attempt = 0; s.replaced = []; s.r515 = []; }
    }, cfg.stableMs);
  }

  /** 401/402/403/406: a Evolution não reconecta (e limpa as credenciais por conta dela). */
  function onDefinitiveClose(inst, code, lastDisconnect) {
    const s = st(inst);
    clearTimers(s);
    s.cancelled = true;
    log({ evt: 'close.definitive', instance: name(inst), gen: s.gen, code, ...describeDisconnect(lastDisconnect) });
  }

  /** logout/remoção: nenhum timer pode reconectar uma instância que saiu. */
  function cancel(inst, why) {
    if (!inst) return;
    const s = st(inst);
    clearTimers(s);
    s.cancelled = true;
    log({ evt: 'reconnect.cancelled', instance: name(inst), gen: s.gen, why });
  }

  const inspect = (inst) => {
    const s = st(inst);
    return { gen: s.gen, attempt: s.attempt, cancelled: s.cancelled, parked: s.parked, pending: !!s.timer, inflight: !!s.inflight, replacedInWindow: s.replaced.length };
  };

  return { connect, restart, retire, adopt, filterStale, stamp, onClose, onOpen, onDefinitiveClose, cancel, inspect, boot, config: cfg, _running: () => running };
}

module.exports = { createGuard, DEFAULTS, describeDisconnect };

if (!globalThis.__atendoConn) {
  globalThis.__atendoConn = createGuard({ bootFile: process.env.ATENDO_BOOT_FILE ?? '/evolution/instances/.atendo-boot' });
}
