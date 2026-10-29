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
  kind: ReminderKind;
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
}

/** Assunto, texto e HTML do lembrete: valor, vencimento, QR e o código para copiar. */
export function reminderMail(m: ReminderMail) {
  const quando = m.kind === 'due' ? 'vence hoje' : `vence em ${dataBR(m.dueDate)}`;
  const subject = `Sua mensalidade ${m.brand} de ${brl(m.value)} ${quando}`;
  const text = [
    `Sua mensalidade ${m.brand} ${quando}.`,
    '',
    `Valor: ${brl(m.value)}`,
    `Vencimento: ${dataBR(m.dueDate)}`,
    '',
    ...(m.pixPayload ? ['Pix copia e cola:', m.pixPayload, ''] : []),
    'Pagar pelo painel:',
    m.payUrl,
    ...(m.invoiceUrl ? ['', 'Ou pela página da cobrança:', m.invoiceUrl] : []),
    '',
    'Se já pagou, desconsidere este e-mail — a baixa é automática.',
  ].join('\n');
  const botao = (href: string, rotulo: string) => `<a href="${esc(href)}" style="background:#2f5bea;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">${esc(rotulo)}</a>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1e2433;max-width:560px;margin:0 auto;padding:24px">
<h2 style="font-size:19px;margin:0 0 6px">Sua mensalidade ${esc(quando)}</h2>
<p style="margin:0 0 18px;color:#4b5563">${esc(m.brand)} · pagamento por Pix</p>
<table style="border-collapse:collapse;margin:0 0 18px;font-size:15px"><tr><td style="padding:4px 16px 4px 0;color:#6b7280">Valor</td><td style="padding:4px 0;font-weight:700;font-size:18px">${esc(brl(m.value))}</td></tr><tr><td style="padding:4px 16px 4px 0;color:#6b7280">Vencimento</td><td style="padding:4px 0;font-weight:600">${esc(dataBR(m.dueDate))}</td></tr></table>
${m.qrUrl ? `<p style="margin:0 0 6px;color:#4b5563">Aponte a câmera do app do banco:</p><img src="${esc(m.qrUrl)}" width="220" height="220" alt="QR Code Pix" style="display:block;border:1px solid #e5e7eb;border-radius:12px;margin:0 0 18px">` : ''}
${m.pixPayload ? `<p style="margin:0 0 6px;color:#4b5563">Ou copie o código Pix (copia e cola):</p><div style="font-family:Menlo,Consolas,monospace;font-size:12px;word-break:break-all;background:#f3f4f6;border-radius:8px;padding:12px;margin:0 0 18px">${esc(m.pixPayload)}</div>` : ''}
<p style="margin:0 0 10px">${botao(m.payUrl, 'Pagar pelo painel')}</p>
${m.invoiceUrl ? `<p style="margin:0 0 18px;font-size:13px"><a href="${esc(m.invoiceUrl)}" style="color:#2f5bea">Abrir a página da cobrança</a></p>` : ''}
<p style="margin:0;font-size:13px;color:#6b7280">Se já pagou, desconsidere este e-mail — a baixa é automática.</p>
<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:12px;color:#6b7280">${esc(m.brand)}</p></div>`;
  return { subject, text, html };
}
