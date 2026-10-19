// Exclusividade de conexão e backoff na Evolution 2.3.7 (docs/29-reconexao-evolution.md).
//
// A lógica fica em atendo/connection-guard.cjs (legível e testado); aqui só os pontos de chamada no
// bundle minificado. Cada trecho tem de aparecer UMA vez em cada arquivo, senão o build falha:
// versão nova pede revisão. Não toca em credenciais, chaves Signal, endpoints nem no formato dos
// webhooks (o connection.update só ganha 3 campos novos: atendoBoot, atendoSeq, atendoGen).
// EVOLUTION_DIST troca o diretório (testes fora da imagem).
import { readFileSync, writeFileSync } from 'node:fs';

const DIST = process.env.EVOLUTION_DIST ?? '/evolution/dist';
const GUARD = process.env.ATENDO_GUARD_PATH ?? '/evolution/atendo/connection-guard.cjs';
const MARK = '/*atendo-connection*/';
const G = 'globalThis.__atendoConn';

const PATCHES = [
  // connectToWhatsapp passa pela guarda; o corpo original vira __atendoConnect
  ['async connectToWhatsapp(e){try{return this.loadChatwoot(),this.loadSettings(),',
    `async connectToWhatsapp(e){return ${G}.connect(this,e,"api")}async __atendoConnect(e){try{return this.loadChatwoot(),this.loadSettings(),`],
  ['async reloadConnection(){try{return await this.createClient(this.phoneNumber)}',
    `async reloadConnection(){return ${G}.connect(this,this.phoneNumber,"reload")}async __atendoReload(){try{return await this.createClient(this.phoneNumber)}`],
  // socket novo: aposenta o anterior antes e numera o novo depois
  // (o makeWASocket tem nome diferente no main.js e no main.mjs: casado por regex)
  [/return this\.endSession=!1,this\.client=(\(0,[\w$]+\.default\)|[\w$]+)\(c\),/,
    (_, mk) => `return this.endSession=!1,${G}.retire(this),this.client=${mk}(c),${G}.adopt(this),`],
  // connection.update de socket aposentado não chega ao connectionUpdate
  ['eventHandler(){this.client.ev.process(async e=>{',
    `eventHandler(){let __atendoSock=this.client;this.client.ev.process(async e=>{${G}.filterStale(this,__atendoSock,e);`],
  // carimbo de ordem no estado (vai no webhook) + close recuperável agenda com backoff em vez de reconectar na hora
  [/if\(t&&\(this\.stateConnection=\{state:t,statusReason:o\?\.error\?\.output\?\.statusCode\?\?200\}\),t==="close"\)\{let i=o\?\.error\?\.output\?\.statusCode;!\[([\w$.]+)\.loggedOut,\1\.forbidden,402,406\]\.includes\(i\)\?await this\.connectToWhatsapp\(this\.phoneNumber\):\(/,
    (_, dr) => `if(t&&(this.stateConnection={state:t,statusReason:o?.error?.output?.statusCode??200,...${G}.stamp(this)}),t==="close"){let i=o?.error?.output?.statusCode;![${dr}.loggedOut,${dr}.forbidden,402,406].includes(i)?${G}.onClose(this,i,o):(${G}.onDefinitiveClose(this,i,o),`],
  ['t==="open"){this.instance.wuid=', `t==="open"){${G}.onOpen(this);this.instance.wuid=`],
  // logout e remoção cancelam qualquer reconexão pendente
  ['async logoutInstance(){this.messageProcessor.onDestroy(),', `async logoutInstance(){${G}.cancel(this,"logout"),this.messageProcessor.onDestroy(),`],
  ['this.eventEmitter.on("remove.instance",async s=>{try{', `this.eventEmitter.on("remove.instance",async s=>{try{${G}.cancel(this.waInstances[s],"remove"),`],
];

for (const file of [`${DIST}/main.js`, `${DIST}/main.mjs`]) {
  let src = readFileSync(file, 'utf8');
  if (src.includes(MARK)) { console.log(`patch connection: já aplicado em ${file}`); continue; }
  for (const [original, patched] of PATCHES) {
    const hits = typeof original === 'string' ? src.split(original).length - 1 : (src.match(new RegExp(original.source, 'g')) ?? []).length;
    if (hits !== 1) {
      console.error(`patch connection: trecho encontrado ${hits} vez(es) em ${file} — revisar o patch para esta versão:\n  ${String(original).slice(0, 90)}…`);
      process.exit(1);
    }
    src = typeof original === 'string' ? src.replace(original, () => patched) : src.replace(original, patched);
  }
  // a guarda carrega antes de qualquer código da Evolution (o bundle não tem "use strict" no topo)
  const load = file.endsWith('.mjs') ? `import ${JSON.stringify(GUARD)};${MARK}\n` : `require(${JSON.stringify(GUARD)});${MARK}\n`;
  writeFileSync(file, load + src);
  console.log(`patch connection: aplicado em ${file}`);
}
