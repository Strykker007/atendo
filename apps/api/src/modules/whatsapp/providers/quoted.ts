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
 * Lê o `contextInfo` do Baileys/Evolution. Ele aparece pendurado em qualquer tipo de
 * mensagem, por isso a varredura: responder com foto põe o contexto em `imageMessage`.
 */
export function lerCitacao(msg: any): Citacao | undefined {
  const ctx = contextInfoDe(desembrulhar(msg));
  if (!ctx) return undefined;

  // `status@broadcast` é o endereço dos status: é assim que se sabe que a pessoa respondeu
  // um story, e não uma mensagem da conversa
  const fromStatus = ctx.remoteJid === 'status@broadcast' || ctx.participant === 'status@broadcast';
  const externalId = typeof ctx.stanzaId === 'string' ? ctx.stanzaId : undefined;
  const preview = textoDe(ctx.quotedMessage);
  if (!externalId && !preview && !fromStatus) return undefined;
  return { externalId, preview, fromStatus };
}
