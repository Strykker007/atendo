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
export function formatDoc(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/, (_, a, b, c, e, f) => `${a}.${b}.${c}/${e}${f ? `-${f}` : ''}`);
}
