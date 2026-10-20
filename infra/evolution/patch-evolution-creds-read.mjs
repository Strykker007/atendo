// Credencial pareada não pode ser trocada por uma nova quando a LEITURA falha (Evolution 2.3.7).
// Ver docs/23-evolution-desempenho.md › 9 (19/10/2026: 15 números perderam o pareamento).
//
// No auth state do Prisma (useMultiFileAuthStatePrisma) a leitura engole qualquer erro e devolve
// null, e quem chama faz `creds = lida || initAuthCreds()` e GRAVA. Com o banco estourando o tempo,
// a credencial pareada foi sobrescrita por uma vazia: o aparelho continuava vinculado no celular,
// mas a sessão local virou "QR pendente".
//
// O patch: se a leitura veio vazia, confirma no banco que a sessão realmente não existe antes de
// criar credencial nova. Existe (leitura falhou ou veio corrompida) ou o banco não responde → lança
// erro e NÃO grava nada. O connect falha e a guarda de conexão tenta de novo com backoff
// (atendo/connection-guard.cjs, `create_failed`); no clique manual, o erro volta para quem chamou.
// Instância nova (sem linha na Session) e logout (que apaga a linha) seguem criando credencial.
//
// Os nomes minificados mudam entre main.js e main.mjs: casados por regex. Falha o build se não achar.
// EVOLUTION_DIST troca o diretório (testes fora da imagem).
import { readFileSync, writeFileSync } from 'node:fs';

const DIST = process.env.EVOLUTION_DIST ?? '/evolution/dist';
const MARK = '/*atendo-creds-read*/';

// leitura da credencial: `async function pu(p){try{if(!await jn(p))return null;let e=await B.session.findUnique(`
// — dá o nome do cliente Prisma (B no main.js, U no main.mjs)
const READ = /async function [\w$]+\(p\)\{try\{if\(!await [\w$]+\(p\)\)return null;let e=await ([\w$]+)\.session\.findUnique\(\{where:\{sessionId:p\}\}\);return JSON\.parse\(e\?\.creds\)\}catch\{return null\}\}/g;
// ponto que cria e grava credencial nova quando a lida veio vazia
const INIT = /let a=await i\("creds"\);return a\|\|\(a=(\(0,[\w$.]+\.initAuthCreds\)|[\w$]+)\(\),await o\(a,"creds"\)\)/g;

for (const file of [`${DIST}/main.js`, `${DIST}/main.mjs`]) {
  const src = readFileSync(file, 'utf8');
  if (src.includes(MARK)) { console.log(`patch creds-read: já aplicado em ${file}`); continue; }
  const reads = [...src.matchAll(READ)];
  const inits = [...src.matchAll(INIT)];
  if (reads.length !== 1 || inits.length !== 1) {
    console.error(`patch creds-read: leitura ${reads.length}x, criação ${inits.length}x em ${file} (esperado 1 e 1) — revisar o patch para esta versão`);
    process.exit(1);
  }
  const prisma = reads[0][1];
  const init = inits[0][1];
  const patched =
    `let a=await i("creds");${MARK}if(!a&&await ${prisma}.session.findUnique({where:{sessionId:p},select:{sessionId:!0}}))` +
    `throw new Error("[atendo] credencial salva desta instância não pôde ser lida — conexão adiada para não sobrescrever o pareamento");` +
    `return a||(a=${init}(),await o(a,"creds"))`;
  writeFileSync(file, src.replace(INIT, () => patched));
  console.log(`patch creds-read: aplicado em ${file} (prisma=${prisma})`);
}
