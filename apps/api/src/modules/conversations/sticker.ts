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

/** Linha de figurinha guardada (mensagem `sticker` com mídia no nosso storage). */
export interface StickerRow { id: string; mediaUrl: string; raw: unknown }

/**
 * Figurinhas recentes da empresa, sem repetir: a mesma figurinha recebida várias vezes vira
 * arquivos diferentes no storage, mas o WhatsApp manda o mesmo `fileSha256`. Sem ele (enviada
 * pelo painel), a chave do arquivo — reenviar pelo seletor reaproveita a mesma chave.
 */
export function dedupeStickers<T extends StickerRow>(rows: T[], limit: number): T[] {
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const sha = (r.raw as { message?: { stickerMessage?: { fileSha256?: unknown } } } | null)?.message?.stickerMessage?.fileSha256;
    const chave = sha ? `sha:${typeof sha === 'string' ? sha : JSON.stringify(sha)}` : `key:${r.mediaUrl}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
