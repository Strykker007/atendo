// Monta o relatório de scripts/test/local.sh a partir dos arquivos em .reports/ (docs/30-testes-locais.md).
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const stamp = process.argv[2];
const R = '.reports';
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const results = read(`${R}/local-${stamp}.results`).trim().split('\n').filter(Boolean).map((l) => l.split('|'));
const loadFiles = results.filter(([n]) => n.startsWith('carga ')).map(([, , f]) => f).filter((f) => f?.endsWith('.json'));
const loads = loadFiles.map((f) => JSON.parse(read(`${R}/${f}`) || 'null')).filter(Boolean);
const labFile = `${R}/lab-${stamp}/evolution-lab.ndjson`;
const lab = read(labFile).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const reals = readdirSync(R).filter((f) => f.startsWith('real-') && f.endsWith('.md')).sort().slice(-3);
const v = (x) => (x === null || x === undefined ? '—' : x);

const out = [];
out.push(`# Testes locais — ${stamp}`, '');
out.push('| Etapa | Resultado | Detalhe |', '|---|---|---|');
for (const [n, r, d] of results) out.push(`| ${n} | ${r === 'ok' ? '✔ ok' : r === 'pulado' ? '— pulado' : '✖ falhou'} | ${d ?? ''} |`);

out.push('', '## 1. SIMULADO — fluxo interno do Atendo, sem WhatsApp', '');
if (!loads.length) out.push('_não executado_');
else {
  out.push('| Mensagens | Eventos | Verificações | Ponta a ponta p50 / p95 / máx (ms) | Vazão (/s) | Retomada da fila (ms) | RSS máx (MB) | Event loop p99 máx (ms) | /health p95 (ms) | Pico na fila |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const l of loads) {
    const ps = typeof l.processStats === 'object' ? l.processStats : null;
    out.push(`| ${l.events.messages} | ${l.events.total} | ${l.successRate} | ${v(l.timingMs.endToEnd.p50)} / ${v(l.timingMs.endToEnd.p95)} / ${v(l.timingMs.endToEnd.max)} | ${v(l.timingMs.throughputPerS)} | ${v(l.timingMs.drainAfterPause)} | ${v(ps?.rssMaxMb)} | ${v(ps?.eventLoopP99MaxMs)} | ${v(l.healthMs?.p95)} | ${v(l.queuePeak?.waiting)} |`);
  }
  const fails = loads.flatMap((l) => l.checks.filter((c) => !c.ok).map((c) => `- (${l.events.messages}) **${c.name}** — ${c.detail}`));
  out.push('', fails.length ? '**Falhas identificadas:**' : 'Nenhuma falha nas verificações.', ...fails);
  if (loads.some((l) => typeof l.processStats === 'string')) out.push('', '_Memória/event loop da API: suba a API com `DIAG_STATS_MS=1000` no `.env`._');
}

out.push('', '## 2. LABORATÓRIO — Evolution descartável, nenhum número pareado', '');
if (!lab.length) out.push('_não executado (`pnpm test:local -- --lab`)_');
for (const x of lab) {
  if ('connections' in x) out.push(`- **${x.scenario}** \`${x.image}\` — ${x.instances} instância(s), ${x.seconds} s: **${x.connections} tentativas de conexão** (${x.perSecond}/s); credenciais inalteradas: ${x.credsUnchanged ? '✔' : '✖'}${x.lastStats ? `; última amostra: RSS ${x.lastStats.rssMb} MB, event loop p99 ${x.lastStats.eventLoopP99Ms} ms` : ''}`);
  else if (x.scenario === 'recovery') out.push(`- **recovery** — ${x.connectionsWhileDown} tentativas enquanto fora; **recuperou em ${v(x.recoverySeconds)} s** depois de a rede voltar (${x.note})`);
  else if (x.scenario === 'concurrency') out.push(`- **concurrency** — 10 connects + 3 restarts simultâneos criaram **${x.socketsCreatedBy10Connects3Restarts} socket(s)**; juntadas: ${x.joined}; eventos de socket antigo descartados: ${x.stale}`);
}

out.push('', '## 3. WHATSAPP REAL — número de teste (roteiro manual, docs/30 › Parte 3)', '');
if (!reals.length) out.push('_nenhuma coleta ainda (`bash scripts/test/evolution-real-check.sh <instância>`)_');
for (const f of reals) out.push(`- [${f}](${f})`);
console.log(out.join('\n'));
