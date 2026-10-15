/**
 * Foto protegida (docs/foto-protegida.md): a imagem não vai pelo WhatsApp. No chat vai só um
 * texto genérico com o link; a foto (e a legenda) ficam numa página que expira.
 */
/** Validades oferecidas ao atendente, em horas. A primeira é o padrão (1 dia). */
export const SECURE_MEDIA_VALIDITY_HOURS = [24, 1, 4, 12, 72, 168] as const;
export const SECURE_MEDIA_DEFAULT_HOURS = 24;
export const SECURE_MEDIA_MAX_HOURS = 168;
export const SECURE_MEDIA_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'video/mp4', 'application/pdf'] as const;

export const secureMediaValidityLabel = (h: number) => (h < 24 ? `${h} ${h === 1 ? 'hora' : 'horas'}` : `${h / 24} ${h === 24 ? 'dia' : 'dias'}`);

export type SecureMediaStatus = 'active' | 'expired' | 'revoked';

/** O que a página pública `/f/:hash` recebe. Expirado/revogado não traz a mídia. */
export interface PublicSecureMedia {
  tenantName: string;
  /** logo da empresa (Configurações → Páginas públicas), URL assinada curta; null = a marca do painel */
  logoUrl: string | null;
  contactFirstName: string | null;
  agentName: string;
  status: SecureMediaStatus;
  expiresAt: string;
  caption: string | null;
  /** URL assinada de vida curta; null quando não está mais ativa */
  media: { url: string; mimeType: string; fileName: string | null } | null;
}

/**
 * Frase padrão que vai pelo WhatsApp: genérica de propósito — nada do conteúdo da foto. A empresa
 * troca em Configurações (`tenant_settings.secureMediaText`), com as mesmas variáveis.
 */
export const SECURE_MEDIA_TEXT_DEFAULT = 'Olá {{primeiro_nome}}, a imagem está disponível neste link (válido por {{validade}}): {{link}}';
export const SECURE_MEDIA_TEXT_VARS = ['link', 'validade', 'primeiro_nome'] as const;

/**
 * Monta a frase. `{{link}}` é obrigatório na frase da empresa (a API recusa sem ele); se mesmo
 * assim faltar, o link vai no fim — mandar a mensagem sem o link seria pior. Sem nome do contato,
 * "Olá {{primeiro_nome}}," vira "Olá,".
 */
export function secureMediaMessage(link: string, hours: number, contactFirstName?: string | null, template?: string | null) {
  const base = template?.trim() || SECURE_MEDIA_TEXT_DEFAULT;
  const nome = contactFirstName?.trim() || '';
  let texto = base
    .replace(/\{\{\s*validade\s*\}\}/g, secureMediaValidityLabel(hours))
    .replace(/\s*\{\{\s*primeiro_nome\s*\}\}/g, nome ? ` ${nome}` : '')
    .replace(/^\s+/, '');
  texto = /\{\{\s*link\s*\}\}/.test(texto) ? texto.replace(/\{\{\s*link\s*\}\}/g, link) : `${texto} ${link}`;
  return texto;
}
