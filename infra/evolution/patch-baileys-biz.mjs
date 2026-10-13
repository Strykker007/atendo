// Patch do Baileys da imagem da Evolution: acrescenta o nó <biz> nas mensagens de botão nativo
// (interactiveMessage / nativeFlowMessage). Sem ele o WhatsApp confirma a entrega (`delivered`)
// mas o aparelho descarta o cartão — foi o que aconteceu com o Pix "Copiar chave Pix".
// Ver docs/04-providers-whatsapp.md#chave-pix-copiar-chave-pix.
//
// Falha o build (exit 1) se não achar a âncora: versão nova do Baileys pede revisão, não um
// cartão que some em silêncio de novo.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = '/evolution/node_modules/baileys/lib/Socket/messages-send.js';
const ANCHOR = 'if (additionalNodes && additionalNodes.length > 0) {';
const MARK = 'atendoBizNodes';

let src = readFileSync(FILE, 'utf8');
if (src.includes(MARK)) {
  console.log('patch biz: já aplicado');
  process.exit(0);
}
const hits = src.split(ANCHOR).length - 1;
if (hits !== 1) {
  console.error(`patch biz: âncora encontrada ${hits} vez(es) em ${FILE} — revisar o patch para esta versão`);
  process.exit(1);
}

src = src.replace(ANCHOR, `additionalNodes = atendoBizNodes(message, additionalNodes);\n            ${ANCHOR}`);
src += `

// ---- atendo: nó <biz> dos botões nativos (infra/evolution/patch-baileys-biz.mjs) ----
function atendoBizNodes(message, nodes) {
    nodes = nodes || [];
    if (nodes.some((n) => n?.tag === 'biz')) return nodes;
    const inner = message?.viewOnceMessage?.message
        || message?.viewOnceMessageV2?.message
        || message?.viewOnceMessageV2Extension?.message
        || message?.documentWithCaptionMessage?.message
        || message;
    const flow = inner?.interactiveMessage?.nativeFlowMessage;
    if (!flow) return nodes;
    const first = flow.buttons?.[0]?.name;
    // Pix / pagamento: o WhatsApp identifica o fluxo pelo nome no próprio <biz>
    if (first === 'payment_info' || first === 'review_and_pay') {
        return [...nodes, { tag: 'biz', attrs: { native_flow_name: first === 'review_and_pay' ? 'order_details' : first } }];
    }
    // demais botões (copiar código, link, ligar, resposta rápida)
    return [...nodes, { tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] }];
}
`;
writeFileSync(FILE, src);
console.log('patch biz: aplicado');
