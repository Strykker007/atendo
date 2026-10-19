/**
 * Carga sintética no fluxo interno do Atendo (docs/30-testes-locais.md): webhook da Evolution →
 * fila wa-inbound → worker → banco. NADA sai pela rede do WhatsApp nem chega à Evolution:
 *  - os eventos são POSTados direto na API local (/webhooks/evolution), no formato da Evolution 2.3.7;
 *  - o número sintético aponta para um "buraco" (http://127.0.0.1:9): qualquer chamada do worker ao
 *    provider (foto, mídia, envio) falha na hora, local;
 *  - telefones 5500… (DDD 00 não existe); tenant próprio, sem fluxos/IA/campanhas.
 * Recusa rodar fora de um ambiente local (banco, Redis, API e Evolution em localhost).
 *
 *   pnpm --filter @atendo/api loadtest -- --messages 500 [--contacts 50] [--concurrency 20]
 *       [--dup 0.1] [--no-shuffle] [--status 100] [--pause 100] [--conn 30] [--timeout 120]
 */
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { env } from '../src/config/env';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { QUEUE_INBOUND } from '../src/modules/whatsapp/queues';

// ---------- opções ----------
const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const opt = {
  messages: arg('messages', 100),
  contacts: arg('contacts', 0) || Math.max(1, Math.round(arg('messages', 100) / 10)),
  concurrency: arg('concurrency', 20),
  dup: arg('dup', 0.1),
  shuffle: !flag('no-shuffle'),
  status: arg('status', 50),
  pause: arg('pause', 50),
  conn: arg('conn', 30),
  timeoutS: arg('timeout', 120),
  api: process.env.LOADTEST_API_URL ?? `http://localhost:${env.API_PORT}`,
};

const TENANT_SLUG = 'loadtest-sintetico';
const INSTANCE = 'loadtest-sintetico';
const BLACKHOLE = 'http://127.0.0.1:9';
const RUN = Date.now().toString(36);

// ---------- trava de segurança: só ambiente local ----------
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);
function assertLocal() {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production') problems.push('NODE_ENV=production');
  for (const [k, v] of [['DATABASE_URL', env.DATABASE_URL], ['REDIS_URL', env.REDIS_URL], ['LOADTEST_API_URL', opt.api], ['EVOLUTION_BASE_URL', env.EVOLUTION_BASE_URL]] as const) {
    let host = '';
    try { host = new URL(v).hostname; } catch { problems.push(`${k} inválida`); continue; }
    if (!LOCAL.has(host)) problems.push(`${k} aponta para "${host}" (não local)`);
  }
  if (problems.length) {
    console.error(`✖ Recusado — isto não parece o ambiente local:\n  - ${problems.join('\n  - ')}`);
    process.exit(2);
  }
}

// ---------- utilidades ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const shuffle = <T>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await fn(x); }));
}
const apikey = createHmac('sha256', env.EVOLUTION_API_KEY).update(INSTANCE).digest('hex');
const localTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString(); // como a 2.3.7
async function post(body: unknown, raw?: string) {
  const t = Date.now();
  const res = await fetch(`${opt.api}/webhooks/evolution`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) });
  return { status: res.status, ms: Date.now() - t };
}
const phoneOf = (i: number) => `55009${String(i).padStart(8, '0')}`;
const upsert = (id: string, phone: string, text: string, ts: number) => ({
  event: 'messages.upsert', instance: INSTANCE, date_time: localTime(), apikey,
  data: { key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id }, pushName: `Teste ${phone.slice(-4)}`, message: { conversation: text }, messageType: 'conversation', messageTimestamp: ts },
});

// ---------- coleta de métricas do processo (DIAG_STATS_MS) ----------
async function sampler(redis: Redis, queue: Queue) {
  const samples: any[] = [];
  const health: number[] = [];
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      const keys = await redis.keys('diag:stats:*').catch(() => []);
      for (const k of keys) { const v = await redis.get(k); if (v) samples.push(JSON.parse(v)); }
      const t = Date.now();
      await fetch(`${opt.api}/health`).then(() => health.push(Date.now() - t)).catch(() => health.push(-1));
      samples.push({ queue: await queue.getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => null), at: Date.now() });
      await sleep(1_000);
    }
  })();
  return async () => {
    stop = true; await loop;
    const proc = samples.filter((s) => s.role);
    const maxOf = (f: string) => (proc.length ? Math.max(...proc.map((s) => s[f])) : null);
    const queues = samples.filter((s) => s.queue).map((s) => s.queue);
    return {
      processStats: proc.length ? { samples: proc.length, rssMaxMb: maxOf('rssMb'), heapMaxMb: maxOf('heapUsedMb'), eventLoopP99MaxMs: maxOf('eventLoopP99Ms'), eventLoopMaxMs: maxOf('eventLoopMaxMs') } : 'sem amostras — suba a API com DIAG_STATS_MS=1000',
      healthMs: { p50: pct(health.filter((x) => x >= 0), 50), p95: pct(health.filter((x) => x >= 0), 95), failures: health.filter((x) => x < 0).length },
      queuePeak: queues.length ? { waiting: Math.max(...queues.map((q) => q.waiting)), active: Math.max(...queues.map((q) => q.active)), failedEnd: queues.at(-1).failed } : null,
    };
  };
}

