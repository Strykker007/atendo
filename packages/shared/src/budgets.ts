import type { PixKeyType } from './messages.js';

/**
 * Orçamento/pedido com link público (docs/orcamentos.md). Dois jeitos: só o link (itens e valores
 * na página) ou orçamento por texto → cliente aprova → link (`budgetQuoteText`). Chave Pix nunca
 * vai na conversa.
 */
export const BUDGET_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'REFUNDED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];
export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = { PENDING: 'Aguardando pagamento', PAID: 'Pago', EXPIRED: 'Expirado', REFUNDED: 'Estornado' };

/** Teto de `validHours` (API). A tela usa as opções de `BUDGET_VALIDITY`. */
export const BUDGET_DEFAULT_HOURS = 48;
export const BUDGET_MAX_HOURS = 24 * 30;

/**
 * Validade do orçamento (docs/orcamentos.md#vencimento). `end_of_day` = 23:59:59 do dia, no fuso
 * da empresa — o padrão: proposta de farmácia vale para hoje. Mínimo de 30 min (gerado às 23:50
 * não vence em 9 min: vai para 00:20).
 */
export const BUDGET_VALIDITY = ['1h', '2h', '4h', '8h', 'end_of_day', '24h', '48h'] as const;
export type BudgetValidity = (typeof BUDGET_VALIDITY)[number];
export const BUDGET_VALIDITY_LABEL: Record<BudgetValidity, string> = { '1h': '1 hora', '2h': '2 horas', '4h': '4 horas', '8h': '8 horas', end_of_day: 'Até o fim do dia', '24h': '24 horas', '48h': '48 horas' };
export const BUDGET_DEFAULT_VALIDITY: BudgetValidity = 'end_of_day';
export const BUDGET_MIN_VALIDITY_MIN = 30;
/**
 * Tolerância depois do vencimento antes de cancelar a cobrança no Asaas. No vencimento a página
 * já some com o QR; quem colou o código antes tem estes minutos para o banco processar.
 */
export const BUDGET_GRACE_MINUTES = 10;
export const BUDGET_MAX_ITEMS = 50;
/** Comprovante pela página pública: imagem ou PDF, até este tamanho. */
export const BUDGET_RECEIPT_MAX_MB = 10;
export const BUDGET_RECEIPT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export interface BudgetItem {
  name: string;
  /** dosagem/apresentação ("500 mg, 30 comprimidos") */
  dosage?: string;
  quantity: number;
  /** valor unitário em R$ */
  unitPrice: number;
}

/** Soma em centavos para não acumular erro de float. */
export const budgetTotal = (items: Pick<BudgetItem, 'quantity' | 'unitPrice'>[]) =>
  items.reduce((s, i) => s + Math.round(i.quantity * Math.round(i.unitPrice * 100)), 0) / 100;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Pedido de aprovação: o cliente aprova respondendo a forma de pagamento (só Pix leva link). */
export const BUDGET_APPROVAL_TEXT = 'Para aprovar o orçamento, me informe qual a forma de pagamento';

/**
 * Orçamento com aprovação (docs/orcamentos.md#orçamento-com-aprovação): a mensagem com os itens
 * vai por texto, sem chave Pix nem link. Formatação do WhatsApp (*negrito*, _itálico_).
 */
export function budgetQuoteText(b: { number: number | string; items: BudgetItem[]; totalValue: number; expiresAt: string | Date; note?: string | null }, opts: { firstName?: string; timeZone?: string } = {}) {
  const linha = '━━━━━━━━━━━━━━━';
  const venc = new Date(b.expiresAt);
  const fmt = (o: Intl.DateTimeFormatOptions) => venc.toLocaleString('pt-BR', { ...o, ...(opts.timeZone && { timeZone: opts.timeZone }) });
  const itens = b.items.map((i, n) => [
    `*${n + 1}. ${i.name}*`,
    ...(i.dosage ? [`     _${i.dosage}_`] : []),
    `     ${i.quantity} × ${brl(i.unitPrice)} = ${brl(Math.round(i.quantity * Math.round(i.unitPrice * 100)) / 100)}`,
  ].join('\n'));
  return [
    `🧾 *ORÇAMENTO Nº ${b.number}*`,
    ...(opts.firstName ? [`Cliente: ${opts.firstName}`] : []),
    linha,
    itens.join('\n\n'),
    linha,
    `*TOTAL: ${brl(b.totalValue)}*`,
    `📅 Válido até ${fmt({ day: '2-digit', month: '2-digit' })} às ${fmt({ hour: '2-digit', minute: '2-digit' })}`,
    ...(b.note ? [`📝 ${b.note}`] : []),
    '',
    `✅ ${BUDGET_APPROVAL_TEXT}`,
  ].join('\n');
}

