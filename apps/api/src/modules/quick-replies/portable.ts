import { parsePortableFile, toBundle, type PortableBundle } from '@atendo/shared';

/**
 * Levar respostas rápidas de um cliente para outro. Envelope, lote e nomes vêm do módulo comum
 * (`@atendo/shared` → `portable.ts`); aqui fica só o que é próprio da resposta.
 *
 * Uma resposta viaja com o NOME da pasta (no destino a pasta é achada ou criada por nome) e
 * sem o anexo: a chave de mídia carrega o tenant de origem (`media/<tenantId>/…`), e
 * levá-la faria o destino servir arquivo de outro cliente. O anexo sai com aviso.
 */

export const PORTABLE_QR_VERSION = 1;

export interface PortableQuickReply {
  atendo: 'quick-reply';
  version: number;
  folder: string;
  title: string;
  body: string;
}

/** Lote: cada item é exatamente o arquivo individual. */
export type PortableQuickReplyBundle = PortableBundle<'quick-reply', PortableQuickReply>;

export function toPortableReply(r: { title: string; body: string; mediaKey: string | null }, folderName: string): { portable: PortableQuickReply; warnings: string[] } {
  return {
    portable: { atendo: 'quick-reply', version: PORTABLE_QR_VERSION, folder: folderName, title: r.title, body: r.body },
    warnings: r.mediaKey ? [`"${r.title}": o anexo não vai no arquivo — reenvie no destino.`] : [],
  };
}

export const toReplyBundle = (items: PortableQuickReply[]): PortableQuickReplyBundle => toBundle('quick-reply', items, PORTABLE_QR_VERSION);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Valida um item. Não confia em nada: o arquivo pode ter sido editado à mão. */
export function parsePortableReply(raw: unknown): PortableQuickReply {
  const o = raw as Partial<PortableQuickReply> | null;
  if (!o || typeof o !== 'object') throw new Error('Arquivo inválido.');
  if (o.atendo !== 'quick-reply') throw new Error('Este arquivo não é uma resposta rápida do Atendo.');
  if (o.version !== PORTABLE_QR_VERSION) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
  const title = str(o.title, 80).trim();
  if (!title) throw new Error('Há uma resposta sem título.');
  const body = str(o.body, 4096);
  if (!body.trim()) throw new Error(`A resposta "${title}" está sem texto.`);
  return { atendo: 'quick-reply', version: PORTABLE_QR_VERSION, folder: str(o.folder, 60).trim() || 'Importadas', title, body };
}

/** Aceita o arquivo individual ou o lote (até 500); devolve sempre a lista. */
export const parsePortableReplyFile = (raw: unknown): PortableQuickReply[] =>
  parsePortableFile(raw, {
    kind: 'quick-reply',
    version: PORTABLE_QR_VERSION,
    max: 500,
    parseItem: parsePortableReply,
    text: { empty: 'O arquivo não tem nenhuma resposta.', tooMany: 'No máximo 500 respostas por arquivo.', item: (n) => `Resposta ${n} do arquivo` },
  });
