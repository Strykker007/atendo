import { createDecipheriv, hkdfSync } from 'node:crypto';
import { desembrulhar } from './evolution-content';

/**
 * Edição no formato novo do WhatsApp: em vez do `protocolMessage` aberto, o celular manda um
 * `secretEncryptedMessage` (secretEncType 2 = MESSAGE_EDIT) cifrado com o `messageSecret` da
 * mensagem ORIGINAL. A Evolution não decifra; nós deciframos porque o `raw` da original (com o
 * segredo) está no nosso banco. Sem isso a edição do contato nunca aparecia (docs/editar-mensagens.md).
 *
 * Esquema (o mesmo do whatsmeow/Baileys para voto de enquete, só muda o rótulo):
 *   chave = HKDF-SHA256(messageSecret, salt vazio, info = idOriginal + autorOriginal + quemEditou + "Message Edit", 32)
 *   AES-256-GCM(encIv), tag nos últimos 16 bytes do encPayload, sem AAD.
 * O resultado é um `Message` protobuf: protocolMessage(12){ key(1), editedMessage(14){ texto } }.
 */

/** O que o provider tira do webhook; a decifragem acontece no InboundService, que tem a original. */
export interface EncryptedEdit {
  payload: string;
  iv: string;
  /** JIDs envolvidos (lid e telefone): o autor certo é descoberto pela tag do GCM */
  jids: string[];
  /** id do próprio evento de edição: com ele se busca na Evolution o `@lid` que o webhook perdeu */
  eventId?: string;
}

const MESSAGE_EDIT = 2;

/**
 * O WhatsApp cifra com o `@lid` do contato, mas a Evolution troca `remoteJid` @lid pelo telefone
 * antes de mandar o webhook (`remoteJid = remoteJidAlt`), e a original fica gravada do mesmo jeito.
 * Sem nenhum @lid nos JIDs, quem aplica precisa buscar a chave guardada no banco da Evolution.
 */
export const precisaDoLid = (enc: EncryptedEdit) => !enc.jids.some((j) => j.endsWith('@lid'));

/** Bytes vindos do webhook/banco: base64, `{ "0": 12, "1": 34 }` (Uint8Array serializado) ou Buffer em JSON. */
export function bytesDe(v: unknown): Buffer | null {
  if (!v) return null;
  if (typeof v === 'string') return v ? Buffer.from(v, 'base64') : null;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.type === 'Buffer' && Array.isArray(o.data)) return Buffer.from(o.data as number[]);
    const chaves = Object.keys(o).filter((k) => /^\d+$/.test(k));
    if (!chaves.length) return null;
    return Buffer.from(chaves.sort((a, b) => Number(a) - Number(b)).map((k) => Number(o[k])));
  }
  return null;
}

/** Sem o `:device` (`5511...:12@s.whatsapp.net` → `5511...@s.whatsapp.net`). */
function normJid(j: unknown): string | null {
  const s = typeof j === 'string' ? j.trim() : '';
  return s.includes('@') ? s.replace(/:\d+@/, '@') : null;
}

export function jidsDaChave(key: any): string[] {
  if (!key) return [];
  return [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt, key.senderPn, key.senderLid].map(normJid).filter((j): j is string => !!j);
}

/**
 * Edição cifrada no `messages.upsert`. `null` para outros eventos cifrados (edição de evento,
 * voto…) ou payload vazio — esses continuam descartados.
 */
export function lerEdicaoCifrada(msg: any, key: any): { targetExternalId: string; encrypted: EncryptedEdit } | null {
  const s = desembrulhar(msg)?.secretEncryptedMessage;
  if (!s || (Number(s.secretEncType) !== MESSAGE_EDIT && s.secretEncType !== 'MESSAGE_EDIT')) return null;
  const targetExternalId = s.targetMessageKey?.id;
  const payload = bytesDe(s.encPayload);
  const iv = bytesDe(s.encIv);
  if (typeof targetExternalId !== 'string' || !payload || payload.length <= 16 || !iv?.length) return null;
  return { targetExternalId, encrypted: { payload: payload.toString('base64'), iv: iv.toString('base64'), jids: [...new Set(jidsDaChave(key))], ...(typeof key?.id === 'string' && { eventId: key.id }) } };
}

