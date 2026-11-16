import { createHmac, timingSafeEqual } from 'node:crypto';
import { isValidCpfCnpj } from '@atendo/shared';

/**
 * Mensalidade por Pix no Asaas (docs/05-planos-e-cobranca.md#migração-para-o-asaas): regras puras
 * de quem migra, de qual lembrete sai em cada dia e do e-mail. O serviço só busca e grava.
 */

/** Dia de hoje (ou de `d`) em São Paulo, "AAAA-MM-DD" — o vencimento do Asaas é uma data local. */
export const diaSP = (d = new Date()) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
/** Dias corridos de `de` até `ate` ("AAAA-MM-DD"); negativo = já passou. */
export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

/** Antecedência do lembrete "vence em breve" (e do aviso no painel). */
export const REMINDER_DAYS = 5;

export type EnrollSkip = 'already' | 'free' | 'no_price' | 'not_live' | 'no_document';

/**
 * Pode ir para a cobrança automática? Quem paga hoje sem gateway (cobrança manual), em plano pago
 * mensal/anual, com assinatura viva e CPF/CNPJ válido. `no_document` é o único motivo que o
 * próprio cliente resolve (aviso no painel).
 */
export function enrollSkip(s: { gateway: string | null; status: string; billingCycle: string; isFree: boolean; value: number; document: string | null }): EnrollSkip | null {
  if (s.gateway) return 'already';
  if (s.isFree || (s.billingCycle !== 'monthly' && s.billingCycle !== 'yearly')) return 'free';
  if (!(s.value > 0)) return 'no_price';
  if (!['active', 'trialing', 'past_due'].includes(s.status)) return 'not_live';
  if (!isValidCpfCnpj(s.document)) return 'no_document';
  return null;
}

/**
 * Primeiro vencimento no Asaas: o que o cliente já tinha (a data não muda com a migração). Data
 * que já passou (pagamento manual atrasado) vira hoje — o Asaas não cria cobrança no passado.
 */
export const firstDueDate = (currentPeriodEnd: Date, hoje = diaSP()) => {
  const d = diaSP(currentPeriodEnd);
  return d < hoje ? hoje : d;
};

/** Assinatura por boleto vence em pelo menos 3 dias: boleto pago hoje só compensa em 1–3 dias úteis. */
export const BOLETO_MIN_DAYS = 3;

/**
 * 1º vencimento da assinatura por boleto: o do cliente, mas nunca antes de hoje + 3 dias (boleto
 * vencido no dia em que nasce não dá tempo de pagar — e o Asaas não cria cobrança no passado).
 */
export const boletoFirstDueDate = (currentPeriodEnd: Date, hoje = diaSP()) => {
  const minimo = diaSP(new Date(Date.parse(`${hoje}T12:00:00Z`) + BOLETO_MIN_DAYS * 86_400_000));
  const d = diaSP(currentPeriodEnd);
  return d < minimo ? minimo : d;
};

