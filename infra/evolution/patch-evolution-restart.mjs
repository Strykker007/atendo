// Patch do restart de instância da Evolution 2.3.7 (POST /instance/restart/:name).
//
// O original fecha o socket e chama o "connect" do controller — que, vendo o estado ainda
// "open", não faz nada. Com socket zumbi (morto por baixo, estado "open": aconteceu quando a
// reconexão pedida pelo WhatsApp, stream 515, falhou no meio) o `end()` do Baileys também não
// faz nada (`if (closed) return`), então nenhum evento de "close" dispara a reconexão: o número
// fica "conectado" sem enviar nem receber, e restart nenhum resolve (Drogaria Pontual, 2026-10-13).
//
// Aqui, depois de fechar, espera a reconexão normal; se nenhum socket novo apareceu, cria um
// com as credenciais salvas (sem QR). Socket vivo segue o caminho de antes (o evento reconecta).
//
// "Socket novo" = OUTRO objeto em `client`. A 1ª versão olhava só `ws.isOpen`, e o zumbi continua
// com `isOpen` verdadeiro: o restart fechava, esperava, via "aberto" e não fazia nada (Drog. Kelly I,
// 17/10/2026 — dois restarts, nenhum evento, só o QR resolveu).
// Falha o build se não achar o trecho: versão nova pede revisão.
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['/evolution/dist/main.js', '/evolution/dist/main.mjs'];
const ORIGINAL = 'e.client?.ws?.close(),e.client?.end(new Error("restart")),await this.connectToWhatsapp({instanceName:s})';
const PATCHED = 'e.__atendoAntes=e.client,e.client?.ws?.close(),e.client?.end(new Error("restart")),await new Promise(o=>setTimeout(o,3e3)),(e.client!==e.__atendoAntes&&(e.client?.ws?.isOpen||e.client?.ws?.isConnecting)||await e.connectToWhatsapp(e.phoneNumber)),await new Promise(o=>setTimeout(o,2e3)),await this.connectionState({instanceName:s})/*atendo-restart*/';

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
