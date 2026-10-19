// Testes dos patches da imagem da Evolution (docs/26-backport-cve-2026-48063.md). Rodam no build,
// depois dos patches, contra o node_modules/dist reais da imagem: se falhar, a imagem não sai.
// Fora da imagem: BAILEYS_DIR=… EVOLUTION_DIST=… node --test infra/evolution/verify-patches.test.mjs
//
// Sem rede e sem WhatsApp: chama o decodeMessageNode/processMessage do Baileys com dependências falsas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DIR = process.env.BAILEYS_DIR ?? '/evolution/node_modules/baileys';
const DIST = process.env.EVOLUTION_DIST ?? '/evolution/dist';
const mod = (p) => import(pathToFileURL(`${DIR}/${p}`).href);

const { proto } = await mod('WAProto/index.js');
const { decodeMessageNode } = await mod('lib/Utils/decode-wa-message.js');
const { default: processMessage } = await mod('lib/Utils/process-message.js');
const T = proto.Message.ProtocolMessage.Type;

const ME = '5511999990000:12@s.whatsapp.net'; // nossa sessão (aparelho 12)
const ME_LID = '123456789012345:12@lid';
const MY_PHONE = '5511999990000@s.whatsapp.net'; // o celular do dono (aparelho 0)
const CONTACT = '5511888887777@s.whatsapp.net';

const count = (s, needle) => s.split(needle).length - 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harness(over = {}) {
  const events = [];
  const keySets = [];
  const logs = [];
  const lidPairs = [];
  const logger = {
    info: (_o, m) => logs.push(['info', m]),
    warn: (_o, m) => logs.push(['warn', m]),
    debug: (_o, m) => logs.push(['debug', m]),
    error: () => {},
    trace: () => {},
    child: () => logger,
  };
  const opts = {
    shouldProcessHistoryMsg: false,
    placeholderResendCache: { del: async () => {} },
    ev: { emit: (name, data) => events.push([name, data]) },
    creds: { me: { id: ME }, processedHistoryMessages: [], accountSettings: {} },
    signalRepository: { lidMapping: { storeLIDPNMappings: async (p) => lidPairs.push(...p) }, migrateSession: async () => {} },
    keyStore: { transaction: async (fn) => fn(), set: async (d) => keySets.push(d) },
    logger,
    options: {},
    getMessage: async () => undefined,
    ...over,
  };
  const named = (n) => events.filter(([e]) => e === n).map(([, d]) => d);
  const dropped = () => logs.some(([l, m]) => l === 'warn' && /dropping spoofed self-only protocolMessage/.test(m));
  return { opts, events, keySets, logs, lidPairs, named, dropped };
}

const msg = (fromMe, protocolMessage, remoteJid = fromMe ? MY_PHONE : CONTACT) => ({
  key: { remoteJid, fromMe, id: `ID${Math.random().toString(36).slice(2)}` },
  messageTimestamp: 1_760_000_000,
  message: { protocolMessage },
});

const keyShare = () => ({
  type: T.APP_STATE_SYNC_KEY_SHARE,
  appStateSyncKeyShare: { keys: [{ keyId: { keyId: Buffer.from('chave-1') }, keyData: { keyData: Buffer.from('segredo') } }] },
});
const historyNotification = () => ({ type: T.HISTORY_SYNC_NOTIFICATION, historySyncNotification: { syncType: proto.HistorySync.HistorySyncType.RECENT } });
const pdoResponse = () => ({
  type: T.PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE,
  peerDataOperationRequestResponseMessage: {
    stanzaId: 'REQ-1',
    peerDataOperationResult: [{
      placeholderMessageResendResponse: {
        webMessageInfoBytes: proto.WebMessageInfo.encode({ key: { remoteJid: CONTACT, fromMe: true, id: 'FORJADA' }, message: { conversation: 'mensagem forjada' } }).finish(),
      },
    }],
  },
});
const lidMigration = () => ({
  type: T.LID_MIGRATION_MAPPING_SYNC,
  lidMigrationMappingSyncMessage: { encodedMappingPayload: proto.LIDMigrationMappingSyncPayload.encode({ pnToLidMappings: [{ pn: 5511777776666, latestLid: 987654321 }] }).finish() },
});

