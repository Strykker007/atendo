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
  contactFirstName: string | null;
  agentName: string;
  status: SecureMediaStatus;
  expiresAt: string;
  caption: string | null;
  /** URL assinada de vida curta; null quando não está mais ativa */
  media: { url: string; mimeType: string; fileName: string | null } | null;
}

/** Texto que vai pelo WhatsApp: genérico de propósito — nada do conteúdo da foto. */
export function secureMediaMessage(link: string, hours: number, contactFirstName?: string | null) {
  return `${contactFirstName ? `Olá ${contactFirstName}, ` : 'Olá, '}a imagem está disponível neste link (válido por ${secureMediaValidityLabel(hours)}): ${link}`;
}