const addMonths = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
  // dia 31 em mês de 30 vira o último dia do mês (mesma regra do Asaas)
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
};
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Data limite para cancelar (docs/05-planos-e-cobranca.md#data-limite-para-cancelar). O Asaas gera
 * cada parcela `leadDays` dias antes do vencimento; cancelada a assinatura antes disso, a parcela
 * não nasce. `nextCharge`: a próxima parcela que AINDA NÃO foi gerada (vencimentos andam um ciclo
 * a partir de `anchorDue`); `cancelBy`: último dia para cancelar sem que ela seja gerada.
 */
export function cancelDeadline(anchorDue: string, cycle: 'monthly' | 'yearly', leadDays: number, hoje = diaSP()) {
  const passo = cycle === 'yearly' ? 12 : 1;
  let k = 0;
  let due = anchorDue;
  // a primeira parcela cuja geração (vencimento − leadDays) ainda está no futuro
  while (addDays(due, -leadDays) <= hoje) due = addMonths(anchorDue, (k += passo));
  return { nextCharge: due, cancelBy: addDays(due, -leadDays - 1) };
}

export type ReminderKind = 'soon' | 'due';

/**
 * Qual lembrete sai hoje para uma cobrança em aberto. "Em breve" a partir de `REMINDER_DAYS` dias
 * antes (uma vez — quem migrou com o vencimento a 3 dias recebe já); "hoje" no dia do vencimento.
 * Vencida fica com o aviso de atraso, que já existe (`onOverdue`).
 */
export function reminderKind(hoje: string, dueDate: string, sent: { soon: boolean; due: boolean }): ReminderKind | null {
  const dias = diasEntre(hoje, dueDate);
  if (dias === 0) return sent.due ? null : 'due';
  if (dias > 0 && dias <= REMINDER_DAYS) return sent.soon ? null : 'soon';
  return null;
}

/** Assinatura da URL pública do QR (o e-mail não pode carregar imagem em base64: o Gmail bloqueia). */
export const qrSignature = (secret: string, paymentId: string) => createHmac('sha256', secret).update(`pix-qr:${paymentId}`).digest('hex').slice(0, 32);
export function qrSignatureOk(secret: string, paymentId: string, sig: string | undefined) {
  if (!sig) return false;
  const a = Buffer.from(qrSignature(secret, paymentId));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface ReminderMail {
  brand: string;
  /** `overdue`: só sem gateway e sem cobrança (com cobrança, o aviso de atraso é o do `onOverdue`/`markOverdueDues`) */
  kind: ReminderKind | 'overdue';
  value: number;
  dueDate: string;
  /** Pix copia e cola */
  pixPayload: string | null;
  /** imagem do QR (URL assinada da API) */
  qrUrl: string | null;
  /** tela do painel que abre o pagamento */
  payUrl: string;
  /** página da cobrança no Asaas (QR, boleto/cartão) */
  invoiceUrl: string | null;
  /** assinatura por boleto: linha digitável e PDF */
  boletoLine?: string | null;
  boletoUrl?: string | null;
}

/** Assunto, texto e HTML do lembrete: valor, vencimento, QR e o código para copiar. */
export function reminderMail(m: ReminderMail) {
  const quando = m.kind === 'due' ? 'vence hoje' : m.kind === 'overdue' ? `venceu em ${dataBR(m.dueDate)}` : `vence em ${dataBR(m.dueDate)}`;
  const subject = `Sua mensalidade ${m.brand} de ${brl(m.value)} ${quando}`;
  const text = [
    `Sua mensalidade ${m.brand} ${quando}.`,
    '',
    `Valor: ${brl(m.value)}`,
    `Vencimento: ${dataBR(m.dueDate)}`,
    '',
    ...(m.boletoLine ? ['Linha digitável do boleto:', m.boletoLine, ''] : []),
    ...(m.boletoUrl ? ['Boleto (PDF):', m.boletoUrl, ''] : []),
    ...(m.pixPayload ? [m.boletoLine || m.boletoUrl ? 'Ou pague por Pix (copia e cola):' : 'Pix copia e cola:', m.pixPayload, ''] : []),
    'Pagar pelo painel:',
    m.payUrl,
    ...(m.invoiceUrl ? ['', 'Ou pela página da cobrança:', m.invoiceUrl] : []),
    '',
    'Se já pagou, desconsidere este e-mail — a baixa é automática.',
  ].join('\n');
  const botao = (href: string, rotulo: string) => `<a href="${esc(href)}" style="background:#2f5bea;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">${esc(rotulo)}</a>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1e2433;max-width:560px;margin:0 auto;padding:24px">
<h2 style="font-size:19px;margin:0 0 6px">Sua mensalidade ${esc(quando)}</h2>
<p style="margin:0 0 18px;color:#4b5563">${esc(m.brand)} · pagamento por ${m.boletoLine || m.boletoUrl ? 'boleto ou Pix' : 'Pix'}</p>
<table style="border-collapse:collapse;margin:0 0 18px;font-size:15px"><tr><td style="padding:4px 16px 4px 0;color:#6b7280">Valor</td><td style="padding:4px 0;font-weight:700;font-size:18px">${esc(brl(m.value))}</td></tr><tr><td style="padding:4px 16px 4px 0;color:#6b7280">Vencimento</td><td style="padding:4px 0;font-weight:600">${esc(dataBR(m.dueDate))}</td></tr></table>
${m.boletoLine ? `<p style="margin:0 0 6px;color:#4b5563">Linha digitável do boleto:</p><div style="font-family:Menlo,Consolas,monospace;font-size:13px;word-break:break-all;background:#f3f4f6;border-radius:8px;padding:12px;margin:0 0 10px">${esc(m.boletoLine)}</div>` : ''}
${m.boletoUrl ? `<p style="margin:0 0 18px">${botao(m.boletoUrl, 'Baixar boleto (PDF)')}</p>` : ''}
${m.qrUrl && (m.boletoLine || m.boletoUrl) ? `<p style="margin:0 0 6px;color:#4b5563;font-weight:600">Prefere Pix? Cai na hora:</p>` : ''}
${m.qrUrl ? `<p style="margin:0 0 6px;color:#4b5563">Aponte a câmera do app do banco:</p><img src="${esc(m.qrUrl)}" width="220" height="220" alt="QR Code Pix" style="display:block;border:1px solid #e5e7eb;border-radius:12px;margin:0 0 18px">` : ''}
${m.pixPayload ? `<p style="margin:0 0 6px;color:#4b5563">Ou copie o código Pix (copia e cola):</p><div style="font-family:Menlo,Consolas,monospace;font-size:12px;word-break:break-all;background:#f3f4f6;border-radius:8px;padding:12px;margin:0 0 18px">${esc(m.pixPayload)}</div>` : ''}
<p style="margin:0 0 10px">${botao(m.payUrl, 'Pagar pelo painel')}</p>
${m.invoiceUrl ? `<p style="margin:0 0 18px;font-size:13px"><a href="${esc(m.invoiceUrl)}" style="color:#2f5bea">Abrir a página da cobrança</a></p>` : ''}
<p style="margin:0;font-size:13px;color:#6b7280">Se já pagou, desconsidere este e-mail — a baixa é automática.</p>
<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:12px;color:#6b7280">${esc(m.brand)}</p></div>`;
  return { subject, text, html };
}
