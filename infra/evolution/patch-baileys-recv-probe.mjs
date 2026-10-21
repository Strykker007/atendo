// Diagnóstico do "conectado, envia, não recebe" no Baileys 7.0.0-rc.9 (Balneário, Drog. Kelly I).
// Ver docs/23-evolution-desempenho.md › 12.
//
// Em 21/10/2026, com a `atendo.4` no ar, a Balneário ficou 29 min "conectada" sem receber, e nenhum
// `[atendo] tarefa travada` apareceu. As mensagens chegaram ao celular e só entraram na Evolution pelo
// histórico do QR novo — mas sem log (LOG_BAILEYS=error) não dá para saber se o WhatsApp parou de
// mandar frames para o socket ou se mandou e algo ficou sem ack.
//
// O que este patch faz (SÓ observa; não muda fluxo, ack nem fila):
//  - conta os frames recebidos por tipo (message, receipt:<type>, notification:<type>, ack:<class>,
//    sufixo `:status` para status@broadcast) e as mensagens que viraram messages.upsert;
//  - guarda message/receipt/notification/call que chegaram e ainda não receberam ack nosso;
//  - a cada ATENDO_RECV_PROBE_MS (padrão 300000; "0" desliga) e no fechamento do socket imprime uma
//    linha JSON `{"atendo":"recv-probe",...}` com contagens, há quanto tempo veio o último frame e a
//    última mensagem, e até 5 nós sem ack há mais de 60 s.
//
// Aplicar DEPOIS de patch-baileys-recv.mjs (ancora nos trechos dele).
// Falha o build (exit 1) se alguma âncora não aparecer o número esperado de vezes.
// BAILEYS_DIR troca o diretório (testes fora da imagem).
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = process.env.BAILEYS_DIR ?? '/evolution/node_modules/baileys';
const FILE = `${DIR}/lib/Socket/messages-recv.js`;
const MARK = '/*atendo-recv-probe*/';

const PROBE = `    ${MARK}
    const atendoMakeProbe = ({ ws, ev, logger, authState, intervalMs, now = Date.now, print = (line) => console.log(line) }) => {
        const TRACKED = new Set(['message', 'receipt', 'notification', 'call']);
        const MAX_PENDING = 2000;
        const instance = (() => { try { return logger.bindings?.().instance; } catch { return undefined; } })();
        const startedAt = now();
        // nó recebido -> resumo; sai quando mandamos ack/recibo (mesmo objeto do frame)
        const pending = new Map();
        let frames = {};
        let upserts = 0;
        let lastFrameAt = 0;
        let lastMessageAt = 0;
        const agoS = (t, at) => (at ? Math.round((t - at) / 1000) : null);
        const onFrame = (frame) => {
            if (!frame || frame instanceof Uint8Array || !frame.tag) return;
            const t = now();
            const attrs = frame.attrs || {};
            lastFrameAt = t;
            let key = frame.tag;
            if (frame.tag === 'ack') key += ':' + (attrs.class ?? '');
            else if (frame.tag === 'receipt') key += ':' + (attrs.type ?? 'delivery');
            else if (frame.tag === 'notification') key += ':' + (attrs.type ?? '');
            if (attrs.from === 'status@broadcast') key += ':status';
            frames[key] = (frames[key] ?? 0) + 1;
            if (!TRACKED.has(frame.tag)) return;
            if (frame.tag === 'message') lastMessageAt = t;
            if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
            pending.set(frame, { tag: frame.tag, id: attrs.id, type: attrs.type, category: attrs.category, status: attrs.from === 'status@broadcast' || undefined, offline: !!attrs.offline || undefined, t });
        };
        const report = (reason) => {
            const t = now();
            const stuck = [];
            let pendingOld = 0;
            for (const [node, p] of pending) {
                const age = t - p.t;
                if (age > 3600000) { pending.delete(node); continue; }
                if (age < 60000) continue;
                pendingOld++;
                if (stuck.length < 5) stuck.push({ tag: p.tag, id: p.id, type: p.type, category: p.category, status: p.status, offline: p.offline, ageS: Math.round(age / 1000) });
            }
            print(JSON.stringify({
                atendo: 'recv-probe', time: new Date(t).toISOString(), instance: instance ?? authState?.creds?.me?.id, reason,
                socketAgeS: agoS(t, startedAt), lastFrameAgoS: agoS(t, lastFrameAt), lastMessageAgoS: agoS(t, lastMessageAt),
                frames, upserts, pending: pending.size, pendingOld, stuck,
            }));
            frames = {};
            upserts = 0;
        };
        ws.on('frame', onFrame);
        ev.on('messages.upsert', ({ messages }) => { upserts += messages?.length ?? 0; });
        const timer = setInterval(() => { if (ws.isOpen) report('interval'); }, intervalMs);
        timer.unref?.();
        ws.on('close', () => {
            clearInterval(timer);
            if (lastFrameAt) report('close');
            pending.clear();
        });
        return { acked: (node) => { pending.delete(node); }, report };
    };
    /*atendo-recv-probe-end*/
    const atendoProbe = process.env.ATENDO_RECV_PROBE_MS === '0'
        ? { acked: () => {} }
        : atendoMakeProbe({ ws, ev, logger, authState, intervalMs: Number(process.env.ATENDO_RECV_PROBE_MS) || 300000 });
`;

// [trecho original (já com patch-baileys-recv.mjs), substituto, quantas vezes o original aparece]
const PATCHES = [
  // depois dos auxiliares do patch recv: ws, ev, logger e authState já existem aqui
  [`    const atendoAcked = new WeakSet();
`, `    const atendoAcked = new WeakSet();
${PROBE}`, 1],
  // todo ack passa por aqui
  [`        atendoAcked.add(atendoNode);
`, `        atendoAcked.add(atendoNode);
        atendoProbe.acked(atendoNode);
`, 1],
  // recibo de entrega também confirma a mensagem para o servidor
  [`                        atendoAcked.add(node);
`, `                        atendoAcked.add(node);
                        atendoProbe.acked(node);
`, 1],
];

let src = readFileSync(FILE, 'utf8');
if (src.includes(MARK)) {
  console.log(`patch recv-probe: já aplicado em ${FILE}`);
  process.exit(0);
}
if (!src.includes('/*atendo-recv*/')) {
  console.error(`patch recv-probe: aplicar depois de patch-baileys-recv.mjs (${FILE} sem /*atendo-recv*/)`);
  process.exit(1);
}
for (const [original, patched, expected] of PATCHES) {
  const hits = src.split(original).length - 1;
  if (hits !== expected) {
    console.error(`patch recv-probe: trecho encontrado ${hits} vez(es) (esperado ${expected}) em ${FILE} — revisar o patch para esta versão:\n  ${original.trim().slice(0, 90)}…`);
    process.exit(1);
  }
  src = src.split(original).join(patched);
}
writeFileSync(FILE, src);
console.log(`patch recv-probe: aplicado em ${FILE}`);
