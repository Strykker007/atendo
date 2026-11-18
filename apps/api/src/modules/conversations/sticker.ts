import { MessageType } from '@atendo/shared';

/**
 * Tipo com que uma mídia do atendente sai. `.webp` é o formato da figurinha do WhatsApp: o painel
 * anexa como imagem, mas enviada como foto ela chega como foto (e parte nem chega — a Cloud API
 * não aceita webp como imagem e a Evolution deixava várias em "enviado"). Sem legenda vira
 * figurinha; com legenda continua imagem, porque figurinha não tem texto e o texto não pode sumir.
 */
export function outboundMediaType<T extends string>(type: T, mimeType?: string | null, text?: string | null): T | typeof MessageType.STICKER {
  if (type !== MessageType.IMAGE) return type;
  if ((mimeType ?? '').toLowerCase() !== 'image/webp') return type;
  return text?.trim() ? type : MessageType.STICKER;
}
