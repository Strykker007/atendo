/**
 * Documentos do agente (docs/agente-ia.md#documentos) — a parte PURA e testada: limpar o texto
 * extraído, cortar em trechos que respeitam capítulo/artigo, montar a busca por palavra e juntar
 * as duas buscas (palavra + significado).
 */

/** tamanho alvo de um trecho: cabe um artigo médio inteiro, e 5 trechos cabem folgados no prompt */
export const CHUNK_TARGET = 1200;
const CHUNK_MIN = 350;
const CHUNK_MAX = 2000;
const SECTION_MIN = 150;
/** quantos trechos vão para a IA e o teto de texto somado */
export const HITS_TOP = 5;
export const HITS_MAX_CHARS = 6500;

export interface Chunk {
  position: number;
  heading: string | null;
  text: string;
}

/** minúsculo e sem acento: o contato escreve "salao", o regimento "salão" */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Capítulo, título, seção: dá nome ao trecho. */
const SECTION_RE = /^(t[íi]tulo|cap[íi]tulo|se[çc][ãa]o|subse[çc][ãa]o|anexo|parte)\s+([ivxlcdm]+|\d+|[úu]nic[oa])\b/i;
/** começo de artigo/parágrafo legal: bom lugar para cortar */
const ARTICLE_RE = /^(art(igo|\.)?\s*\d+|§\s*\d+|par[áa]grafo\s+[úu]nico)/i;
/** item de lista: nunca grudar na linha de cima */
const ITEM_RE = /^([ivxlcdm]+\s*[-–—)]|[a-z]\)|\d+[.)]\s|[-•*]\s)/i;

/**
 * Texto extraído → parágrafos. PDF quebra linha no meio da frase: junta a linha com a de cima
 * quando a de cima não terminou (sem ponto final) e a de baixo não começa um artigo/item/título.
 */
export function paragraphs(raw: string): string[] {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/­/g, '')
    // palavra hifenizada no fim da linha: "conven-\nção" → "convenção"
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim());
  const out: string[] = [];
  let cur = '';
  const flush = () => { if (cur) out.push(cur); cur = ''; };
  for (const l of lines) {
    if (!l) { flush(); continue; }
    // número de página solto
    if (/^(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(de|\/)\s*\d{1,4})?$/i.test(l)) continue;
    const starts = SECTION_RE.test(l) || ARTICLE_RE.test(l) || ITEM_RE.test(l);
    // título ("CAPÍTULO II", "DAS OBRAS") fica sozinho: não engole a linha de baixo
    const title = cur.length <= 160 && (SECTION_RE.test(cur) || (/\p{L}{3}/u.test(cur) && cur === cur.toUpperCase()));
    if (cur && !starts && !title && !/[.:;!?]$/.test(cur)) cur += ` ${l}`;
    else { flush(); cur = l; }
  }
  flush();
  return out;
}

