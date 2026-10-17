import { normalizePhone } from '../campaigns/segmentation.service';

/**
 * Importação e exportação da base de contatos em planilha (docs/07-api.md › /contacts).
 * Puro de propósito: leitura do CSV, reconhecimento das colunas e validação são testados sem banco.
 */

/** teto de linhas por importação — acima disso, dividir o arquivo */
export const IMPORT_MAX_ROWS = 5_000;
/** teto da exportação (a planilha é montada em memória) */
export const EXPORT_MAX_ROWS = 100_000;

export type ImportField = 'name' | 'phone' | 'email' | 'document' | 'address' | 'note1' | 'note2' | 'tags';

/** cabeçalhos aceitos por campo, já sem acento e minúsculos */
const HEADERS: Record<ImportField, string[]> = {
  name: ['nome', 'name', 'cliente', 'contato', 'nome completo'],
  phone: ['telefone', 'phone', 'celular', 'whatsapp', 'numero', 'fone', 'tel', 'mobile'],
  email: ['email', 'e-mail', 'e mail'],
  document: ['documento', 'cpf', 'cnpj', 'cpf/cnpj', 'document'],
  address: ['endereco', 'address'],
  note1: ['observacao', 'observacao 1', 'obs', 'obs 1', 'nota', 'note'],
  note2: ['observacao 2', 'obs 2', 'nota 2'],
  tags: ['tags', 'etiquetas', 'tag', 'etiqueta'],
};

/** Cabeçalho da exportação — o mesmo que a importação reconhece (exportar e reimportar funciona). */
export const EXPORT_HEADER = ['Nome', 'Telefone', 'E-mail', 'Documento', 'Endereço', 'Observação 1', 'Observação 2', 'Tags', 'Descadastrado', 'Criado em'];

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * CSV → matriz. Aceita `;` (Excel em português), `,` e tabulação — o separador é o que mais
 * aparece na 1ª linha fora de aspas. Aspas duplas com `""` escapado e quebra de linha dentro de aspas.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const primeira = src.split(/\r?\n/, 1)[0] ?? '';
  const fora = primeira.replace(/"[^"]*"/g, '');
  const conta = (c: string) => fora.split(c).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => conta(b) - conta(a))[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // linhas totalmente vazias (fim do arquivo, linhas em branco no meio) não contam
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Matriz → CSV com `;` e BOM: abre direto no Excel em português, com acentos. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    // fórmula injetada (=, +, -, @) vira texto: a planilha é aberta por gente, no Excel
    const seguro = /^[=+\-@]/.test(s) && !/^[+-]?\d[\d\s().-]*$/.test(s) ? `'${s}` : s;
    return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}

/** Coluna de cada campo pelo cabeçalho; null = a 1ª linha não é cabeçalho reconhecível. */
export function mapHeader(header: string[]): Partial<Record<ImportField, number>> | null {
  const out: Partial<Record<ImportField, number>> = {};
  header.forEach((h, i) => {
    const k = semAcento(h).replace(/[:*]/g, '').trim();
    // cabeçalho exportado por nós ("Observação 1") ou parecido; o 1º que bate fica
    for (const field of Object.keys(HEADERS) as ImportField[]) {
      if (out[field] === undefined && HEADERS[field].includes(k)) { out[field] = i; break; }
    }
  });
  return out.phone === undefined ? null : out;
}

/** Sem cabeçalho: a coluna de telefone é a que mais tem telefone válido; o nome, a 1ª de texto. */
function guessColumns(rows: string[][]): Partial<Record<ImportField, number>> {
  const width = Math.max(...rows.map((r) => r.length));
  const amostra = rows.slice(0, 50);
  let phone = 0;
  let best = -1;
  for (let c = 0; c < width; c++) {
    const n = amostra.filter((r) => r[c] && normalizePhone(r[c])).length;
    if (n > best) { best = n; phone = c; }
  }
  const name = [...Array(width).keys()].find((c) => c !== phone && amostra.some((r) => /[a-zà-ú]/i.test(r[c] ?? '')));
  return { phone, ...(name !== undefined && { name }) };
}

export interface ImportRecord {
  /** linha na planilha (1 = cabeçalho), para o relatório */
  line: number;
  phone: string;
  name?: string;
  email?: string;
  document?: string;
  address?: string;
  note1?: string;
  note2?: string;
  tags: string[];
}

export interface ReadResult {
  records: ImportRecord[];
  /** linhas com telefone ausente/inválido */
  invalid: { line: number; value: string; reason: string }[];
  /** repetidas no próprio arquivo (fica a 1ª) */
  duplicates: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matriz (do CSV ou do XLSX lido no navegador) → contatos válidos + o que ficou de fora. */
export function readImportRows(rows: string[][]): ReadResult {
  const limpas = rows.map((r) => r.map((v) => String(v ?? '').trim()));
  if (!limpas.length) return { records: [], invalid: [], duplicates: 0 };
  const header = mapHeader(limpas[0]);
  const cols = header ?? guessColumns(limpas);
  const start = header ? 1 : 0;
  const get = (r: string[], f: ImportField) => (cols[f] !== undefined ? r[cols[f]!]?.trim() || undefined : undefined);

  const records: ImportRecord[] = [];
  const invalid: ReadResult['invalid'] = [];
  const vistos = new Set<string>();
  let duplicates = 0;
  for (let i = start; i < limpas.length; i++) {
    const r = limpas[i];
    const line = i + 1;
    const raw = get(r, 'phone') ?? '';
    const phone = raw ? normalizePhone(raw) : null;
    if (!phone) {
      invalid.push({ line, value: raw, reason: raw ? 'telefone inválido' : 'sem telefone' });
      continue;
    }
    if (vistos.has(phone)) { duplicates++; continue; }
    vistos.add(phone);
    const email = get(r, 'email');
    const doc = get(r, 'document')?.replace(/\D/g, '');
    records.push({
      line,
      phone,
      name: get(r, 'name')?.slice(0, 120),
      // e-mail/documento malformado não derruba a linha: só não entra
      email: email && EMAIL.test(email) ? email.toLowerCase().slice(0, 200) : undefined,
      document: doc && (doc.length === 11 || doc.length === 14) ? doc : undefined,
      address: get(r, 'address')?.slice(0, 300),
      note1: get(r, 'note1')?.slice(0, 1000),
      note2: get(r, 'note2')?.slice(0, 1000),
      tags: (get(r, 'tags') ?? '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
    });
  }
  return { records, invalid, duplicates };
}

export interface ExistingContact {
  name: string | null;
  nameSource: 'whatsapp' | 'agenda' | 'manual';
  email: string | null;
  document: string | null;
  address: string | null;
  note1: string | null;
  note2: string | null;
}

/**
 * O que muda num contato que já existe. Sem `overwrite`, só preenche o que está vazio — e o
 * nome digitado pela equipe (`manual`) nunca é trocado; o do WhatsApp/agenda dá lugar ao da
 * planilha (alguém escolheu esse nome de propósito). Com `overwrite`, a planilha vence.
 */
export function mergeContact(cur: ExistingContact, rec: ImportRecord, overwrite: boolean) {
  const data: Partial<ExistingContact> = {};
  if (rec.name && rec.name !== cur.name && (overwrite || !cur.name || cur.nameSource !== 'manual')) {
    data.name = rec.name;
    data.nameSource = 'manual';
  }
  for (const f of ['email', 'document', 'address', 'note1', 'note2'] as const) {
    const v = rec[f];
    if (v && v !== cur[f] && (overwrite || !cur[f])) data[f] = v;
  }
  return data;
}