// ---------- os patches estão no lugar ----------

test('patches aplicados uma vez e trechos originais removidos', () => {
  const pm = readFileSync(`${DIR}/lib/Utils/process-message.js`, 'utf8');
  const dm = readFileSync(`${DIR}/lib/Utils/decode-wa-message.js`, 'utf8');
  const ms = readFileSync(`${DIR}/lib/Socket/messages-send.js`, 'utf8');
  assert.equal(count(pm, '/*atendo-cve-2026-48063*/'), 1);
  assert.equal(count(dm, '/*atendo-cve-2026-48063*/'), 1);
  assert.equal(count(ms, 'additionalNodes = atendoBizNodes(message, additionalNodes);'), 1, 'patch <biz>');
  for (const f of ['main.js', 'main.mjs']) {
    const src = readFileSync(`${DIST}/${f}`, 'utf8');
    assert.equal(count(src, '/*atendo-restart*/'), 1, `patch restart em ${f}`);
    assert.equal(count(src, '/*atendo-placeholder-triggers*/'), 1, `patch placeholder em ${f}`);
    assert.equal(count(src, 'if(h=="requestPlaceholder"&&!o){'), 0, `gatilho requestPlaceholder sem trava em ${f}`);
    assert.equal(count(src, 'if(h=="onDemandHistSync"){'), 0, `gatilho onDemandHistSync sem trava em ${f}`);
    assert.equal(count(src, 'if(h=="requestPlaceholder"&&!o&&n.key?.fromMe===!0'), 1);
    assert.equal(count(src, 'if(h=="onDemandHistSync"&&n.key?.fromMe===!0){'), 1);
  }
});

test('guarda de conexão carregada no topo e pontos de chamada no lugar (main.js e main.mjs)', () => {
  const calls = { connect: 2, retire: 1, adopt: 1, filterStale: 1, stamp: 1, onClose: 1, onDefinitiveClose: 1, onOpen: 1, cancel: 2, restart: 1 };
  for (const f of ['main.js', 'main.mjs']) {
    const src = readFileSync(`${DIST}/${f}`, 'utf8');
    assert.ok(src.startsWith(f === 'main.js' ? 'require("' : 'import "'), `${f} carrega a guarda antes do bundle`);
    assert.equal(count(src, '/*atendo-connection*/'), 1);
    for (const [fn, n] of Object.entries(calls)) assert.equal(count(src, `globalThis.__atendoConn.${fn}(`), n, `${f}: ${fn}`);
    // a reconexão imediata da 2.3.7 não pode sobrar
    assert.equal(count(src, '.includes(i)?await this.connectToWhatsapp(this.phoneNumber):'), 0, `${f}: reconexão imediata`);
    assert.equal(count(src, 'async __atendoConnect(e){try{return this.loadChatwoot()'), 1);
  }
});

test('guarda de conexão define globalThis.__atendoConn', async () => {
  const guard = process.env.ATENDO_GUARD_PATH ?? '/evolution/atendo/connection-guard.cjs';
  const { createRequire } = await import('node:module');
  createRequire(import.meta.url)(guard);
  for (const fn of ['connect', 'restart', 'retire', 'adopt', 'filterStale', 'stamp', 'onClose', 'onOpen', 'onDefinitiveClose', 'cancel']) {
    assert.equal(typeof globalThis.__atendoConn[fn], 'function', fn);
  }
});

