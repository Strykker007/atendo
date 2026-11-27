// Migração da mídia do disco para o S3/R2 (docs/midia-no-r2.md).
//
// Roda DENTRO do container da API (lá estão o SDK, o volume da mídia e as variáveis S3_*):
//
//   cd ~/atendo && docker compose -f infra/docker-compose.prod.yml --env-file .env.production run --rm --no-deps \
//     -v "$PWD/apps/api/scripts/storage-to-s3.mjs:/app/storage-to-s3.mjs:ro" api node storage-to-s3.mjs <modo> [opções]
//   (caminho ABSOLUTO no -v: relativo, o compose resolve a partir de infra/)
//
// Modos (sem --apply, só mostra o que faria):
//   copy          envia ao bucket o que falta (ou está com tamanho diferente), com o Content-Type do
//                 arquivo `.mime` ao lado. Retomável: o que já está lá com o mesmo tamanho é pulado.
//   verify        confere se TODO arquivo do disco está no bucket com o mesmo tamanho. Sai com 1 se faltar algo.
//   delete-local  apaga do disco só o que está no bucket com o mesmo tamanho (e o `.mime` junto).
//
// Opções: --apply  --concurrency 8  --older-than-days N (só arquivos modificados há mais de N dias)
//         --prefix media/<tenant>   (só uma parte da árvore, para testar)
//
// Nunca apaga nada do bucket. Erros e faltantes vão para storage-to-s3-erros.log na raiz do volume
// (no host: infra/volumes/storage/storage-to-s3-erros.log).

import { opendir, readFile, stat, unlink, appendFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const args = process.argv.slice(2);
const modo = args[0];
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const APPLY = flag('apply');
const CONC = Math.max(1, Math.min(64, Number(opt('concurrency', '8'))));
const OLDER_DAYS = opt('older-than-days') !== undefined ? Number(opt('older-than-days')) : null;
const PREFIX = opt('prefix', 'media');
// na raiz do volume da mídia (fora de media/, que é o que se copia): o container não escreve em /app
const ERROS = resolve(process.env.STORAGE_LOCAL_DIR || './storage', 'storage-to-s3-erros.log');

if (!['copy', 'verify', 'delete-local'].includes(modo)) {
  console.error('uso: node storage-to-s3.mjs <copy|verify|delete-local> [--apply] [--concurrency 8] [--older-than-days N] [--prefix media/<tenant>]');
  process.exit(2);
}
const { S3_ENDPOINT, S3_REGION = 'auto', S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.error('faltam S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY no ambiente');
  process.exit(2);
}
if (!/^media(\/[0-9a-zA-Z-]+)*$/.test(PREFIX)) { console.error('--prefix inválido'); process.exit(2); }

const ROOT = resolve(process.env.STORAGE_LOCAL_DIR || './storage');
const s3 = new S3Client({ region: S3_REGION, endpoint: S3_ENDPOINT || undefined, forcePathStyle: !!S3_ENDPOINT, credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } });

const st = { arquivos: 0, bytes: 0, enviados: 0, bytesEnviados: 0, jaNoBucket: 0, faltando: 0, apagados: 0, bytesApagados: 0, erros: 0, pulados: 0 };
const inicio = Date.now();
const gb = (b) => (b / 1e9).toFixed(2) + ' GB';
function progresso(fim = false) {
  const s = Math.round((Date.now() - inicio) / 1000);
  console.log(`${fim ? 'FIM' : '...'} ${s}s | arquivos ${st.arquivos} (${gb(st.bytes)}) | no bucket ${st.jaNoBucket} | ${modo === 'copy' ? `enviados ${st.enviados} (${gb(st.bytesEnviados)})` : modo === 'verify' ? `faltando ${st.faltando}` : `apagados ${st.apagados} (${gb(st.bytesApagados)})`} | pulados ${st.pulados} | erros ${st.erros}`);
}
const tick = setInterval(progresso, 15_000);
async function erro(key, e) {
  st.erros++;
  await appendFile(ERROS, `${new Date().toISOString()} ${modo} ${key} ${e?.name ?? ''} ${e?.message ?? e}\n`).catch(() => undefined);
}

