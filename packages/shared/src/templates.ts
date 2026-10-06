import type { BillingCategory } from './enums.js';

/**
 * Template (HSM) aprovado na conta WhatsApp Business — só existe na API oficial (Meta).
 * É o único jeito de falar primeiro com alguém, ou com quem está fora da janela de 24h.
 *
 * Normalizado a partir do `message_templates` da Graph API: a tela e o envio só conhecem isto.
 */
export interface MessageTemplate {
  /** id na Meta */
  id: string;
  name: string;
  /** código do idioma (pt_BR, en_US…) — nome + idioma identificam o template */
  language: string;
  category: Extract<BillingCategory, 'marketing' | 'utility' | 'authentication'>;
  /** cabeçalho de texto; cabeçalho de mídia vem em `headerFormat` */
  header?: string;
  headerFormat?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  body: string;
  footer?: string;
  /** rótulos dos botões, só para a pré-visualização */
  buttons?: string[];
  /** variáveis do cabeçalho e do corpo, na ordem em que aparecem (`1`, `2`… ou nomes) */
  headerParams: string[];
  bodyParams: string[];
  /**
   * Motivo de não dar para enviar pelo painel (cabeçalho de mídia, botão com URL dinâmica…).
   * Ausente = enviável. A tela mostra o template desabilitado com este texto.
   */
  unsupported?: string;
}

/** Valores preenchidos pelo atendente, por variável (`{ "1": "Ana" }` ou `{ "first_name": "Ana" }`). */
export type TemplateValues = Record<string, string>;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Variáveis de um texto de template, sem repetição, na ordem em que aparecem. */
export function templateParams(text: string | undefined | null): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** Texto do template com as variáveis trocadas; variável sem valor fica como está. */
export function renderTemplateText(text: string, values: TemplateValues): string {
  return text.replace(PLACEHOLDER, (raw, key: string) => (values[key]?.trim() ? values[key] : raw));
}

/** Como a mensagem aparece no histórico do painel: cabeçalho em negrito, corpo e rodapé. */
export function renderTemplatePreview(t: Pick<MessageTemplate, 'header' | 'body' | 'footer'>, header: TemplateValues, body: TemplateValues): string {
  return [t.header && `*${renderTemplateText(t.header, header)}*`, renderTemplateText(t.body, body), t.footer && `_${t.footer}_`].filter(Boolean).join('\n\n');
}
