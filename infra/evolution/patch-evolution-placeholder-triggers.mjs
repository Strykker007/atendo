// Gatilhos de texto do messages.upsert da Evolution 2.3.7 (docs/26-backport-cve-2026-48063.md).
//
// A Evolution herdou do exemplo do Baileys dois comandos por texto e os executa para QUALQUER
// remetente: um contato que mande "requestPlaceholder" faz a nossa sessão pedir reenvio de
// placeholder ao celular, e "onDemandHistSync" pede 50 mensagens de histórico — o mesmo caminho de
// pedido/resposta (PDO) que a CVE-2026-48063 explora na volta. Aqui só valem quando quem escreveu
// foi o dono do número, no próprio celular (`key.fromMe`): o uso legítimo (depuração pelo aparelho)
// continua; contato nenhum dispara mais. A mensagem em si segue o caminho normal (banco + webhook).
//
// O Atendo não usa nenhum dos dois. Falha o build se não achar o trecho: versão nova pede revisão.
// EVOLUTION_DIST troca o diretório (testes fora da imagem).
import { readFileSync, writeFileSync } from 'node:fs';

const DIST = process.env.EVOLUTION_DIST ?? '/evolution/dist';
const FILES = [`${DIST}/main.js`, `${DIST}/main.mjs`];
const MARK = '/*atendo-placeholder-triggers*/';
// `n` = mensagem recebida, `h` = texto, `o` = requestId (bundle minificado da 2.3.7)
const PATCHES = [
  ['if(h=="requestPlaceholder"&&!o){', `if(h=="requestPlaceholder"&&!o&&n.key?.fromMe===!0${MARK}){`],
  ['if(h=="onDemandHistSync"){', 'if(h=="onDemandHistSync"&&n.key?.fromMe===!0){'],
];

for (const file of FILES) {
  let src = readFileSync(file, 'utf8');
  if (src.includes(MARK)) { console.log(`patch placeholder: já aplicado em ${file}`); continue; }
  for (const [original, patched] of PATCHES) {
    const hits = src.split(original).length - 1;
    if (hits !== 1) {
      console.error(`patch placeholder: trecho encontrado ${hits} vez(es) em ${file} — revisar o patch para esta versão`);
      process.exit(1);
    }
    src = src.replace(original, patched);
  }
  writeFileSync(file, src);
  console.log(`patch placeholder: aplicado em ${file}`);
}