/** Objetos do bucket sob um prefixo (uma pasta media/<tenant>/<mês>/): chave → tamanho. */
async function listar(prefix) {
  const out = new Map();
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) out.set(o.Key, o.Size ?? 0);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Pool simples: no máximo CONC tarefas ao mesmo tempo. */
async function emParalelo(itens, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, itens.length) }, async () => {
    while (i < itens.length) { const item = itens[i++]; await fn(item); }
  }));
}

async function processarPasta(dir) {
  const arquivos = [];
  const subpastas = [];
  for await (const d of await opendir(dir)) {
    const p = join(dir, d.name);
    if (d.isDirectory()) subpastas.push(p);
    else if (d.isFile() && !d.name.endsWith('.mime')) arquivos.push(p);
  }
  if (arquivos.length) {
    const prefixo = relative(ROOT, dir).split('\\').join('/') + '/';
    let remoto;
    try { remoto = await listar(prefixo); } catch (e) { await erro(prefixo, e); remoto = null; }
    if (remoto) await emParalelo(arquivos, (p) => umArquivo(p, remoto));
  }
  for (const sp of subpastas) await processarPasta(sp);
}

async function umArquivo(path, remoto) {
  const key = relative(ROOT, path).split('\\').join('/');
  let info;
  try { info = await stat(path); } catch (e) { return erro(key, e); }
  if (OLDER_DAYS !== null && Date.now() - info.mtimeMs < OLDER_DAYS * 86_400_000) { st.pulados++; return; }
  st.arquivos++; st.bytes += info.size;
  const noBucket = remoto.has(key) && remoto.get(key) === info.size;
  if (noBucket) st.jaNoBucket++;

  if (modo === 'verify') {
    if (!noBucket) { st.faltando++; await appendFile(ERROS, `${new Date().toISOString()} faltando ${key} (${info.size} bytes; no bucket: ${remoto.has(key) ? remoto.get(key) : 'não existe'})\n`).catch(() => undefined); }
    return;
  }
  if (modo === 'copy') {
    if (noBucket) return;
    if (!APPLY) { st.enviados++; st.bytesEnviados += info.size; return; }
    try {
      const mime = (await readFile(path + '.mime', 'utf8').catch(() => '')).trim() || 'application/octet-stream';
      await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: await readFile(path), ContentType: mime }));
      st.enviados++; st.bytesEnviados += info.size;
    } catch (e) { await erro(key, e); }
    return;
  }
  // delete-local: só o que o bucket já tem igual
  if (!noBucket) { st.pulados++; return; }
  if (!APPLY) { st.apagados++; st.bytesApagados += info.size; return; }
  try {
    await unlink(path);
    await unlink(path + '.mime').catch(() => undefined);
    st.apagados++; st.bytesApagados += info.size;
  } catch (e) { await erro(key, e); }
}

console.log(`${modo}${APPLY || modo === 'verify' ? '' : ' (SIMULAÇÃO — nada é alterado; use --apply)'} | disco ${ROOT}/${PREFIX} → bucket ${S3_BUCKET} | concorrência ${CONC}${OLDER_DAYS !== null ? ` | só mais antigos que ${OLDER_DAYS} dias` : ''}`);
try {
  await processarPasta(join(ROOT, PREFIX));
} catch (e) {
  console.error('parou:', e?.message ?? e);
  process.exitCode = 1;
}
clearInterval(tick);
progresso(true);
if (st.erros) console.log(`erros detalhados em ${ERROS}`);
if (modo === 'verify' && st.faltando) { console.log(`faltam ${st.faltando} arquivos no bucket (lista em ${ERROS})`); process.exitCode = 1; }
