'use client';
import { useRef, useState } from 'react';
import { BookUser, Download, Upload, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useCan, useImportContacts, downloadContactsCsv, type ContactImportBody, type ContactImportReport } from '@/lib/hooks';
import { readXlsx } from '@/lib/xlsx-read';

/** mesmo teto da API (IMPORT_MAX_ROWS) — avisa antes de mandar */
const MAX_ROWS = 5_000;

/**
 * Importar e exportar a base de contatos (docs/08-frontend.md#contatos). A importação confere
 * primeiro (prévia sem gravar) e só grava no "Importar" — assim a pessoa vê quantos são novos,
 * quantos atualizam e quais linhas ficaram de fora antes de mexer na base.
 */
export default function ContatosPage() {
  const pode = useCan('contacts.import_export');
  const importar = useImportContacts();
  const input = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<{ name: string; body: ContactImportBody } | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [previa, setPrevia] = useState<ContactImportReport | null>(null);
  const [feito, setFeito] = useState<ContactImportReport | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [lendo, setLendo] = useState(false);

  if (!pode) return <PageShell><Empty icon={<BookUser size={28} />} title="Sem acesso" text="Importar e exportar contatos depende da permissão do seu perfil." /></PageShell>;

  async function escolher(file: File) {
    setPrevia(null); setFeito(null); setLendo(true);
    try {
      const xlsx = /\.xlsx$/i.test(file.name);
      if (!xlsx && !/\.(csv|txt)$/i.test(file.name)) throw new Error('Use um arquivo .csv ou .xlsx.');
      const body: ContactImportBody = xlsx ? { rows: await readXlsx(file) } : { csv: await file.text() };
      const linhas = body.rows?.length ?? body.csv!.split(/\r?\n/).filter((l) => l.trim()).length;
      if (linhas > MAX_ROWS + 1) throw new Error(`A planilha tem ${linhas.toLocaleString('pt-BR')} linhas; o máximo por importação é ${MAX_ROWS.toLocaleString('pt-BR')}. Divida o arquivo.`);
      setArquivo({ name: file.name, body });
      setPrevia(await importar.mutateAsync({ ...body, overwrite, dryRun: true }));
    } catch (e) {
      setArquivo(null);
      toast.err(e);
    } finally {
      setLendo(false);
      if (input.current) input.current.value = '';
    }
  }

  async function conferirDeNovo(ow: boolean) {
    setOverwrite(ow);
    if (arquivo) setPrevia(await importar.mutateAsync({ ...arquivo.body, overwrite: ow, dryRun: true }).catch((e) => { toast.err(e); return null; }));
  }

  async function gravar() {
    if (!arquivo) return;
    try {
      const r = await importar.mutateAsync({ ...arquivo.body, overwrite });
      setFeito(r); setPrevia(null); setArquivo(null);
      toast.ok(`${r.created} contato(s) novo(s), ${r.updated} atualizado(s)`);
    } catch (e) { toast.err(e); }
  }

  async function exportar() {
    setBaixando(true);
    try { await downloadContactsCsv(); } catch (e) { toast.err(e); } finally { setBaixando(false); }
  }

  const relatorio = feito ?? previa;
  return (
    <PageShell width="max-w-3xl">
      <PageHeader title="Contatos" subtitle="Importe uma planilha para a base ou exporte todos os contatos." />

      <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><Download size={16} className="text-accent" /> Exportar</h2>
        <p className="text-sm text-muted">Planilha (.csv) com nome, telefone, e-mail, documento, endereço, observações, tags, descadastro e os campos personalizados. Abre direto no Excel.</p>
        <Button icon={<Download size={14} />} onClick={exportar} loading={baixando} loadingText="Gerando…">Exportar contatos</Button>
      </section>

      <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><Upload size={16} className="text-accent" /> Importar</h2>
        <p className="text-sm text-muted">
          Arquivo .csv ou .xlsx (1ª aba) com uma coluna <b>Telefone</b> e, se quiser, <b>Nome</b>, <b>E-mail</b>, <b>Documento</b>, <b>Endereço</b>, <b>Observação 1</b>, <b>Observação 2</b> e <b>Tags</b> (separadas por vírgula; só as que já existem).
          Telefone sem DDI vira Brasil (+55). Até {MAX_ROWS.toLocaleString('pt-BR')} linhas por vez. A planilha exportada daqui pode ser reimportada.
        </p>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={overwrite} onChange={(e) => void conferirDeNovo(e.target.checked)} />
          <span>Sobrescrever o que já está na ficha <span className="text-muted">(inclusive o nome digitado pela equipe). Desligado: só completa campos vazios e troca o nome que veio do WhatsApp.</span></span>
        </label>
        <input ref={input} type="file" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void escolher(f); }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" icon={<FileSpreadsheet size={14} />} onClick={() => input.current?.click()} loading={lendo} loadingText="Conferindo…">Escolher planilha</Button>
          {arquivo && previa && <Button icon={<Upload size={14} />} onClick={gravar} loading={importar.isPending && !lendo} loadingText="Importando…" disabled={!previa.created && !previa.updated}>Importar {previa.created + previa.updated} contato(s)</Button>}
          {arquivo && <span className="text-xs text-muted">{arquivo.name}</span>}
        </div>

        {relatorio && (
          <div className="rounded-xl border border-line p-4 space-y-2 text-sm">
            <div className="font-semibold text-ink">{relatorio.dryRun ? 'Prévia (nada foi gravado ainda)' : 'Importação concluída'}</div>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2 tnum">
              <li><b className="text-ok">{relatorio.created}</b> novos</li>
              <li><b className="text-accent-ink">{relatorio.updated}</b> atualizados</li>
              <li><b>{relatorio.unchanged}</b> sem mudança</li>
              <li><b className={relatorio.invalidCount ? 'text-danger-ink' : ''}>{relatorio.invalidCount}</b> inválidos</li>
            </ul>
            {relatorio.duplicates > 0 && <p className="text-xs text-muted">{relatorio.duplicates} linha(s) repetida(s) na planilha — valeu a primeira.</p>}
            {relatorio.unknownTags.length > 0 && (
              <p className="text-xs text-warn-ink flex gap-1"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> Tags que não existem (crie em Tags e importe de novo): {relatorio.unknownTags.join(', ')}</p>
            )}
            {relatorio.invalid.length > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Linhas fora da importação</summary>
                <ul className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                  {relatorio.invalid.map((i) => <li key={i.line}>Linha {i.line}: {i.reason}{i.value ? ` (“${i.value}”)` : ''}</li>)}
                  {relatorio.invalidCount > relatorio.invalid.length && <li>… e mais {relatorio.invalidCount - relatorio.invalid.length}</li>}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </PageShell>
  );
}