/**
 * Configurações → Atendimento → Orçamento por mensagem: quando os itens vão no texto.
 * Começa em `link` (itens nunca no texto); a empresa liga `protect` (decide por `budgetRiskTerms`) ou `always`.
 */
export const BUDGET_QUOTE_ITEMS = ['link', 'protect', 'always'] as const;
export type BudgetQuoteItems = (typeof BUDGET_QUOTE_ITEMS)[number];
export const BUDGET_QUOTE_ITEMS_LABEL: Record<BudgetQuoteItems, { titulo: string; desc: string }> = {
  protect: { titulo: 'Enviar itens, protegendo os sensíveis', desc: 'Orçamento simples vai completo na mensagem; com remédio, dosagem ou controlado, vão só número e total — os itens ficam no link.' },
  always: { titulo: 'Sempre enviar os itens na mensagem', desc: 'Itens e valores sempre no texto, inclusive os sensíveis. Risco de bloqueio do número por conta da empresa.' },
  link: { titulo: 'Não enviar os itens na mensagem (padrão)', desc: 'A mensagem leva só número, total e o link; os itens o cliente vê na página.' },
};

/** Os itens vão no texto do orçamento? */
export const budgetQuoteShowsItems = (mode: BudgetQuoteItems | undefined, items: Pick<BudgetItem, 'name' | 'dosage'>[], note?: string | null) =>
  mode === 'always' ? true : mode === 'protect' ? budgetRiskTerms(items, note).length === 0 : false;

/**
 * Termos que fazem o orçamento por texto ir **sem os itens** (docs/orcamentos.md#itens-sensíveis):
 * dosagem/apresentação de remédio e nomes que costumam derrubar número (controlados, emagrecedores,
 * anabolizantes). Na dúvida, esconde — o cliente vê tudo no link do mesmo jeito.
 */
const RISCO_UNIDADE = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|ml|g|ui)(?![a-z])/i;
const RISCO_PALAVRAS = [
  // forma farmacêutica e prescrição
  'comprimido', 'comprimidos', 'comp', 'capsula', 'capsulas', 'caps', 'ampola', 'ampolas', 'gotas', 'xarope', 'injetavel', 'injecao', 'pomada', 'drageas',
  'medicamento', 'medicamentos', 'remedio', 'remedios', 'generico', 'receita', 'tarja', 'controlado', 'controlada', 'manipulado', 'manipulada',
  // emagrecedores e similares
  'ozempic', 'wegovy', 'mounjaro', 'saxenda', 'semaglutida', 'tirzepatida', 'liraglutida', 'sibutramina', 'orlistat',
  // controlados (tarja preta / receita retida)
  'rivotril', 'clonazepam', 'alprazolam', 'diazepam', 'lorazepam', 'zolpidem', 'ritalina', 'metilfenidato', 'venvanse', 'lisdexanfetamina',
  'tramadol', 'codeina', 'morfina', 'oxicodona', 'pregabalina', 'quetiapina', 'misoprostol', 'cytotec', 'roacutan', 'isotretinoina',
  // disfunção erétil
  'viagra', 'cialis', 'sildenafila', 'tadalafila',
  // anabolizantes
  'anabolizante', 'anabolizantes', 'testosterona', 'durateston', 'deca', 'oxandrolona', 'stanozolol', 'trembolona', 'hormonio', 'gh',
  // cannabis
  'cannabis', 'canabidiol', 'cbd', 'thc',
];
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** O que no orçamento parece sensível (vazio = pode ir por texto com os itens). */
export function budgetRiskTerms(items: Pick<BudgetItem, 'name' | 'dosage'>[], note?: string | null): string[] {
  const achados = new Set<string>();
  for (const texto of [...items.flatMap((i) => [i.name, i.dosage ?? '']), note ?? '']) {
    const t = semAcento(texto);
    const unidade = t.match(RISCO_UNIDADE);
    if (unidade) achados.add(unidade[0].trim());
    for (const w of t.split(/[^a-z0-9]+/)) if (RISCO_PALAVRAS.includes(w)) achados.add(w);
  }
  return [...achados];
}

