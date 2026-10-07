/**
 * O que a pessoa estava respondendo.
 *
 * Duas situações em que guardar só o id da mensagem citada não basta:
 *
 *  - **resposta a status (os "stories")**: o status não é uma mensagem da conversa e some
 *    em 24 horas. Sem guardar o conteúdo citado aqui, daqui a um dia a conversa mostraria
 *    "ok, quero esse" sem ninguém no mundo saber o que era "esse";
 *  - **resposta a mensagem antiga**: a citada pode ser anterior ao que temos no banco (número
 *    recém-conectado, histórico que não veio).
 *
 * Isolado do provider porque é leitura de payload bruto — o lugar onde um campo que mudou de
 * nome vira texto vazio sem ninguém perceber.
 */
import { contextInfoDe, desembrulhar } from './evolution-content';
import { textoQualquer } from './payload-text';

export interface Citacao {
  /** id da mensagem citada no provider, quando existe */
  externalId?: string;
  /** texto (ou rótulo) do que foi citado, para quando a mensagem citada não está no banco */
  preview?: string;
  /** a citação é um status/story, não uma mensagem da conversa */
  fromStatus: boolean;
  /** foto/vídeo do status citado (só em status: mensagem da conversa já tem a mídia no banco) */
  media?: { kind: 'image' | 'video'; mimeType?: string; thumbnail?: string };
}

/** Rótulo de mídia sem legenda: melhor "📷 Foto" do que uma citação vazia. */
const ROTULO: Record<string, string> = {
  imageMessage: '📷 Foto',
  videoMessage: '🎥 Vídeo',
  audioMessage: '🎤 Áudio',
  documentMessage: '📄 Documento',
  stickerMessage: 'Figurinha',
  locationMessage: '📍 Localização',
  liveLocationMessage: '📍 Localização',
  contactMessage: '👤 Contato',
  contactsArrayMessage: '👤 Contatos',
  buttonsMessage: 'Mensagem interativa',
  templateMessage: 'Mensagem interativa',
  interactiveMessage: 'Mensagem interativa',
  listMessage: 'Lista de opções',
};

function textoDe(bruta: any): string | undefined {
  if (!bruta || typeof bruta !== 'object') return undefined;
  const citada = desembrulhar(bruta);
  const direto = citada.conversation ?? citada.extendedTextMessage?.text;
  if (typeof direto === 'string' && direto.trim()) return direto.trim();
  for (const [chave, rotulo] of Object.entries(ROTULO)) {
    const no = citada[chave];
    if (!no) continue;
    const legenda = [no.caption, no.contentText, no.hydratedTemplate?.hydratedContentText, no.body?.text, no.description, no.displayName].find((t) => typeof t === 'string' && t.trim());
    return legenda ? `${rotulo}: ${legenda.trim()}` : rotulo;
  }
  return textoQualquer(citada);
}

/**
 * Bytes do Baileys depois de virar JSON: base64 (o normal na Evolution), `{type:'Buffer',data}`
 * ou `{0: 255, 1: 216…}`, conforme a versão. Devolve base64.
 */
function base64De(v: any): string | undefined {
  if (typeof v === 'string') return v || undefined;
  if (!v || typeof v !== 'object') return undefined;
  if (v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data).toString('base64');
  const bytes = Object.values(v);
  return bytes.length && bytes.every((n) => typeof n === 'number') ? Buffer.from(bytes as number[]).toString('base64') : undefined;
}

function midiaDoStatus(bruta: any): Citacao['media'] {
  const citada = bruta && typeof bruta === 'object' ? desembrulhar(bruta) : undefined;
  const no = citada?.imageMessage ?? citada?.videoMessage;
  if (!no) return undefined;
  return {
    kind: citada.imageMessage ? 'image' : 'video',
    mimeType: typeof no.mimetype === 'string' ? no.mimetype : undefined,
    thumbnail: base64De(no.jpegThumbnail),
  };
}

/**
 * Bytes do `quotedMessage` em base64, o formato que o Baileys aceita de volta ao baixar a mídia
 * (`mediaKey` como `{0: 30, 1: 122…}` quebra a descriptografia).
 */
export function bytesEmBase64(no: any): any {
  if (!no || typeof no !== 'object' || Array.isArray(no)) return no;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(no)) {
    const b = v && typeof v === 'object' && !Array.isArray(v) ? base64De(v) : undefined;
    out[k] = b ?? bytesEmBase64(v);
  }
  return out;
}

/**
 * O `contextInfo` da mensagem. Normalmente vem pendurado no tipo da resposta (texto, foto,
 * botões…), mas quando a resposta é texto puro (`conversation`, que é só uma string) a Evolution
 * o entrega **fora** de `message`, no topo do webhook — é o caso típico da resposta a status
 * digitada no celular. `externo` é esse do topo.
 */
export function contextoDaCitacao(msg: any, externo?: any): any {
  return contextInfoDe(desembrulhar(msg)) ?? (externo && typeof externo === 'object' ? externo : undefined);
}

/**
 * Lê o `contextInfo` do Baileys/Evolution. Ele aparece pendurado em qualquer tipo de
 * mensagem, por isso a varredura: responder com foto põe o contexto em `imageMessage`.
 */
export function lerCitacao(msg: any, contextoExterno?: any): Citacao | undefined {
  const ctx = contextoDaCitacao(msg, contextoExterno);
  if (!ctx) return undefined;

  // `status@broadcast` é o endereço dos status: é assim que se sabe que a pessoa respondeu
  // um story, e não uma mensagem da conversa
  const fromStatus = ctx.remoteJid === 'status@broadcast' || ctx.participant === 'status@broadcast';
  const externalId = typeof ctx.stanzaId === 'string' ? ctx.stanzaId : undefined;
  const preview = textoDe(ctx.quotedMessage);
  if (!externalId && !preview && !fromStatus) return undefined;
  return { externalId, preview, fromStatus, media: fromStatus ? midiaDoStatus(ctx.quotedMessage) : undefined };
}
