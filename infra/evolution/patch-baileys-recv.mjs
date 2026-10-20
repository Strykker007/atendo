// Recebimento que não trava no Baileys 7.0.0-rc.9 da imagem da Evolution 2.3.7.
// Ver docs/23-evolution-desempenho.md › 10 e docs/04-providers-whatsapp.md#parou-de-receber.
//
// Sintoma (Balneário 4x, Marttins, Drog. Kelly I): número "conectado", envia, a sonda responde, e
// nada chega — nem mensagem nem confirmação de entrega. Reiniciar não resolve; ler o QR resolve.
// No rc.9 mensagens, recibos e notificações passam pela MESMA fila serial (`processingMutex`), sem
// prazo; e o processador de nós offline faz `await nodeProcessor(node)` sem try — uma exceção deixa
// `isProcessing = true` para sempre. Mensagem que falha sai sem ack, e o servidor a entrega de novo
// a cada reconexão (por isso o reinício não resolvia). O upstream corrigiu no rc.10 ("Fix
// connection deadlocks", "Mutex redesign", "Proper ack handling", "improved offline node batching").
//
// O que este patch muda (só o fluxo de recebimento; não toca em credenciais nem chaves):
//  1. Prazo por tarefa na fila de processamento (e na de retry): tarefa que não termina em
//     ATENDO_RECV_TASK_TIMEOUT_MS (padrão 120 s) é registrada e a fila segue. A tarefa travada
//     continua rodando por trás; só deixa de segurar as outras.
//  2. Processador offline: erro em um nó é registrado e o loop segue para o próximo.
//  3. Mensagem que falha recebe ack com erro (NACK UnhandledError, como o Baileys já faz quando a
//     decifragem falha) se ainda não recebeu recibo — o servidor para de reentregá-la. Vale também
//     para erro antes do try original (decodificação, migração de LID).
//
// Falha o build (exit 1) se alguma âncora não aparecer o número esperado de vezes.
// BAILEYS_DIR troca o diretório (testes fora da imagem).
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = process.env.BAILEYS_DIR ?? '/evolution/node_modules/baileys';
const FILE = `${DIR}/lib/Socket/messages-recv.js`;
const MARK = '/*atendo-recv*/';

// [trecho original, substituto, quantas vezes o original aparece]
const PATCHES = [
  // auxiliares: prazo nas filas + nós que já receberam ack/recibo
  [`    const retryMutex = makeMutex();
`, `    const retryMutex = makeMutex();
    ${MARK}
    const atendoTaskTimeoutMs = Number(process.env.ATENDO_RECV_TASK_TIMEOUT_MS) || 120000;
    // nós (stanzas) que já receberam ack ou recibo — o NACK de erro só vai para quem não recebeu nada
    const atendoAcked = new WeakSet();
    // tarefa da fila com prazo: travou, registra e libera a fila (a tarefa segue rodando por trás)
    const atendoTimed = (mutex, label, code) => mutex.mutex(() => new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            logger.error({ label, timeoutMs: atendoTaskTimeoutMs }, '[atendo] tarefa travada na fila de processamento — liberando a fila');
            resolve(undefined);
        }, atendoTaskTimeoutMs);
        Promise.resolve().then(code).then((value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
    }));
`, 1],
  // todo ack passa por aqui: marca o nó
  [`    const sendMessageAck = async ({ tag, attrs, content }, errorCode) => {
`, `    const sendMessageAck = async (atendoNode, errorCode) => {
        atendoAcked.add(atendoNode);
        const { tag, attrs, content } = atendoNode;
`, 1],
  // recibo de entrega também confirma a mensagem para o servidor
  [`                        await sendReceipt(msg.key.remoteJid, participant, [msg.key.id], type);
`, `                        await sendReceipt(msg.key.remoteJid, participant, [msg.key.id], type);
                        atendoAcked.add(node);
`, 1],
  // fila de processamento com prazo: recibo (1º), notificação (2º) e mensagem (3º)
  [`processingMutex.mutex(async () => {`, `atendoTimed(processingMutex, 'processing', async () => {`, 3],
  [`await retryMutex.mutex(async () => {`, `await atendoTimed(retryMutex, 'retry', async () => {`, 1],
  // a função original vira a "interna"; o invólucro abaixo pega o que escapa do try dela
  [`    const handleMessage = async (node) => {
        if (shouldIgnoreJid(node.attrs.from) && node.attrs.from !== S_WHATSAPP_NET) {`,
   `    const atendoHandleMessage = async (node) => {
        if (shouldIgnoreJid(node.attrs.from) && node.attrs.from !== S_WHATSAPP_NET) {`, 1],
  [`        catch (error) {
            logger.error({ error, node: binaryNodeToString(node) }, 'error in handling message');
        }
    };
    const handleCall = async (node) => {`,
   `        catch (error) {
            logger.error({ error, node: binaryNodeToString(node) }, 'error in handling message');
            if (!atendoAcked.has(node)) {
                await sendMessageAck(node, NACK_REASONS.UnhandledError).catch(err => logger.warn({ err }, '[atendo] falha ao enviar NACK'));
            }
        }
    };
    // erro antes do try original (decodificação, migração de LID) também não pode deixar o nó sem ack
    const handleMessage = async (node) => {
        try {
            await atendoHandleMessage(node);
        }
        catch (error) {
            logger.error({ error, node: binaryNodeToString(node) }, '[atendo] erro ao tratar mensagem (antes do processamento)');
            if (!atendoAcked.has(node)) {
                await sendMessageAck(node, NACK_REASONS.UnhandledError).catch(err => logger.warn({ err }, '[atendo] falha ao enviar NACK'));
            }
        }
    };
    const handleCall = async (node) => {`, 1],
  // processador offline: erro em um nó não para o loop
  [`                    await nodeProcessor(node);
`, `                    try {
                        await nodeProcessor(node);
                    }
                    catch (error) {
                        onUnexpectedError(error, \`[atendo] processing offline \${type}\`);
                    }
`, 1],
];

let src = readFileSync(FILE, 'utf8');
if (src.includes(MARK)) {
  console.log(`patch recv: já aplicado em ${FILE}`);
  process.exit(0);
}
for (const [original, patched, expected] of PATCHES) {
  const hits = src.split(original).length - 1;
  if (hits !== expected) {
    console.error(`patch recv: trecho encontrado ${hits} vez(es) (esperado ${expected}) em ${FILE} — revisar o patch para esta versão:\n  ${original.trim().slice(0, 90)}…`);
    process.exit(1);
  }
  src = src.split(original).join(patched);
}
writeFileSync(FILE, src);
console.log(`patch recv: aplicado em ${FILE}`);