/** `messageSecret` guardado no `raw` da original (webhook ou histórico). */
export function segredoDaOriginal(raw: any): Buffer | null {
  const s = raw?.message?.messageContextInfo?.messageSecret ?? raw?.messageContextInfo?.messageSecret;
  const b = bytesDe(s);
  return b && b.length === 32 ? b : null;
}

/** JIDs da original (autor dela), para combinar com os da edição. */
export function jidsDaOriginal(raw: any): string[] {
  return jidsDaChave(raw?.key);
}

/**
 * Decifra e devolve o texto novo. Tenta as combinações de autor/editor entre os JIDs conhecidos
 * (lid × telefone): a tag do GCM só fecha com a certa, então errar não produz lixo.
 */
export function decifrarEdicao(secret: Buffer, targetExternalId: string, enc: EncryptedEdit, outrosJids: string[] = []): string | null {
  const payload = Buffer.from(enc.payload, 'base64');
  const iv = Buffer.from(enc.iv, 'base64');
  if (payload.length <= 16 || !iv.length) return null;
  const jids = [...new Set([...enc.jids, ...outrosJids].map(normJid).filter((j): j is string => !!j))];
  for (const autor of jids) {
    for (const editor of jids) {
      const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), Buffer.from(targetExternalId + autor + editor + 'Message Edit'), 32));
      let claro: Buffer;
      try {
        const d = createDecipheriv('aes-256-gcm', key, iv);
        d.setAuthTag(payload.subarray(-16));
        claro = Buffer.concat([d.update(payload.subarray(0, -16)), d.final()]);
      } catch {
        continue;
      }
      return textoDaEdicao(claro, targetExternalId);
    }
  }
  return null;
}

// ---- protobuf mínimo: só os campos de que precisamos -------------------------------------

/** Campos length-delimited de uma mensagem protobuf (número → conteúdos). `null` se malformada. */
function campos(b: Buffer): Map<number, Buffer[]> | null {
  const out = new Map<number, Buffer[]>();
  let i = 0;
  const varint = () => {
    let r = 0;
    let mult = 1;
    for (let n = 0; n < 10; n++) {
      if (i >= b.length) throw new Error('fim');
      const x = b[i++];
      r += (x & 0x7f) * mult;
      if (!(x & 0x80)) return r;
      mult *= 128;
    }
    throw new Error('varint');
  };
  try {
    while (i < b.length) {
      const tag = varint();
      const field = Math.floor(tag / 8);
      const wire = tag % 8;
      if (wire === 0) varint();
      else if (wire === 1) i += 8;
      else if (wire === 5) i += 4;
      else if (wire === 2) {
        const len = varint();
        if (i + len > b.length) return null;
        out.set(field, [...(out.get(field) ?? []), b.subarray(i, i + len)]);
        i += len;
      } else return null;
      if (i > b.length) return null;
    }
  } catch {
    return null;
  }
  return out;
}

const primeiro = (m: Map<number, Buffer[]> | null, f: number) => m?.get(f)?.[0];

/** Texto de um `Message`: conversation(1), extendedTextMessage(6).text(1), legenda de foto(3.3)/vídeo(9.7). */
function textoDoMessage(b: Buffer): string | null {
  const m = campos(b);
  if (!m) return null;
  const conv = primeiro(m, 1);
  if (conv) return conv.toString('utf8');
  for (const [f, sub] of [[6, 1], [3, 3], [9, 7]] as const) {
    const no = primeiro(m, f);
    const t = no && primeiro(campos(no), sub);
    if (t) return t.toString('utf8');
  }
  return null;
}

function textoDaEdicao(claro: Buffer, targetExternalId: string): string | null {
  const pm = primeiro(campos(claro), 12);
  if (!pm) return textoDoMessage(claro);
  const p = campos(pm);
  // a chave de dentro aponta a original: se apontar outra, não aplica
  const id = primeiro(campos(primeiro(p, 1) ?? Buffer.alloc(0)), 3)?.toString('utf8');
  if (id && id !== targetExternalId) return null;
  const editada = primeiro(p, 14);
  const texto = editada ? textoDoMessage(editada) : null;
  return texto?.trim() ? texto : null;
}
