'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Plus, Workflow, Trash2, Zap, Lock, Copy, Download, Upload, Pin, Power, PowerOff } from 'lucide-react';
import { cn, downloadJson, safeFileName } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { hasWebhookBody, type FlowDefinition } from '@atendo/shared';
import { useFlows, useDeleteFlow, useDuplicateFlows, useExportFlow, useExportFlows, useImportFlow, useUpdateFlow, useSetFlowsActive, useHasFeature, useMe, useCan, fetchFlowReferences, type FlowSummary } from '@/lib/hooks';

const TRIGGER_LABEL = { manual: 'Manual (pelo chat)', new_conversation: 'Toda conversa nova', keyword: 'Palavra-chave' };

export default function FluxosPage() {
  const me = useMe();
  // esconder na tela é conveniência; quem autoriza é a API
  const isAdmin = useCan('flows.manage');
  const feature = useHasFeature('flows');
  const flows = useFlows();
  const remove = useDeleteFlow();
  const duplicate = useDuplicateFlows();
  const update = useUpdateFlow();
  const exportFlow = useExportFlow();
  const exportFlows = useExportFlows();
  const importFlow = useImportFlow();
  const setActive = useSetFlowsActive();
  const fileInput = useRef<HTMLInputElement>(null);
  // `refs`: fluxos que conectam a este (bloco "Conectar com outro fluxo"); listados no aviso
  const [deleting, setDeleting] = useState<(FlowSummary & { refs?: { id: string; name: string }[] }) | null>(null);
  const askDelete = async (f: FlowSummary) => {
    const refs = await fetchFlowReferences(f.id).catch(() => undefined);
    setDeleting({ ...f, refs });
  };
  const [selected, setSelected] = useState<string[]>([]);
  // fluxo apagado some da seleção: exportar um id que não existe mais daria erro
  const visible = flows.data?.map((f) => f.id) ?? [];
  const sel = selected.filter((id) => visible.includes(id));
  const allOn = visible.length > 0 && sel.length === visible.length;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // o que não viaja entre clientes (anexo, atendente, serviço) vira aviso — melhor o usuário
  // saber o que ajustar do que descobrir com o fluxo mudo na frente do contato
  const warn = (warnings: string[]) => warnings.forEach((w) => toast.err(w));

  async function onDuplicate(ids: string[]) {
    try {
      const { flows: novos } = await duplicate.mutateAsync(ids);
      toast.ok(novos.length === 1 ? `"${novos[0].name}" criado, desativado — ative quando terminar de ajustar.` : `${novos.length} cópias criadas, desativadas — ative quando terminar de ajustar.`);
      setSelected([]);
    } catch (err) { toast.err(err); }
  }

  /** Liga/desliga a seleção. Os que não podem ser ativados (desenho inválido) ficam como estão, com o motivo. */
  async function onSetActive(isActive: boolean) {
    try {
      const { updated, failed } = await setActive.mutateAsync({ ids: sel, isActive });
      if (updated) toast.ok(isActive ? `${updated} fluxo(s) ativado(s).` : `${updated} fluxo(s) desativado(s) — não disparam mais sozinhos nem aparecem no chat.`);
      failed.forEach((f) => toast.err(`"${f.name}" não foi ativado: ${f.reason}`));
      if (!failed.length) setSelected([]);
    } catch (err) { toast.err(err); }
  }

  const [toggling, setToggling] = useState<string | null>(null);
  /** Liga/desliga direto da lista. A API recusa ativar um desenho inválido e diz o motivo. */
  async function onToggleActive(f: FlowSummary) {
    setToggling(f.id);
    try {
      await update.mutateAsync({ id: f.id, isActive: !f.isActive });
      toast.ok(f.isActive ? `"${f.name}" desativado — não dispara mais sozinho nem aparece no chat.` : `"${f.name}" ativado.`);
    } catch (err) { toast.err(err); }
    finally { setToggling(null); }
  }

  /**
   * Corpo de webhook viaja no arquivo (pode ter token escrito à mão): antes de baixar, a pessoa
   * confirma que revisou. Sem corpo, baixa direto.
   */
  const [pendingDownload, setPendingDownload] = useState<{ data: unknown; file: string } | null>(null);
  function download(data: unknown, file: string, defs: FlowDefinition[], warnings: string[]) {
    warn(warnings);
    if (defs.some(hasWebhookBody)) setPendingDownload({ data, file });
    else downloadJson(data, file);
  }

  async function onExport(f: FlowSummary) {
    try {
      const { portable, warnings } = await exportFlow.mutateAsync(f.id);
      download(portable, `${safeFileName(f.name, 'fluxo')}.fluxo.json`, [portable.definition], warnings);
    } catch (err) { toast.err(err); }
  }

  /** Um arquivo só, com a lista de fluxos no mesmo formato da exportação individual. */
  async function onExportSelected() {
    try {
      const { bundle, warnings } = await exportFlows.mutateAsync(sel);
      download(bundle, `fluxos-${new Date().toISOString().slice(0, 10)}.fluxos.json`, bundle.items.map((it) => it.definition), warnings);
    } catch (err) { toast.err(err); }
  }

  async function onImport(file: File) {
    try {
      const { flows: novos, warnings } = await importFlow.mutateAsync(JSON.parse(await file.text()));
      toast.ok(novos.length === 1 ? `"${novos[0].name}" importado, desativado — confira antes de ativar.` : `${novos.length} fluxos importados, desativados — confira antes de ativar.`);
      warn(warnings);
    } catch (err) { toast.err(err instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : err); }
  }

  if (!feature.loading && !feature.has) {
    return (
      <PageShell width="max-w-3xl">
        <PageHeader title="Fluxos de automação" />
        <div className="rounded-2xl border border-line bg-panel p-8 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-accent-soft text-accent-ink grid place-items-center"><Lock size={22} /></div>
          <p className="font-display font-semibold text-ink">Disponível nos planos Pro e Business</p>
          <p className="text-sm text-muted max-w-md mx-auto">Monte atendimentos automáticos com menu de opções, perguntas, condições e entrega para humano — e dispare pelo chat ou automaticamente em toda conversa nova.</p>
          {isAdmin && <Link href="/plano"><Button>Ver planos</Button></Link>}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Fluxos de automação" subtitle="Atendimento automático que você desenha: mensagens, menus, perguntas, condições e entrega para humano." action={isAdmin && (
        <div className="flex gap-2">
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f); }} />
          <Button variant="ghost" icon={<Upload size={16} />} loading={importFlow.isPending} onClick={() => fileInput.current?.click()}>Importar</Button>
          <Link href="/fluxos/novo"><Button icon={<Plus size={16} />}>Novo fluxo</Button></Link>
        </div>
      )} />
      {flows.isLoading && <SkeletonRows rows={3} />}
      {flows.data?.length === 0 && <Empty icon={<Workflow size={36} />} title="Nenhum fluxo" text="Crie o primeiro: por exemplo, uma triagem com menu 'Vendas / Suporte'." />}
      {!!flows.data?.length && (
        <div className="rounded-2xl bg-panel border border-line divide-y divide-line">
          {isAdmin && (
            <div className="flex items-center gap-3 px-4 py-2 bg-field/50 rounded-t-2xl text-xs">
              <input type="checkbox" aria-label="Selecionar todos" checked={allOn} ref={(el) => { if (el) el.indeterminate = sel.length > 0 && !allOn; }} onChange={() => setSelected(allOn ? [] : visible)} />
              <span className="text-muted flex-1">{sel.length ? `${sel.length} selecionado(s)` : 'Selecionar todos'}</span>
              {sel.length > 0 && (
                <>
                  <Button size="sm" variant="ghost" icon={<Power size={13} />} loading={setActive.isPending && setActive.variables?.isActive} onClick={() => onSetActive(true)}>Ativar</Button>
                  <Button size="sm" variant="ghost" icon={<PowerOff size={13} />} loading={setActive.isPending && !setActive.variables?.isActive} onClick={() => onSetActive(false)}>Desativar</Button>
                  <Button size="sm" variant="ghost" icon={<Copy size={13} />} loading={duplicate.isPending} onClick={() => onDuplicate(sel)}>Duplicar</Button>
                  <Button size="sm" variant="ghost" icon={<Download size={13} />} loading={exportFlows.isPending} onClick={onExportSelected}>Exportar selecionados</Button>
                </>
              )}
            </div>
          )}
          {flows.data.map((f) => (
            <div key={f.id} className={cn('flex items-center gap-3 px-4 py-3', sel.includes(f.id) && 'bg-accent-soft/40')}>
              {isAdmin && <input type="checkbox" aria-label={`Selecionar ${f.name}`} checked={sel.includes(f.id)} onChange={() => toggle(f.id)} />}
              <span className={cn('w-8 h-8 rounded-lg grid place-items-center shrink-0', f.isActive ? 'bg-accent-soft text-accent-ink' : 'bg-field text-faint')}><Zap size={15} /></span>
              <div className="min-w-0 flex-1">
                <Link href={`/fluxos/${f.id}`} className="font-medium text-ink hover:text-accent-ink">{f.name}</Link>
                <div className="text-xs text-muted truncate">{TRIGGER_LABEL[f.trigger.type]}{f.trigger.type === 'keyword' && f.trigger.keywords?.length ? ` · ${f.trigger.keywords.join(', ')}` : ''}{f.description ? ` · ${f.description}` : ''}</div>
              </div>
              <span className="text-xs text-faint tnum hidden sm:inline">{f._count.runs} execuções</span>
              {isAdmin ? (
                <button
                  role="switch"
                  aria-checked={f.isActive}
                  disabled={toggling === f.id}
                  title={f.isActive ? 'Ativo — clique para desativar' : 'Inativo — clique para ativar'}
                  onClick={() => onToggleActive(f)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold disabled:opacity-60"
                >
                  <span className={cn('relative w-7 h-4 rounded-full transition-colors', f.isActive ? 'bg-ok' : 'bg-line-strong')}>
                    <span className={cn('absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform', f.isActive && 'translate-x-3')} />
                  </span>
                  <span className={cn('w-11 text-left', f.isActive ? 'text-ok' : 'text-muted')}>{f.isActive ? 'Ativo' : 'Inativo'}</span>
                </button>
              ) : (
                <span className={cn('text-[10.5px] font-semibold rounded-full px-2 py-0.5', f.isActive ? 'bg-ok-soft text-ok' : 'bg-field text-muted')}>{f.isActive ? 'Ativo' : 'Inativo'}</span>
              )}
              {isAdmin && (
                <>
                  {/* Sempre o MESMO ícone: o que muda é o destaque. O alfinete cortado era
                      ambíguo — não dava para saber se mostrava o estado ou a ação do clique. */}
                  <button
                    title={f.showInChat ? 'Com atalho no chat — clique para remover' : 'Sem atalho no chat — clique para adicionar'}
                    onClick={() => update.mutateAsync({ id: f.id, showInChat: !f.showInChat }).then(() => toast.ok(f.showInChat ? 'Atalho removido do chat' : 'Atalho adicionado ao chat')).catch(toast.err)}
                    className={cn('p-1 rounded-md', f.showInChat ? 'text-accent-ink bg-accent-soft' : 'text-faint hover:text-ink')}
                  >
                    <Pin size={15} className={cn(f.showInChat && 'fill-current')} />
                  </button>
                  <button title="Duplicar neste cliente" onClick={() => onDuplicate([f.id])} className="text-faint hover:text-accent-ink p-1"><Copy size={15} /></button>
                  <button title="Exportar para usar em outro cliente" onClick={() => onExport(f)} className="text-faint hover:text-accent-ink p-1"><Download size={15} /></button>
                  <button title="Excluir" onClick={() => void askDelete(f)} className="text-faint hover:text-danger p-1"><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!pendingDownload} onClose={() => setPendingDownload(null)} title="Exportar fluxo" confirmLabel="Baixar mesmo assim" text="Este arquivo contém o corpo de webhooks. Verifique se não há tokens ou senhas." onConfirm={() => { if (pendingDownload) downloadJson(pendingDownload.data, pendingDownload.file); }} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir fluxo" danger confirmLabel="Excluir" text={`"${deleting?.name}" e seu histórico de execuções serão removidos.${deleting?.refs?.length ? ` Atenção: ${deleting.refs.length === 1 ? 'o fluxo' : 'os fluxos'} ${deleting.refs.map((r) => `"${r.name}"`).join(', ')} ${deleting.refs.length === 1 ? 'conecta' : 'conectam'} a este — depois de excluído, nesse ponto a conversa vai para a fila de atendimento.` : ''}`} onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Fluxo excluído'); } catch (err) { toast.err(err); throw err; } }} />
    </PageShell>
  );
}
