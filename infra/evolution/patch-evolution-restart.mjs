// Patch do restart de instância da Evolution 2.3.7 (POST /instance/restart/:name).
//
// O original fecha o socket e chama o "connect" do controller — que, vendo o estado ainda
// "open", não faz nada. Com socket zumbi (morto por baixo, estado "open"), o `end()` do Baileys
// também não faz nada (`if (closed) return`): o número fica "conectado" sem enviar nem receber,
// e restart nenhum resolve (Drogaria Pontual, 2026-10-13; Drog. Kelly I, 17/10/2026).
//
// Desde a etapa 3 (docs/29-reconexao-evolution.md) o restart delega à guarda de conexão
// (atendo/connection-guard.cjs, carregada por patch-evolution-connection.mjs): ela aposenta o
// socket atual — o close dele não dispara outra reconexão —, cria UM socket novo com as
// credenciais salvas (sem QR) e junta restarts simultâneos numa operação só. A versão anterior
// esperava 3 s e criava outro socket se o objeto não tivesse mudado, e podia correr junto com a
// reconexão da própria Evolution (dois sockets → 440).
// Falha o build se não achar o trecho: versão nova pede revisão.
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['/evolution/dist/main.js', '/evolution/dist/main.mjs'];
const ORIGINAL = 'e.client?.ws?.close(),e.client?.end(new Error("restart")),await this.connectToWhatsapp({instanceName:s})';
const PATCHED = 'await globalThis.__atendoConn.restart(e),await new Promise(o=>setTimeout(o,2e3)),await this.connectionState({instanceName:s})/*atendo-restart*/';

for (const file of FILES) {
  let src = readFileSync(file, 'utf8');
  if (src.includes('/*atendo-restart*/')) { console.log(`patch restart: já aplicado em ${file}`); continue; }
  const hits = src.split(ORIGINAL).length - 1;
  if (hits !== 1) {
    console.error(`patch restart: trecho encontrado ${hits} vez(es) em ${file} — revisar o patch para esta versão`);
    process.exit(1);
  }
  writeFileSync(file, src.replace(ORIGINAL, PATCHED));
  console.log(`patch restart: aplicado em ${file}`);
}
