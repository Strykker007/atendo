import { MessageType } from '@atendo/shared';
import type { ContentButton, InboundMessage, MessageContent } from '@atendo/shared';
import { jsonSeguro, lerVcard, textoQualquer } from './payload-text';

/**
 * Corpo de uma mensagem Baileys/Evolution (`data.message`) → formato canônico.
 *
 * Isolado do provider pelo mesmo motivo de `quoted.ts`: é leitura de payload bruto, o lugar
 * onde um campo renomeado vira bolha vazia sem ninguém perceber — e aqui dá para testar cada
 * tipo sem subir a Evolution.
 */

export interface ConteudoLido {
  type: MessageType;
  text?: string;
  media?: InboundMessage['media'];
  content?: MessageContent;
  interactiveReplyId?: string;
  forwarded?: boolean;
  forwardingScore?: number;
}

/** Envelopes que só embrulham a mensagem de verdade (temporária, visualização única, etc.). */
const ENVELOPES = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage'];

export function desembrulhar(msg: any): any {
  let atual = msg ?? {};
  for (let i = 0; i < 5; i++) {
    const env = ENVELOPES.find((k) => atual?.[k]?.message);
    if (!env) break;
    atual = atual[env].message;
  }
  return atual;
}

/**
 * `contextInfo` pendurado em qualquer nó da mensagem (texto, foto, botões…). É dele que saem a
 * citação e a marca de encaminhada.
 */
export function contextInfoDe(msg: any): any {
  if (!msg || typeof msg !== 'object') return undefined;
  for (const [chave, no] of Object.entries<any>(msg)) {
    if (chave === 'messageContextInfo') continue;
    if (no && typeof no === 'object' && no.contextInfo) return no.contextInfo;
  }
  return undefined;
}

/**
 * Edição: chega como `protocolMessage` (tipo 14 / MESSAGE_EDIT) apontando a original. Devolve
 * o id da editada e o texto novo; `null` para os outros protocolMessage (apagar, configurar
 * mensagens temporárias…), que não são mensagem e não podem virar bolha.
 */
export function lerEdicao(msg: any): { targetExternalId: string; text: string } | null {
  const p = desembrulhar(msg)?.protocolMessage;
  if (!p?.key?.id || !p.editedMessage) return null;
  const novo = desembrulhar(p.editedMessage);
  const text = novo.conversation ?? novo.extendedTextMessage?.text ?? novo.imageMessage?.caption ?? novo.videoMessage?.caption ?? textoQualquer(novo);
  return typeof text === 'string' && text.trim() ? { targetExternalId: p.key.id, text } : null;
}

/**
 * Evento criptografado de outra mensagem (`secretEncryptedMessage`): edição no formato novo
 * do WhatsApp (tipo 2 = MESSAGE_EDIT), edição de evento etc. A Evolution não decifra — só o
 * dono da `messageSecret` da original consegue — e muitas vezes a original nem está conosco.
 * Não é mensagem: virava bolha "conteúdo não suportado" no meio da conversa.
 */
export function eventoCifrado(msg: any): boolean {
  return !!desembrulhar(msg)?.secretEncryptedMessage;
}

export function lerConteudo(raw: any): ConteudoLido {
  const msg = desembrulhar(raw);
  const ctx = contextInfoDe(msg);
  const encaminhada = ctx?.isForwarded ? { forwarded: true, forwardingScore: typeof ctx.forwardingScore === 'number' ? ctx.forwardingScore : undefined } : {};
  return { ...lerTipo(msg), ...encaminhada };
}

