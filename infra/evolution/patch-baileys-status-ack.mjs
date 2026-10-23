// Ack da stanza <status> no Baileys 7.0.0-rc.9 da imagem da Evolution 2.3.7.
// Ver docs/23-evolution-desempenho.md › 13 e Baileys#2858 / PR #2866 (ainda aberto em 23/10/2026).
//
// O WhatsApp passou a entregar os status (stories) dos contatos, em parte das contas, como stanza
// <status> de topo em vez de <message from="status@broadcast">. O Baileys (rc.9, rc14 e master) só
// registra message, call, receipt, notification e ack,class:message: o <status> nunca recebe ack.
// ~50 min depois o servidor encerra o stream cobrando o ack (`<ack class="status" type="media">`,
// "Stream Errored (ack)" = 500), reentrega os mesmos <status> no offline da próxima conexão, e assim
// por diante. Quando os <status> pendentes enchem o lote offline (~100), nada mais passa: o número
// fica "conectado", envia e não recebe (Balneário desde 22/10 20:25, Drog. Kelly I).
//
// O que este patch muda: ack imediato de todo <status>, sem código de erro (NACK deixaria a stanza
// pendente no servidor), pelo sendMessageAck que já existe — no rc.9 ele monta class="status" e
// mantém type, participant e recipient. A stanza não é decodificada (o Atendo não usa status),
// igual ao whatsmeow (tulir/whatsmeow@a238105488).
//
// Independe dos outros patches. Falha o build (exit 1) se não achar a âncora: versão nova do
// Baileys pede revisão (se o upstream passar a tratar <status>, este patch sai).
// BAILEYS_DIR troca o diretório (testes fora da imagem).
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = process.env.BAILEYS_DIR ?? '/evolution/node_modules/baileys';
const FILE = `${DIR}/lib/Socket/messages-recv.js`;
const MARK = '/*atendo-status-ack*/';

const ORIGINAL = `    ws.on('CB:ack,class:message', (node) => {
`;
const PATCHED = `    ${MARK}
    // <status> (stories) precisa de ack, ou o servidor derruba o stream ~50 min depois (Baileys#2858)
    ws.on('CB:status', (node) => {
        sendMessageAck(node).catch(error => onUnexpectedError(error, 'acking status'));
    });
${ORIGINAL}`;

let src = readFileSync(FILE, 'utf8');
if (src.includes(MARK)) {
  console.log(`patch status-ack: já aplicado em ${FILE}`);
  process.exit(0);
}
if (src.includes(`ws.on('CB:status'`)) {
  console.error(`patch status-ack: ${FILE} já trata CB:status — o upstream corrigiu, remover este patch`);
  process.exit(1);
}
const hits = src.split(ORIGINAL).length - 1;
if (hits !== 1) {
  console.error(`patch status-ack: trecho encontrado ${hits} vez(es) em ${FILE} — revisar o patch para esta versão`);
  process.exit(1);
}
writeFileSync(FILE, src.replace(ORIGINAL, PATCHED));
console.log(`patch status-ack: aplicado em ${FILE}`);
