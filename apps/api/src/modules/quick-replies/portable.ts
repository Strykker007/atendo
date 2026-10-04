/**
 * Levar respostas rápidas de um cliente para outro — mesmo desenho do `flows/portable.ts`.
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
export interface PortableQuickReplyBundle {
  atendo: 'quick-reply-bundle';
  version: number;
  items: PortableQuickReply[];
}

export function toPortableReply(r: { title: string; body: string; mediaKey: string | null }, folderName: string): { portable: PortableQuickReply; warnings: string[] } {
  return {
    portable: { atendo: 'quick-reply', version: PORTABLE_QR_VERSION, folder: folderName, title: r.title, body: r.body },
    warnings: r.mediaKey ? [`"${r.title}": o anexo não vai no arquivo — reenvie no destino.`] : [],
  };
}

export function toReplyBundle(items: PortableQuickReply[]): PortableQuickReplyBundle {
  return { atendo: 'quick-reply-bundle', version: PORTABLE_QR_VERSION, items };
}

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

/** Aceita o arquivo individual ou o lote; devolve sempre a lista. */
export function parsePortableReplyFile(raw: unknown): PortableQuickReply[] {
  const o = raw as Partial<PortableQuickReplyBundle> | null;
  if (o && typeof o === 'object' && o.atendo === 'quick-reply-bundle') {
    if (o.version !== PORTABLE_QR_VERSION) throw new Error(`Arquivo gerado por outra versão (${String(o.version)}).`);
    if (!Array.isArray(o.items) || !o.items.length) throw new Error('O arquivo não tem nenhuma resposta.');
    if (o.items.length > 500) throw new Error('No máximo 500 respostas por arquivo.');
    return o.items.map((it, i) => {
      try {
        return parsePortableReply(it);
      } catch (e) {
        throw new Error(`Resposta ${i + 1} do arquivo: ${e instanceof Error ? e.message : 'inválida'}`);
      }
    });
  }
  return [parsePortableReply(raw)];
}