function lerTipo(msg: any): ConteudoLido {
  if (msg.conversation || msg.extendedTextMessage) {
    return { type: MessageType.TEXT, text: msg.conversation ?? msg.extendedTextMessage?.text };
  }

  // ---- mídia ----
  if (msg.imageMessage) return midia(MessageType.IMAGE, msg.imageMessage);
  if (msg.videoMessage) return midia(MessageType.VIDEO, msg.videoMessage);
  // vídeo redondo (gravado na hora): para o painel é vídeo
  if (msg.ptvMessage) return midia(MessageType.VIDEO, msg.ptvMessage);
  if (msg.audioMessage) return midia(MessageType.AUDIO, { ...msg.audioMessage, caption: undefined });
  if (msg.documentMessage) return midia(MessageType.DOCUMENT, msg.documentMessage);
  // figurinha também tem arquivo para baixar; sem `media` ficava eternamente "carregando…"
  if (msg.stickerMessage) return midia(MessageType.STICKER, { ...msg.stickerMessage, caption: undefined });

  // ---- localização / contato ----
  if (msg.locationMessage || msg.liveLocationMessage) {
    const l = msg.locationMessage ?? msg.liveLocationMessage;
    return {
      type: MessageType.LOCATION,
      text: msg.liveLocationMessage?.caption || undefined,
      content: { kind: 'location', lat: Number(l.degreesLatitude), lng: Number(l.degreesLongitude), name: l.name || undefined, address: l.address || undefined, live: !!msg.liveLocationMessage || undefined },
    };
  }
  if (msg.contactMessage) {
    return { type: MessageType.CONTACT, content: { kind: 'contacts', contacts: [lerVcard(msg.contactMessage.vcard, msg.contactMessage.displayName)] } };
  }
  if (msg.contactsArrayMessage) {
    const lista = (msg.contactsArrayMessage.contacts ?? []).map((c: any) => lerVcard(c?.vcard, c?.displayName));
    return { type: MessageType.CONTACT, content: { kind: 'contacts', contacts: lista } };
  }

  // ---- interativas que CHEGAM (empresa → contato, ex.: código de verificação do banco) ----
  if (msg.buttonsMessage) {
    const b = msg.buttonsMessage;
    const buttons: ContentButton[] = (b.buttons ?? []).map((x: any) => ({ id: x.buttonId, title: x.buttonText?.displayText ?? '', kind: 'reply' as const })).filter((x: ContentButton) => x.title);
    return { type: MessageType.INTERACTIVE, text: b.contentText ?? b.text, content: { kind: 'buttons', header: b.contentText ? b.text || undefined : undefined, footer: b.footerText, buttons } };
  }
  if (msg.templateMessage) {
    const t = msg.templateMessage.hydratedTemplate ?? msg.templateMessage.hydratedFourRowTemplate ?? msg.templateMessage.fourRowTemplate ?? {};
    const buttons = (t.hydratedButtons ?? t.buttons ?? []).map(botaoDeTemplate).filter(Boolean) as ContentButton[];
    return {
      type: MessageType.INTERACTIVE,
      text: t.hydratedContentText ?? textoQualquer(t),
      content: { kind: 'buttons', header: t.hydratedTitleText, footer: t.hydratedFooterText, buttons },
    };
  }
  if (msg.interactiveMessage) return lerInterativa(msg.interactiveMessage);
  if (msg.listMessage) {
    const l = msg.listMessage;
    return {
      type: MessageType.INTERACTIVE,
      text: l.description || l.title,
      content: {
        kind: 'list',
        header: l.description ? l.title : undefined,
        footer: l.footerText,
        buttonText: l.buttonText,
        sections: (l.sections ?? []).map((s: any) => ({ title: s.title, rows: (s.rows ?? []).map((r: any) => ({ id: r.rowId, title: r.title ?? '', description: r.description || undefined })) })),
      },
    };
  }

  // ---- respostas do contato a botão/lista: viram texto + id da opção (fluxos/lembretes) ----
  if (msg.buttonsResponseMessage) {
    const r = msg.buttonsResponseMessage;
    return { type: MessageType.TEXT, text: r.selectedDisplayText ?? r.response?.selectedDisplayText, interactiveReplyId: r.selectedButtonId };
  }
  if (msg.listResponseMessage) {
    const r = msg.listResponseMessage;
    return { type: MessageType.TEXT, text: r.title ?? r.description, interactiveReplyId: r.singleSelectReply?.selectedRowId };
  }
  if (msg.templateButtonReplyMessage) {
    const r = msg.templateButtonReplyMessage;
    return { type: MessageType.TEXT, text: r.selectedDisplayText, interactiveReplyId: r.selectedId };
  }
  if (msg.interactiveResponseMessage) {
    const r = msg.interactiveResponseMessage;
    const params = jsonSeguro(r.nativeFlowResponseMessage?.paramsJson);
    return { type: MessageType.TEXT, text: r.body?.text ?? params.display_text ?? params.title, interactiveReplyId: params.id };
  }

  // enquete: sem renderizador próprio, mas legível
  const enquete = msg.pollCreationMessage ?? msg.pollCreationMessageV2 ?? msg.pollCreationMessageV3;
  if (enquete) {
    const opcoes = (enquete.options ?? []).map((o: any) => `• ${o.optionName}`).join('\n');
    return { type: MessageType.TEXT, text: `📊 ${enquete.name ?? 'Enquete'}${opcoes ? `\n${opcoes}` : ''}` };
  }

  // fallback: qualquer texto que houver, em vez de "unknown"
  const text = textoQualquer(msg);
  return text ? { type: MessageType.TEXT, text } : { type: MessageType.UNKNOWN };
}

