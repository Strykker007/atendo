'use client';
/**
 * Leitor mínimo de .xlsx no navegador — só a 1ª aba, só os valores (sem fórmula, formatação nem
 * data convertida). Basta para importar contatos sem trazer uma biblioteca de planilha inteira:
 * o .xlsx é um zip de XMLs, e o navegador já sabe descompactar (`DecompressionStream`).
 */

interface ZipEntry { name: string; method: number; compSize: number; offset: number }

/** Índice do zip pelo diretório central (o tamanho no cabeçalho local pode vir zerado). */
function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo .xlsx inválido.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const compSize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    // dados começam depois do cabeçalho local (nome + extra dele)
    const offset = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: ArrayBuffer, e: ZipEntry): Promise<string> {
  const data = new Uint8Array(buf, e.offset, e.compSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error('Compressão do .xlsx não suportada.');
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre .xlsx — salve a planilha como CSV.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** "B12" → índice da coluna (0 = A). */
function colIndex(ref: string) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** 1ª aba do .xlsx → linhas × colunas de texto. */
export async function readXlsx(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const entries = zipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const parser = new DOMParser();
  const xml = async (name: string) => {
    const e = byName.get(name);
    return e ? parser.parseFromString(await readEntry(buf, e), 'application/xml') : null;
  };

  // textos compartilhados: a célula de texto guarda só o índice
  const sst = await xml('xl/sharedStrings.xml');
  const shared = sst ? [...sst.getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('')) : [];

  // 1ª aba de verdade (pela ordem do workbook), não necessariamente sheet1.xml
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await xml('xl/workbook.xml');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  const first = wb?.getElementsByTagName('sheet')[0];
  const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = rid && rels ? [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') : null;
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;

  const sheet = await xml(sheetPath);
  if (!sheet) throw new Error('A planilha não tem nenhuma aba legível.');
  const rows: string[][] = [];
  for (const row of [...sheet.getElementsByTagName('row')]) {
    const cells: string[] = [];
    for (const c of [...row.getElementsByTagName('c')]) {
      const i = colIndex(c.getAttribute('r') ?? '');
      const type = c.getAttribute('t');
      const raw = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const value = type === 's' ? shared[Number(raw)] ?? ''
        : type === 'inlineStr' ? [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('')
        // telefone salvo como número grande vem em notação científica: "5.511999998888E12"
        : /e\+?\d+$/i.test(raw) && !Number.isNaN(Number(raw)) ? BigInt(Math.round(Number(raw))).toString()
        : raw;
      cells[i] = value;
    }
    rows.push(Array.from(cells, (v) => v ?? ''));
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}