test('bundles da Evolution continuam válidos (node --check)', () => {
  for (const f of ['main.js', 'main.mjs']) {
    const r = spawnSync(process.execPath, ['--check', `${DIST}/${f}`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
});

test('Baileys patcheado carrega pelo ponto de entrada do pacote', async () => {
  const b = await mod('lib/index.js');
  assert.equal(typeof b.makeWASocket, 'function');
});

// ---------- 5ddc231: origem da stanza ----------

const stanza = (attrs) => ({ tag: 'message', attrs: { id: 'S1', t: '1760000000', ...attrs }, content: [] });

test('decode: stanza do próprio aparelho sem recipient vira fromMe (histórico/app-state)', () => {
  const { fullMessage } = decodeMessageNode(stanza({ from: MY_PHONE }), ME, ME_LID);
  assert.equal(fullMessage.key.fromMe, true);
  assert.equal(fullMessage.key.remoteJid, MY_PHONE);
});

test('decode: idem pelo LID do próprio aparelho', () => {
  const { fullMessage } = decodeMessageNode(stanza({ from: '123456789012345@lid' }), ME, ME_LID);
  assert.equal(fullMessage.key.fromMe, true);
});

test('decode: mensagem de contato continua fromMe=false', () => {
  const { fullMessage } = decodeMessageNode(stanza({ from: CONTACT }), ME, ME_LID);
  assert.equal(fullMessage.key.fromMe, false);
  assert.equal(fullMessage.status, undefined);
});

test('decode: enviada pelo celular (com recipient) — comportamento anterior mantido', () => {
  const { fullMessage } = decodeMessageNode(stanza({ from: MY_PHONE, recipient: CONTACT }), ME, ME_LID);
  assert.equal(fullMessage.key.fromMe, true);
  assert.equal(fullMessage.key.remoteJid, CONTACT);
});

test('decode: contato com recipient continua recusado (comportamento anterior)', () => {
  assert.throws(() => decodeMessageNode(stanza({ from: CONTACT, recipient: MY_PHONE }), ME, ME_LID), /not from me/);
});

// ---------- 3beb08e: vulnerabilidade ----------

test('CVE: resposta de placeholder (PDO) forjada por contato não vira messages.upsert', async () => {
  const h = harness();
  await processMessage(msg(false, pdoResponse()), h.opts);
  await sleep(700); // o Baileys emite o upsert 500 ms depois
  assert.equal(h.named('messages.upsert').length, 0);
  assert.ok(h.dropped());
});

test('CVE: key share de app-state forjado por contato não grava chave', async () => {
  const h = harness();
  await processMessage(msg(false, keyShare()), h.opts);
  assert.equal(h.keySets.length, 0);
  assert.equal(h.named('creds.update').length, 0);
  assert.ok(h.dropped());
});

test('CVE: notificação de histórico forjada por contato não é processada', async () => {
  const h = harness({ shouldProcessHistoryMsg: true });
  await processMessage(msg(false, historyNotification()), h.opts);
  assert.equal(h.named('creds.update').length, 0);
  assert.equal(h.named('messaging-history.set').length, 0);
  assert.ok(!h.logs.some(([, m]) => m === 'got history notification'));
  assert.ok(h.dropped());
});

test('CVE: migração de LID forjada por contato não grava mapeamento', async () => {
  const h = harness();
  await processMessage(msg(false, lidMigration()), h.opts);
  assert.equal(h.lidPairs.length, 0);
  assert.ok(h.dropped());
});

// ---------- caminho legítimo (sincronização) preservado ----------

test('sync: resposta de placeholder do próprio aparelho continua virando upsert com requestId', async () => {
  const h = harness();
  await processMessage(msg(true, pdoResponse()), h.opts);
  await sleep(700);
  const ups = h.named('messages.upsert');
  assert.equal(ups.length, 1);
  assert.equal(ups[0].requestId, 'REQ-1');
  assert.ok(!h.dropped());
});

test('app-state: key share do próprio aparelho grava a chave e atualiza creds', async () => {
  const h = harness();
  await processMessage(msg(true, keyShare()), h.opts);
  assert.equal(h.keySets.length, 1);
  const [stored] = Object.keys(h.keySets[0]['app-state-sync-key']);
  assert.equal(stored, Buffer.from('chave-1').toString('base64'));
  assert.deepEqual(h.named('creds.update'), [{ myAppStateKeyId: stored }]);
});

test('sync: notificação de histórico do próprio aparelho chega ao processamento', async () => {
  const h = harness(); // shouldProcessHistoryMsg=false: registra e não baixa (sem rede)
  await processMessage(msg(true, historyNotification()), h.opts);
  assert.ok(h.logs.some(([, m]) => m === 'got history notification'));
  assert.ok(!h.dropped());
});

test('sync: migração de LID do próprio aparelho grava o mapeamento', async () => {
  const h = harness();
  await processMessage(msg(true, lidMigration()), h.opts);
  assert.deepEqual(h.lidPairs, [{ lid: '987654321@lid', pn: '5511777776666@s.whatsapp.net' }]);
});

test('ponta a ponta: stanza do celular sem recipient → decode → key share processado (regressão do rc12)', async () => {
  const { fullMessage } = decodeMessageNode(stanza({ from: MY_PHONE }), ME, ME_LID);
  const h = harness();
  await processMessage({ ...fullMessage, message: { protocolMessage: keyShare() } }, h.opts);
  assert.equal(h.keySets.length, 1);
  assert.ok(!h.dropped());
});

test('ponta a ponta: stanza de contato → decode → key share descartado', async () => {
  const { fullMessage } = decodeMessageNode(stanza({ from: CONTACT }), ME, ME_LID);
  const h = harness();
  await processMessage({ ...fullMessage, message: { protocolMessage: keyShare() } }, h.opts);
  assert.equal(h.keySets.length, 0);
  assert.ok(h.dropped());
});

// ---------- tipos entre usuários não podem ser bloqueados ----------

test('apagar para todos vindo do contato continua processado', async () => {
  const h = harness();
  await processMessage(msg(false, { type: T.REVOKE, key: { id: 'ORIGINAL', remoteJid: CONTACT, fromMe: false } }), h.opts);
  const [upd] = h.named('messages.update');
  assert.equal(upd?.[0]?.key?.id, 'ORIGINAL');
  assert.ok(!h.dropped());
});

test('edição vinda do contato continua processada', async () => {
  const h = harness();
  await processMessage(msg(false, { type: T.MESSAGE_EDIT, key: { id: 'ORIGINAL' }, editedMessage: { conversation: 'texto novo' } }), h.opts);
  const [upd] = h.named('messages.update');
  assert.equal(upd?.[0]?.update?.message?.editedMessage?.message?.conversation, 'texto novo');
  assert.ok(!h.dropped());
});

test('mensagem temporária (EPHEMERAL_SETTING) do contato continua processada', async () => {
  const h = harness();
  await processMessage(msg(false, { type: T.EPHEMERAL_SETTING, ephemeralExpiration: 86400 }), h.opts);
  assert.ok(!h.dropped());
});

// ---------- credencial: leitura que falha não vira credencial nova (docs/23 › 9) ----------

/** O trecho patcheado do auth state (main.js), executável com dependências falsas. */
function credsInit(file) {
  const src = readFileSync(`${DIST}/${file}`, 'utf8');
  const start = src.indexOf('let a=await i("creds");/*atendo-creds-read*/');
  assert.ok(start >= 0, `${file}: patch creds-read`);
  const end = src.indexOf('await o(a,"creds"))', start) + 'await o(a,"creds"))'.length;
  const code = src.slice(start, end)
    .replace(/await ([\w$]+)\.session\.findUnique\(/, 'await __prisma.session.findUnique(')
    .replace(/a=(\(0,[\w$.]+\.initAuthCreds\)|[\w$]+)\(\)/, 'a=__init()')
    .replace(/return a\|\|\((.*)\)$/, 'return a||($1,a)');
  return new Function('i', 'o', '__prisma', '__init', 'p', `return (async()=>{${code}})()`);
}

function credsDeps({ read = null, row = false, dbDown = false } = {}) {
  const writes = [];
  return {
    writes,
    i: async () => read,
    o: async (v, k) => { writes.push([k, v]); },
    prisma: { session: { findUnique: async () => { if (dbDown) throw new Error('Timed out fetching a new connection'); return row ? { sessionId: 'X' } : null; } } },
    init: () => ({ fresh: true }),
  };
}

for (const file of ['main.js', 'main.mjs']) {
  test(`creds (${file}): credencial lida é usada e nada é gravado`, async () => {
    const d = credsDeps({ read: { me: { id: '1@s.whatsapp.net' } } });
    const creds = await credsInit(file)(d.i, d.o, d.prisma, d.init, 'X');
    assert.deepEqual(creds, { me: { id: '1@s.whatsapp.net' } });
    assert.equal(d.writes.length, 0);
  });

  test(`creds (${file}): sessão existe mas a leitura falhou → erro, nada gravado`, async () => {
    const d = credsDeps({ read: null, row: true });
    await assert.rejects(credsInit(file)(d.i, d.o, d.prisma, d.init, 'X'), /não pôde ser lida/);
    assert.equal(d.writes.length, 0);
  });

  test(`creds (${file}): banco fora do ar → erro, nada gravado`, async () => {
    const d = credsDeps({ read: null, dbDown: true });
    await assert.rejects(credsInit(file)(d.i, d.o, d.prisma, d.init, 'X'), /Timed out/);
    assert.equal(d.writes.length, 0);
  });

  test(`creds (${file}): instância nova (sem sessão) cria e grava credencial`, async () => {
    const d = credsDeps({ read: null, row: false });
    const creds = await credsInit(file)(d.i, d.o, d.prisma, d.init, 'X');
    assert.deepEqual(creds, { fresh: true });
    assert.deepEqual(d.writes, [['creds', { fresh: true }]]);
  });
}

// ---------- recebimento: fila com prazo, offline que não morre, NACK (docs/23 › 10) ----------

const RECV = () => readFileSync(`${DIR}/lib/Socket/messages-recv.js`, 'utf8');
/** Pedaço do messages-recv.js patcheado, de `start` até o fim do bloco que fecha com `end`. */
function slice(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `trecho: ${start}`);
  const b = src.indexOf(end, a) + end.length;
  return src.slice(a, b);
}

test('recv: patch aplicado uma vez, filas com prazo e logger com o nome da instância', () => {
  const src = RECV();
  assert.equal(count(src, '/*atendo-recv*/'), 1);
  assert.equal(count(src, 'processingMutex.mutex('), 0, 'toda tarefa da fila passa pelo prazo');
  assert.equal(count(src, "atendoTimed(processingMutex, 'processing',"), 3);
  assert.equal(count(src, "atendoTimed(retryMutex, 'retry',"), 1);
  assert.equal(count(src, 'await nodeProcessor(node);'), 1);
  for (const f of ['main.js', 'main.mjs']) {
    const dist = readFileSync(`${DIST}/${f}`, 'utf8');
    assert.equal(count(dist, '/*atendo-baileys-logger*/'), 1, f);
    assert.equal(count(dist, '.child({instance:this.instanceName})'), 2, f);
    assert.equal(count(dist, '/*atendo-creds-read*/'), 1, f);
  }
});

test('recv: tarefa travada na fila não segura as seguintes', async () => {
  const { makeMutex } = await mod('lib/Utils/make-mutex.js');
  const code = slice(RECV(), 'const atendoTimed = ', '}));');
  const logs = [];
  const atendoTimed = new Function('logger', 'atendoTaskTimeoutMs', `${code}; return atendoTimed;`)(
    { error: (o, m) => logs.push([o, m]) }, 50);
  const mutex = makeMutex();
  const order = [];
  atendoTimed(mutex, 'processing', () => new Promise(() => {})); // nunca termina
  const t0 = Date.now();
  const v = await atendoTimed(mutex, 'processing', async () => { order.push('segunda'); return 42; });
  assert.equal(v, 42);
  assert.deepEqual(order, ['segunda']);
  assert.ok(Date.now() - t0 >= 45, 'esperou o prazo da travada');
  assert.equal(logs.length, 1);
  assert.match(logs[0][1], /tarefa travada/);
});

test('recv: erro dentro da tarefa continua chegando a quem chamou', async () => {
  const { makeMutex } = await mod('lib/Utils/make-mutex.js');
  const code = slice(RECV(), 'const atendoTimed = ', '}));');
  const atendoTimed = new Function('logger', 'atendoTaskTimeoutMs', `${code}; return atendoTimed;`)({ error: () => {} }, 1000);
  await assert.rejects(atendoTimed(makeMutex(), 'processing', async () => { throw new Error('falhou'); }), /falhou/);
});

test('recv: erro em um nó offline não para o processamento dos seguintes', async () => {
  const code = slice(RECV(), 'const makeOfflineNodeProcessor = () => {', 'return { enqueue };\n    };');
  const seen = [];
  const errors = [];
  const handleMessage = async (n) => { seen.push(n.id); if (n.id === 'veneno') throw new Error('poison'); };
  const make = new Function('handleMessage', 'handleCall', 'handleReceipt', 'handleNotification', 'ws', 'onUnexpectedError', `${code}; return makeOfflineNodeProcessor;`)(
    handleMessage, async () => {}, async (n) => { seen.push(n.id); }, async () => {}, { isOpen: true }, (e, where) => errors.push([e.message, where]));
  const p = make();
  p.enqueue('message', { id: 'veneno' });
  p.enqueue('message', { id: 'depois-1' });
  p.enqueue('receipt', { id: 'depois-2' });
  await sleep(20);
  assert.deepEqual(seen, ['veneno', 'depois-1', 'depois-2']);
  assert.deepEqual(errors, [['poison', '[atendo] processing offline message']]);
  // a fila continua viva para nós novos
  p.enqueue('message', { id: 'novo' });
  await sleep(20);
  assert.equal(seen.at(-1), 'novo');
});

/** Invólucro do handleMessage patcheado, com a função original e o ack falsos. */
function messageWrapper(inner) {
  const code = slice(RECV(), 'const handleMessage = async (node) => {\n        try {\n            await atendoHandleMessage(node);', '    };');
  const acks = [];
  const atendoAcked = new WeakSet();
  const sendMessageAck = async (node, code) => { atendoAcked.add(node); acks.push([node.attrs.id, code]); };
  const handleMessage = new Function('atendoHandleMessage', 'atendoAcked', 'sendMessageAck', 'logger', 'binaryNodeToString', 'NACK_REASONS', `${code}; return handleMessage;`)(
    (n) => inner(n, { atendoAcked, sendMessageAck }), atendoAcked, sendMessageAck, { error: () => {}, warn: () => {} }, () => '<node/>', { UnhandledError: 500 });
  return { handleMessage, acks };
}

test('recv: erro antes do processamento manda NACK (o servidor para de reentregar)', async () => {
  const { handleMessage, acks } = messageWrapper(async () => { throw new Error('decode falhou'); });
  await handleMessage({ tag: 'message', attrs: { id: 'M1' } });
  assert.deepEqual(acks, [['M1', 500]]);
});

test('recv: erro depois do recibo não manda NACK por cima', async () => {
  const { handleMessage, acks } = messageWrapper(async (node, { atendoAcked }) => { atendoAcked.add(node); throw new Error('upsert falhou'); });
  await handleMessage({ tag: 'message', attrs: { id: 'M2' } });
  assert.deepEqual(acks, []);
});

test('recv: mensagem tratada sem erro não ganha ack extra', async () => {
  const { handleMessage, acks } = messageWrapper(async () => {});
  await handleMessage({ tag: 'message', attrs: { id: 'M3' } });
  assert.deepEqual(acks, []);
});