function midia(type: MessageType, no: any): ConteudoLido {
  return { type, text: no.caption || undefined, media: { mimeType: no.mimetype, fileName: no.fileName, caption: no.caption || undefined } };
}

function botaoDeTemplate(b: any): ContentButton | null {
  if (b?.quickReplyButton) return { id: b.quickReplyButton.id, title: b.quickReplyButton.displayText ?? '', kind: 'reply' };
  if (b?.urlButton) return { title: b.urlButton.displayText ?? '', kind: 'url', value: b.urlButton.url };
  if (b?.callButton) return { title: b.callButton.displayText ?? '', kind: 'call', value: b.callButton.phoneNumber };
  return null;
}

/**
 * `interactiveMessage` (nativeFlow): é o formato dos códigos de verificação ("Copiar código")
 * e de quase todo bot comercial hoje. Cada botão traz os parâmetros num JSON em string.
 */
function lerInterativa(im: any): ConteudoLido {
  const text = im.body?.text ?? textoQualquer(im.header) ?? '';
  const header = im.header?.title || undefined;
  const footer = im.footer?.text || undefined;
  const brutos: any[] = im.nativeFlowMessage?.buttons ?? [];

  // `single_select` é uma lista disfarçada de botão
  const lista = brutos.find((b) => b?.name === 'single_select');
  if (lista) {
    const p = jsonSeguro(lista.buttonParamsJson);
    return {
      type: MessageType.INTERACTIVE,
      text,
      content: {
        kind: 'list',
        header,
        footer,
        buttonText: p.title,
        sections: (p.sections ?? []).map((s: any) => ({ title: s.title, rows: (s.rows ?? []).map((r: any) => ({ id: r.id, title: r.title ?? '', description: r.description || undefined })) })),
      },
    };
  }

  const buttons: ContentButton[] = brutos
    .map((b): ContentButton | null => {
      const p = jsonSeguro(b?.buttonParamsJson);
      const title = p.display_text ?? p.title ?? '';
      if (!title) return null;
      if (b.name === 'cta_copy') return { id: p.id, title, kind: 'copy', value: p.copy_code };
      if (b.name === 'cta_url') return { id: p.id, title, kind: 'url', value: p.url ?? p.merchant_url };
      if (b.name === 'cta_call') return { id: p.id, title, kind: 'call', value: p.phone_number };
      return { id: p.id, title, kind: 'reply' };
    })
    .filter((b): b is ContentButton => !!b);
  // botões antigos (`buttons` fora do nativeFlow), se vierem
  for (const b of im.buttons ?? []) if (b?.buttonText?.displayText) buttons.push({ id: b.buttonId, title: b.buttonText.displayText, kind: 'reply' });

  return { type: MessageType.INTERACTIVE, text, content: { kind: 'buttons', header, footer, buttons } };
}
