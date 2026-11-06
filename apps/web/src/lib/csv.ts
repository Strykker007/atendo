/** Número para planilha em pt-BR (vírgula decimal). */
export const csvNum = (v: number | null | undefined) => (v === null || v === undefined ? '' : v.toFixed(2).replace('.', ','));

/**
 * CSV para a contabilidade/planilha: `;` e vírgula decimal, com BOM — abre direto no Excel em pt-BR.
 * Várias seções no mesmo arquivo: passe `blocos`, separados por uma linha em branco com o título.
 */
export function downloadCsv(nome: string, blocos: { titulo?: string; head: string[]; linhas: string[][] }[]) {
  const cel = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const partes = blocos.map((b) => [...(b.titulo ? [[b.titulo]] : []), b.head, ...b.linhas].map((l) => l.map((c) => cel(String(c ?? ''))).join(';')).join('\r\n'));
  const blob = new Blob(['﻿' + partes.join('\r\n\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nome}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
