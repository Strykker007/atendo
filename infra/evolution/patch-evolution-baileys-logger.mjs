// Nome da instância nos logs do Baileys (Evolution 2.3.7).
//
// O logger que a Evolution passa ao Baileys não diz de qual número é a linha: em 19/10/2026 os
// erros de decifragem e de processamento só foram atribuídos a Balneário/Marttins decodificando o
// `verified_name` em hex dos nós (docs/23-evolution-desempenho.md › 10). Com `.child({instance})`,
// cada linha do Baileys sai com o nome da instância. Não muda nível nem conteúdo dos logs.
//
// Os nomes minificados mudam entre main.js e main.mjs: casados por regex. Falha o build se não achar.
// EVOLUTION_DIST troca o diretório (testes fora da imagem).
import { readFileSync, writeFileSync } from 'node:fs';

const DIST = process.env.EVOLUTION_DIST ?? '/evolution/dist';
const MARK = '/*atendo-baileys-logger*/';
const CHILD = '.child({instance:this.instanceName})';

const PATCHES = [
  // logger do socket
  [/logger:((?:\(0,[\w$]+\.default\)|[\w$]+)\(\{level:this\.logBaileys\}\)),printQRInTerminal:/g,
    (_, l) => `logger:${l}${CHILD}${MARK},printQRInTerminal:`],
  // logger do key store (transações das chaves Signal)
  [/\(this\.instance\.authState\.state\.keys,((?:\(0,[\w$]+\.default\)|[\w$]+)\(\{level:"error"\}\))\)/g,
    (_, l) => `(this.instance.authState.state.keys,${l}${CHILD})`],
];

for (const file of [`${DIST}/main.js`, `${DIST}/main.mjs`]) {
  let src = readFileSync(file, 'utf8');
  if (src.includes(MARK)) { console.log(`patch baileys-logger: já aplicado em ${file}`); continue; }
  for (const [re, fn] of PATCHES) {
    const hits = (src.match(re) ?? []).length;
    if (hits !== 1) {
      console.error(`patch baileys-logger: trecho encontrado ${hits} vez(es) em ${file} — revisar o patch para esta versão:\n  ${re.source.slice(0, 90)}…`);
      process.exit(1);
    }
    src = src.replace(re, fn);
  }
  writeFileSync(file, src);
  console.log(`patch baileys-logger: aplicado em ${file}`);
}