/**
 * Orçamento por texto com itens sensíveis: vai só número, quantidade de itens e total; os itens
 * ficam no link (que mostra o orçamento sem pagamento até a aprovação).
 */
export function budgetQuoteLinkText(b: { number: number | string; items: BudgetItem[]; totalValue: number; expiresAt: string | Date }, link: string, opts: { firstName?: string; timeZone?: string } = {}) {
  const venc = new Date(b.expiresAt);
  const fmt = (o: Intl.DateTimeFormatOptions) => venc.toLocaleString('pt-BR', { ...o, ...(opts.timeZone && { timeZone: opts.timeZone }) });
  const n = b.items.length;
  return [
    `🧾 *ORÇAMENTO Nº ${b.number}*`,
    ...(opts.firstName ? [`Cliente: ${opts.firstName}`] : []),
    '━━━━━━━━━━━━━━━',
    `${n} ${n === 1 ? 'item' : 'itens'} · *TOTAL: ${brl(b.totalValue)}*`,
    `📅 Válido até ${fmt({ day: '2-digit', month: '2-digit' })} às ${fmt({ hour: '2-digit', minute: '2-digit' })}`,
    '',
    `🔒 Veja os itens do orçamento: ${link}`,
    '',
    `✅ ${BUDGET_APPROVAL_TEXT}`,
  ].join('\n');
}

/** Mensagem do link depois da aprovação: número e total junto, para o cliente conferir antes de pagar. */
export const budgetLinkText = (b: { number: number; totalValue: number }, link: string, firstName?: string) =>
  `✅ ${firstName ? `${firstName}, seu orçamento` : 'Orçamento'} *Nº ${b.number}* foi aprovado.\nTotal: *${brl(b.totalValue)}*\n\nPara pagar, acesse: ${link}`;

/** Aprovado para cartão ou dinheiro: confirma número e total, sem link nem Pix. */
export const budgetApprovedText = (b: { number: number; totalValue: number }, firstName?: string) =>
  `✅ ${firstName ? `${firstName}, seu orçamento` : 'Orçamento'} *Nº ${b.number}* foi aprovado.\nTotal: *${brl(b.totalValue)}*`;

/** O que a página pública recebe — nada do contato além do primeiro nome. */
export interface PublicBudget {
  /** "Orçamento Nº 42"; null nos anteriores à numeração */
  number: number | null;
  /** enviado por texto, esperando o cliente aprovar: mostra os itens, sem pagamento */
  awaitingApproval: boolean;
  tenantName: string;
  /** logo da empresa (Configurações → Páginas públicas), URL assinada curta; null = a marca do painel */
  logoUrl: string | null;
  contactFirstName: string | null;
  agentName: string;
  items: BudgetItem[];
  totalValue: number;
  status: BudgetStatus;
  expiresAt: string;
  createdAt: string;
  note: string | null;
  /** só enquanto PENDING: pago ou expirado não mostra como pagar */
  pix: { key: string; keyType: PixKeyType; holderName: string } | null;
  paymentUrl: string | null;
  receiptSent: boolean;
  /** Pix automático: o cliente gera a cobrança na página (pede CPF) e o webhook dá a baixa */
  autoPix: boolean;
  /** cobrança já gerada (só enquanto PENDING) */
  pixCharge: { payload: string; qrImage: string } | null;
}

/** CPF (11) ou CNPJ (14), só dígitos — o Asaas exige um dos dois para gerar a cobrança. */
export const isCpfCnpjLength = (v: string) => [11, 14].includes(v.replace(/\D/g, '').length);