/** Corta um parágrafo grande demais em frases, sem passar de `CHUNK_MAX`. */
function splitLong(p: string): string[] {
  if (p.length <= CHUNK_MAX) return [p];
  const parts: string[] = [];
  let cur = '';
  for (const s of p.split(/(?<=[.!?;])\s+/)) {
    if (cur && cur.length + s.length + 1 > CHUNK_TARGET) { parts.push(cur); cur = ''; }
    cur = cur ? `${cur} ${s}` : s;
    while (cur.length > CHUNK_MAX) { parts.push(cur.slice(0, CHUNK_TARGET)); cur = cur.slice(CHUNK_TARGET); }
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * Parágrafos → trechos de ~`CHUNK_TARGET` caracteres. Corta de preferência no começo de um artigo
 * ou capítulo; cada trecho leva o capítulo/seção em que está (`heading`), que entra na busca e
 * no que a IA lê ("Capítulo IV — Das obras").
 */
export function chunkText(raw: string): Chunk[] {
  const chunks: Chunk[] = [];
  let section: string | null = null;
  let heading: string | null = null;
  let cur: string[] = [];
  let len = 0;
  const flush = () => {
    const text = cur.join('\n').trim();
    if (text) chunks.push({ position: chunks.length, heading, text });
    cur = [];
    len = 0;
    heading = section;
  };
  const paras = paragraphs(raw);
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (SECTION_RE.test(p) && p.length <= 160) {
      // título do capítulo costuma vir na linha seguinte ("CAPÍTULO IV" / "DAS OBRAS")
      const next = paras[i + 1];
      const title = next && next.length <= 120 && !ARTICLE_RE.test(next) && !/[.;]$/.test(next) && next === next.toUpperCase() ? next : null;
      // capítulo novo é fronteira forte de assunto: corta mesmo com trecho curto
      if (len >= SECTION_MIN) flush();
      section = title ? `${p} — ${title}` : p;
      if (!len) heading = section;
      cur.push(title ? `${p}\n${title}` : p);
      len += p.length + (title?.length ?? 0);
      if (title) i++;
      continue;
    }
    const article = ARTICLE_RE.test(p);
    for (const piece of splitLong(p)) {
      const over = len + piece.length > CHUNK_TARGET;
      if (len && ((over && len >= CHUNK_MIN) || (article && len >= CHUNK_TARGET * 0.6) || len + piece.length > CHUNK_MAX)) flush();
      cur.push(piece);
      len += piece.length + 1;
    }
  }
  flush();
  return chunks;
}

/** Texto do trecho como entra na busca por palavra e no embedding: o capítulo ajuda a achar. */
export const searchableOf = (c: Pick<Chunk, 'heading' | 'text'>) => (c.heading && !c.text.startsWith(c.heading.split(' — ')[0]) ? `${c.heading}\n${c.text}` : c.text);

/**
 * Pergunta → expressão do `to_tsquery('portuguese', …)`. Palavras com OU (pergunta de cliente
 * nunca bate palavra por palavra), sem acento e só [a-z0-9] — nada do contato vira operador.
 * O dicionário português tira "de", "que", "o" e reduz "obras" → "obra".
 */
/**
 * Palavras de conversa que o dicionário do Postgres não tira e que, no OU, puxavam trecho sem
 * relação ("vou ficar 3 dias" trazia o artigo dos animais). Quem pergunta o assunto continua
 * achando pela busca por significado.
 */
const CHAT_WORDS = new Set(['quais', 'qual', 'quero', 'queria', 'gostaria', 'preciso', 'precisava', 'saber', 'entao', 'temos', 'tem', 'sou', 'vou', 'ficar', 'fico', 'aqui', 'voces', 'voce', 'sobre', 'isso', 'favor', 'obrigado', 'obrigada', 'bom', 'boa', 'tarde', 'noite', 'ola', 'oi', 'tudo', 'bem', 'alguem', 'ajudar', 'duvida', 'pergunta', 'informacao', 'informar']);

export function keywordQuery(q: string): string | null {
  const words = [...new Set((fold(q).match(/[a-z]{3,}|\d+/g) ?? []).filter((w) => !CHAT_WORDS.has(w)))].slice(0, 16);
  return words.length ? words.join(' | ') : null;
}

/** Vetor → bytes (Float32) normalizado: com norma 1, cosseno vira produto escalar. */
export function packVector(v: number[]): Buffer {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const f = Float32Array.from(v, (x) => x / n);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

export function unpackVector(b: Uint8Array): Float32Array {
  // copia: o Buffer do Prisma pode não estar alinhado em 4 bytes
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Junta as duas listas (palavra e significado) por posição — Reciprocal Rank Fusion. Quem aparece
 * bem nas duas sobe; não precisa calibrar a nota de uma contra a outra.
 */
export function fuse(keyword: string[], semantic: string[], k = 60): { id: string; via: ('keyword' | 'semantic')[] }[] {
  const score = new Map<string, { s: number; via: ('keyword' | 'semantic')[] }>();
  const add = (ids: string[], via: 'keyword' | 'semantic') =>
    ids.forEach((id, rank) => {
      const cur = score.get(id) ?? { s: 0, via: [] };
      cur.s += 1 / (k + rank + 1);
      cur.via.push(via);
      score.set(id, cur);
    });
  add(keyword, 'keyword');
  add(semantic, 'semantic');
  return [...score.entries()].sort((a, b) => b[1].s - a[1].s).map(([id, v]) => ({ id, via: v.via }));
}

/** Pergunta para a busca: as últimas mensagens do contato (a última sozinha pode ser "e no domingo?"). */
export function queryFromHistory(history: { direction: 'in' | 'out'; text: string | null; internal?: boolean }[]): string {
  const ins = history.filter((m) => m.direction === 'in' && !m.internal && m.text?.trim()).map((m) => m.text!.trim());
  return ins.slice(-2).join('\n').slice(-600);
}