async function main() {
  assertLocal();
  const health = await fetch(`${opt.api}/health`).then((r) => r.ok).catch(() => false);
  if (!health) { console.error(`✖ API local fora do ar em ${opt.api} (pnpm start:all)`); process.exit(2); }

  const prisma = new PrismaClient();
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_INBOUND, { connection: redis });
  const crypto = new CryptoService();
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); console.log(`  ${ok ? '✔' : '✖'} ${name} — ${detail}`); };
  const failedBefore = (await queue.getJobCounts('failed')).failed;

  // ---------- tenant/número sintéticos (recriados a cada execução) ----------
  const tenant = await prisma.tenant.upsert({ where: { slug: TENANT_SLUG }, update: {}, create: { slug: TENANT_SLUG, name: '[TESTE] Carga sintética' } });
  await prisma.contact.deleteMany({ where: { tenantId: tenant.id } }); // conversas e mensagens vão junto (cascade)
  const providerConfig = crypto.encryptJson({ instanceName: INSTANCE, baseUrl: BLACKHOLE, apiKey: 'loadtest-buraco' });
  const number = await prisma.whatsAppNumber.upsert({
    where: { provider_externalId: { provider: 'evolution', externalId: INSTANCE } },
    update: { providerConfig, status: 'connected', isActive: false, tenantId: tenant.id },
    create: { tenantId: tenant.id, provider: 'evolution', externalId: INSTANCE, phone: '5500900000000', label: '[TESTE] Carga sintética', providerConfig, status: 'connected', isActive: false },
  });
  await redis.del(`wa:conn:ord:${number.id}`, `wa:conn:at:${number.id}`, `wa:conn:hc:${number.id}`);
  console.log(`▶ Tenant sintético ${tenant.id} · número ${number.id} (provider → ${BLACKHOLE}) · execução ${RUN}`);

  const stopSampler = await sampler(redis, queue);
  const t0 = Date.now();

  // ---------- A. ingestão: volume, concorrência, duplicadas, fora de ordem ----------
  console.log(`▶ A. ${opt.messages} mensagens, ${opt.contacts} contatos, concorrência ${opt.concurrency}, ${Math.round(opt.dup * 100)}% duplicadas, ${opt.shuffle ? 'embaralhadas' : 'em ordem'}`);
  const base = Math.floor(Date.now() / 1000) - opt.messages;
  const msgs = Array.from({ length: opt.messages }, (_, i) => ({ id: `LT${RUN}-${i}`, phone: phoneOf(i % opt.contacts), ts: base + i }));
  const dups = msgs.filter(() => Math.random() < opt.dup);
  const sendList = [...(opt.shuffle ? shuffle(msgs) : msgs), ...shuffle(dups)];
  const sentAt = new Map<string, number>();
  const http: number[] = [];
  let httpErr = 0;
  await pool(sendList, opt.concurrency, async (m) => {
    if (!sentAt.has(m.id)) sentAt.set(m.id, Date.now());
    const r = await post(upsert(m.id, m.phone, `carga ${m.id}`, m.ts)).catch(() => ({ status: 0, ms: 0 }));
    if (r.status !== 200) httpErr += 1; else http.push(r.ms);
  });
  const sendDoneMs = Date.now() - t0;
  const ids = msgs.map((m) => m.id);
  const deadline = Date.now() + opt.timeoutS * 1000;
  let rows: { externalId: string | null; queuedAt: Date; conversationId: string }[] = [];
  while (Date.now() < deadline) {
    rows = await prisma.message.findMany({ where: { externalId: { in: ids } }, select: { externalId: true, queuedAt: true, conversationId: true } });
    if (rows.length >= ids.length) break;
    await sleep(500);
  }
  const lat = rows.map((r) => r.queuedAt.getTime() - (sentAt.get(r.externalId!) ?? 0));
  const procDoneMs = rows.length ? Math.max(...rows.map((r) => r.queuedAt.getTime())) - t0 : null;
  check('recebidos (HTTP 200)', httpErr === 0, `${sendList.length - httpErr}/${sendList.length} (${sendList.length - msgs.length} reenvios duplicados)`);
  check('processados e gravados', rows.length === ids.length, `${rows.length}/${ids.length}`);
  const perId = await prisma.message.groupBy({ by: ['externalId'], where: { externalId: { in: ids } }, _count: true });
  check('idempotência: 1 linha por id, mesmo com duplicadas', perId.every((g) => g._count === 1), `${perId.filter((g) => g._count > 1).length} ids com mais de uma linha`);
  const contacts = await prisma.contact.count({ where: { tenantId: tenant.id } });
  check('um contato por telefone (concorrência)', contacts === opt.contacts, `${contacts}/${opt.contacts}`);
  const convs = await prisma.conversation.findMany({ where: { tenantId: tenant.id }, select: { id: true, lastMessageAt: true, contact: { select: { phone: true } } } });
  check('uma conversa por contato (concorrência)', convs.length === opt.contacts, `${convs.length}/${opt.contacts}`);
  const maxTs = new Map<string, number>();
  for (const m of msgs) maxTs.set(m.phone, Math.max(maxTs.get(m.phone) ?? 0, m.ts));
  const wrongLast = convs.filter((c) => c.lastMessageAt && Math.floor(c.lastMessageAt.getTime() / 1000) !== maxTs.get(c.contact.phone));
  check('fora de ordem: lastMessageAt = mensagem mais nova', wrongLast.length === 0, `${wrongLast.length} conversas com lastMessageAt de mensagem mais velha`);

  // ---------- B. status fora de ordem (enviado/entregue/lida) ----------
  console.log(`▶ B. ${opt.status} mensagens enviadas recebendo SERVER_ACK/DELIVERY_ACK/READ embaralhados`);
  const conv = convs[0];
  const outIds = Array.from({ length: opt.status }, (_, i) => `LTS${RUN}-${i}`);
  await prisma.message.createMany({ data: outIds.map((externalId) => ({ conversationId: conv.id, numberId: number.id, direction: 'out' as const, type: 'text' as const, text: 'saída sintética', status: 'sent' as const, externalId })) });
  const statusEvents = shuffle(outIds.flatMap((id) => ['SERVER_ACK', 'DELIVERY_ACK', 'READ'].map((status) => ({ event: 'messages.update', instance: INSTANCE, date_time: localTime(), apikey, data: { keyId: id, status } }))));
  await pool(statusEvents, opt.concurrency, async (e) => { await post(e).catch(() => undefined); });
  let outRows: { status: string }[] = [];
  for (const until = Date.now() + opt.timeoutS * 1000; Date.now() < until; await sleep(500)) {
    outRows = await prisma.message.findMany({ where: { externalId: { in: outIds } }, select: { status: true } });
    if (outRows.every((r) => r.status === 'read')) break;
  }
  check('status não regride (termina em "lida")', outRows.every((r) => r.status === 'read'), `${outRows.filter((r) => r.status === 'read').length}/${outIds.length} lidas`);

  // ---------- C. webhooks inválidos ----------
  console.log('▶ C. webhooks inválidos');
  const bad = await post({ ...upsert(`LTX${RUN}-1`, phoneOf(0), 'x', base), apikey: 'errada' });
  const garbage = await post(null, '{isto não é json');
  const unknown = await post({ ...upsert(`LTX${RUN}-2`, phoneOf(0), 'x', base), instance: 'instancia-inexistente', apikey: createHmac('sha256', env.EVOLUTION_API_KEY).update('instancia-inexistente').digest('hex') });
  await sleep(3_000);
  const leaked = await prisma.message.count({ where: { externalId: { in: [`LTX${RUN}-1`, `LTX${RUN}-2`] } } });
  check('apikey errada recusada', bad.status === 401, `HTTP ${bad.status}`);
  check('corpo inválido recusado', garbage.status >= 400 && garbage.status < 500, `HTTP ${garbage.status}`);
  check('instância desconhecida não grava nada', unknown.status === 200 && leaked === 0, `HTTP ${unknown.status}, ${leaked} gravadas`);

  // ---------- D. recuperação após indisponibilidade do processamento ----------
  let drainMs: number | null = null;
  if (opt.pause > 0) {
    console.log(`▶ D. fila pausada, ${opt.pause} mensagens chegando, fila retomada`);
    const pIds = Array.from({ length: opt.pause }, (_, i) => `LTP${RUN}-${i}`);
    await queue.pause();
    try {
      await pool(pIds, opt.concurrency, async (id) => { await post(upsert(id, phoneOf(0), `pausa ${id}`, base + opt.messages + 1)).catch(() => undefined); });
      await sleep(3_000);
      const during = await prisma.message.count({ where: { externalId: { in: pIds } } });
      const waiting = (await queue.getJobCounts('waiting', 'paused')) as Record<string, number>;
      check('com a fila parada nada é processado e nada se perde', during === 0 && (waiting.waiting ?? 0) + (waiting.paused ?? 0) >= opt.pause, `${during} processadas; ${(waiting.waiting ?? 0) + (waiting.paused ?? 0)} esperando`);
    } finally {
      await queue.resume();
    }
    const r0 = Date.now();
    let n = 0;
    for (const until = Date.now() + opt.timeoutS * 1000; Date.now() < until; await sleep(250)) {
      n = await prisma.message.count({ where: { externalId: { in: pIds } } });
      if (n === pIds.length) break;
    }
    drainMs = Date.now() - r0;
    check('ao retomar, tudo é processado', n === pIds.length, `${n}/${pIds.length} em ${drainMs} ms`);
  }

  // ---------- E. connection.update fora de ordem (carimbo da guarda) ----------
  if (opt.conn > 0) {
    console.log(`▶ E. ${opt.conn} connection.update com carimbo, entregues fora de ordem`);
    const boot = Math.floor(Date.now() / 1000);
    const evs = Array.from({ length: opt.conn }, (_, i) => ({ seq: i + 1, state: i % 2 ? 'open' : 'close' }));
    if (evs.at(-1)!.state !== 'open') evs.push({ seq: evs.length + 1, state: 'open' });
    await pool(shuffle(evs), 10, async (e) => {
      await post({ event: 'connection.update', instance: INSTANCE, date_time: localTime(), apikey, data: { instance: INSTANCE, state: e.state, statusReason: e.state === 'open' ? 200 : 428, atendoBoot: boot, atendoSeq: e.seq, atendoGen: 1 } }).catch(() => undefined);
    });
    await sleep(3_000);
    const st = (await prisma.whatsAppNumber.findUnique({ where: { id: number.id }, select: { status: true } }))!.status;
    check('estado final = o do evento mais novo', st === 'connected', `status=${st} (esperado connected, seq ${evs.length})`);
  }

  const stats = await stopSampler();
  const failedAfter = (await queue.getJobCounts('failed')).failed;
  check('nenhum job falhou na fila wa-inbound', failedAfter === failedBefore, `${failedAfter - failedBefore} novos falhos`);

  const report = {
    kind: 'SIMULADO — sem WhatsApp', run: RUN, at: new Date().toISOString(), options: opt,
    events: { messages: msgs.length, duplicatesResent: dups.length, statusEvents: statusEvents.length, invalid: 3, pausedBatch: opt.pause, connectionEvents: opt.conn, total: sendList.length + statusEvents.length + 3 + opt.pause + opt.conn },
    successRate: `${checks.filter((c) => c.ok).length}/${checks.length} verificações`,
    timingMs: { sendAll: sendDoneMs, lastPersisted: procDoneMs, throughputPerS: procDoneMs ? Math.round((rows.length / procDoneMs) * 1000) : null, webhookHttp: { p50: pct(http, 50), p95: pct(http, 95) }, endToEnd: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: pct(lat, 100) }, drainAfterPause: drainMs },
    ...stats,
    checks,
  };
  const dir = resolve(__dirname, '../../../.reports');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `loadtest-${RUN}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\n▶ Resumo (simulado): ${report.successRate}; ${report.events.total} eventos; ponta a ponta p50=${report.timingMs.endToEnd.p50} ms p95=${report.timingMs.endToEnd.p95} ms; vazão ${report.timingMs.throughputPerS}/s`);
  console.log(`  ${JSON.stringify(stats)}`);
  console.log(`  relatório: ${file}`);
  if (!flag('keep')) await prisma.contact.deleteMany({ where: { tenantId: tenant.id } });
  await queue.close(); redis.disconnect(); await prisma.$disconnect();
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
