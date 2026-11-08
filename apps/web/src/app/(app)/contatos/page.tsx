'use client';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookUser, Download, Upload, FileSpreadsheet, AlertTriangle, Search, MessageSquare, Send, IdCard, ChevronDown, Loader2, BellOff } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { formatPhone } from '@/components/ui/PhoneInput';
import { NewConversationModal } from '@/components/chat/NewConversationModal';
import { ContactSheet } from '@/components/chat/ContactSheet';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { useCan, useDebounced, useContactsList, useImportContacts, downloadContactsCsv, type ContactImportBody, type ContactImportReport, type ContactRow } from '@/lib/hooks';
import { readXlsx } from '@/lib/xlsx-read';

/** mesmo teto da API (IMPORT_MAX_ROWS) — avisa antes de mandar */
const MAX_ROWS = 5_000;

const STATUS_LABEL = { waiting: 'Na fila', in_progress: 'Em atendimento', closed: 'Encerrada' } as const;

/**
 * Contatos (docs/08-frontend.md#contatos): a base que a pessoa enxerga, com busca e ações —
 * abrir a conversa, iniciar uma nova (com ou sem mensagem), editar a ficha. Importar/exportar
 * planilha fica embaixo, para quem tem `contacts.import_export`.
 */
export default function ContatosPage() {
  const podePlanilha = useCan('contacts.import_export');
  const [planilha, setPlanilha] = useState(false);
  return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Contatos" subtitle="Encontre alguém e fale com ele: abra a conversa, inicie uma nova ou atualize a ficha." />
      <ListaDeContatos />
      {podePlanilha && (
        <section className="space-y-3">
          <button type="button" onClick={() => setPlanilha((v) => !v)} aria-expanded={planilha} className="w-full flex items-center gap-2 rounded-2xl border border-dashed border-line bg-panel px-4 py-3 text-sm text-ink hover:bg-field">
            <FileSpreadsheet size={16} className="text-muted" />
            <span className="font-medium flex-1 text-left">Importar ou exportar planilha</span>
            <ChevronDown size={16} className={cn('text-muted transition-transform', planilha && 'rotate-180')} />
          </button>
          {planilha && <Planilha />}
        </section>
      )}
    </PageShell>
  );
}

function ListaDeContatos() {
  const router = useRouter();
  const { setStatus, setConversation } = useUI();
  const [busca, setBusca] = useState('');
  const termo = useDebounced(busca.trim(), 300);
  const lista = useContactsList(termo);
  const itens = useMemo(() => lista.data?.pages.flatMap((p) => p.items) ?? [], [lista.data]);
  const [iniciando, setIniciando] = useState<ContactRow | 'novo' | null>(null);
  const [ficha, setFicha] = useState<ContactRow | null>(null);

  const abrir = (c: NonNullable<ContactRow['lastConversation']>) => {
    setStatus(c.status);
    setConversation(c.id);
    router.push('/conversas');
  };

  return (
    <section className="rounded-2xl bg-panel border border-line">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className={cn(inputCls, 'pl-9')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone" maxLength={100} aria-label="Buscar contato" />
          {lista.isFetching && !lista.isFetchingNextPage && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-faint" />}
        </div>
        <Button icon={<Send size={14} />} onClick={() => setIniciando('novo')}>Nova conversa</Button>
      </div>

      {lista.isLoading && <p className="p-6 text-center text-sm text-muted">Carregando contatos…</p>}
      {lista.isError && <p className="p-6 text-center text-sm text-danger-ink">Não foi possível carregar os contatos.</p>}
      {lista.data && !itens.length && (
        <Empty icon={<BookUser size={28} />} title={termo ? 'Ninguém encontrado' : 'Nenhum contato ainda'} text={termo ? 'Confira o nome ou o telefone. Para um número novo, use "Nova conversa".' : 'Os contatos aparecem aqui quando conversam com um dos seus números.'} />
      )}

      <ul className="divide-y divide-line">
        {itens.map((c) => {
          const conv = c.lastConversation;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <span className="w-9 h-9 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-sm font-semibold shrink-0">{(c.name ?? '#').trim().charAt(0).toUpperCase()}</span>
              <div className="min-w-0 flex-1 basis-48">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-medium text-ink truncate">{c.name || formatPhone(c.phone)}</span>
                  {c.optOutAt && <span title="Pediu para não receber mensagens automáticas" className="text-warn-ink shrink-0"><BellOff size={13} /></span>}
                </div>
                <div className="text-[12px] text-muted flex flex-wrap items-center gap-x-2">
                  {c.name && <span className="tnum">{formatPhone(c.phone)}</span>}
                  {conv && <span>{conv.number.label} · {STATUS_LABEL[conv.status]}{conv.assignee ? ` com ${conv.assignee.name}` : ''}</span>}
                </div>
                {!!c.tags?.length && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.tags.slice(0, 4).map(({ tag }) => <span key={tag.id} className="text-[10.5px] rounded-full px-1.5 py-0.5 text-white" style={{ background: tag.color }}>{tag.name}</span>)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                {conv && <Button size="sm" variant="ghost" icon={<MessageSquare size={13} />} onClick={() => abrir(conv)}>Abrir conversa</Button>}
                <Button size="sm" variant="ghost" icon={<Send size={13} />} onClick={() => setIniciando(c)} title="Escolher o número e, se quiser, já mandar uma mensagem">{conv ? 'Nova mensagem' : 'Iniciar conversa'}</Button>
                <Button size="sm" variant="ghost" icon={<IdCard size={13} />} onClick={() => setFicha(c)}>Ficha</Button>
              </div>
            </li>
          );
        })}
      </ul>

      {lista.hasNextPage && (
        <div className="p-3 border-t border-line text-center">
          <Button size="sm" variant="ghost" onClick={() => lista.fetchNextPage()} loading={lista.isFetchingNextPage} loadingText="Carregando…">Carregar mais</Button>
        </div>
      )}

      {iniciando && (
        <NewConversationModal
          contact={iniciando === 'novo' ? undefined : { id: iniciando.id, name: iniciando.name, phone: iniciando.phone }}
          onOpened={() => router.push('/conversas')}
          onClose={() => setIniciando(null)}
        />
      )}
      {ficha && <ContactSheet contact={ficha} onClose={() => setFicha(null)} />}
    </section>
  );
}

/**
 * Importar e exportar a base de contatos. A importação confere primeiro (prévia sem gravar) e
 * só grava no "Importar" — assim a pessoa vê quantos são novos, quantos atualizam e quais
 * linhas ficaram de fora antes de mexer na base.
 */
function Planilha() {
  const importar = useImportContacts();
  const input = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<{ name: string; body: ContactImportBody } | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [previa, setPrevia] = useState<ContactImportReport | null>(null);
  const [feito, setFeito] = useState<ContactImportReport | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [lendo, setLendo] = useState(false);

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
    <div className="space-y-4">
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
              {!!relatorio.outOfScope && <li><b>{relatorio.outOfScope}</b> de outra empresa (não alterados)</li>}
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
    </div>
  );
}
