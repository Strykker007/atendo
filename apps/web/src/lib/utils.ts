import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * A API grava `[tipo]` como prévia quando a mensagem não tem texto (mídia, ou tipo que o provider
 * não reconheceu). Aqui vira rótulo em português; `[unknown]` não deve chegar cru na tela.
 */
const PREVIEW_TIPO: Record<string, string> = {
  image: '📷 Imagem', audio: '🎤 Áudio', video: '🎥 Vídeo', document: '📄 Documento', sticker: 'Figurinha',
  location: '📍 Localização', contact: '👤 Contato', template: 'Modelo', interactive: 'Mensagem interativa', text: 'Mensagem', unknown: 'Mensagem', undefined: 'Mensagem',
};
export function formatPreview(preview: string | null | undefined): string {
  const p = preview?.trim();
  if (!p) return 'Sem mensagens';
  const m = /^\[(\w+)\]$/.exec(p);
  return m ? (PREVIEW_TIPO[m[1]] ?? 'Mensagem') : p;
}

/** Baixa um JSON como arquivo (exportação de fluxos e respostas rápidas). */
export function downloadJson(data: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Nome de arquivo seguro a partir de um título. */
export const safeFileName = (name: string, fallback: string) => name.replace(/[^a-z0-9\-_ ]/gi, '').trim() || fallback;

/** Máscara de CPF (até 11 dígitos) ou CNPJ (12–14), enquanto digita. */
/** Telefone brasileiro "(11) 99999-9999" / "(11) 3333-4444". Com DDI 55 na frente, tira (a API põe de volta). */
export function formatPhoneBR(v: string) {
  let d = v.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const n = d.slice(2);
  return n.length <= 4 ? `(${d.slice(0, 2)}) ${n}` : `(${d.slice(0, 2)}) ${n.slice(0, -4)}-${n.slice(-4)}`;
}

/** CEP "00000-000". */
export function formatCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Número do cartão em blocos de 4. */
export const formatCardNumber = (v: string) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');

/** Validade do cartão "MM/AAAA" (aceita digitar "1228" → "12/28"). */
export function formatCardExpiry(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 6);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function formatDoc(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/, (_, a, b, c, e, f) => `${a}.${b}.${c}/${e}${f ? `-${f}` : ''}`);
}
