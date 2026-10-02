'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Plus, Workflow, Trash2, Zap, Lock, Copy, Download, Upload, Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useFlows, useDeleteFlow, useDuplicateFlow, useExportFlow, useImportFlow, useUpdateFlow, useHasFeature, useMe, useCan, type FlowSummary } from '@/lib/hooks';

const TRIGGER_LABEL = { manual: 'Manual (pelo chat)', new_conversation: 'Toda conversa nova', keyword: 'Palavra-chave' };

export default function FluxosPage() {
  const me = useMe();
  // esconder na tela é conveniência; quem autoriza é a API
  const isAdmin = useCan('flows.manage');
  const feature = useHasFeature('flows');
  const flows = useFlows();
  const remove = useDeleteFlow();
  const duplicate = useDuplicateFlow();
  const update = useUpdateFlow();
  const exportFlow = useExportFlow();
  const importFlow = useImportFlow();
  const fileInput = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<FlowSummary | null>(null);

  // o que não viaja entre clientes (anexo, atendente, serviço) vira aviso — melhor o usuário
  // saber o que ajustar do que descobrir com o fluxo mudo na frente do contato
  const warn = (warnings: string[]) => warnings.forEach((w) => toast.err(w));

  async function onDuplicate(f: FlowSummary) {
    try {
      const novo = await duplicate.mutateAsync(f.id);
      toast.ok(`"${novo.name}" criado, desativado — ative quando terminar de ajustar.`);
    } catch (err) { toast.err(err); }
  }

  async function onExport(f: FlowSummary) {
    try {
      const { portable, warnings } = await exportFlow.mutateAsync(f.id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${f.name.replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'fluxo'}.fluxo.json`;
      a.click();
      URL.revokeObjectURL(url);
      warn(warnings);
    } catch (err) { toast.err(err); }
  }

  async function onImport(file: File) {
    try {
      const { flow, warnings } = await importFlow.mutateAsync(JSON.parse(await file.text()));
      toast.ok(`"${flow.name}" importado, desativado — confira antes de ativar.`);
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
          {flows.data.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3">
              <span className={cn('w-8 h-8 rounded-lg grid place-items-center shrink-0', f.isActive ? 'bg-accent-soft text-accent-ink' : 'bg-field text-faint')}><Zap size={15} /></span>
              <div className="min-w-0 flex-1">
                <Link href={`/fluxos/${f.id}`} className="font-medium text-ink hover:text-accent-ink">{f.name}</Link>
                <div className="text-xs text-muted truncate">{TRIGGER_LABEL[f.trigger.type]}{f.trigger.type === 'keyword' && f.trigger.keywords?.length ? ` · ${f.trigger.keywords.join(', ')}` : ''}{f.description ? ` · ${f.description}` : ''}</div>
              </div>
              <span className="text-xs text-faint tnum hidden sm:inline">{f._count.runs} execuções</span>
              <span className={cn('text-[10.5px] font-semibold rounded-full px-2 py-0.5', f.isActive ? 'bg-ok-soft text-ok' : 'bg-field text-muted')}>{f.isActive ? 'Ativo' : 'Inativo'}</span>
              {isAdmin && (
                <>
                  {/* o ícone mostra a AÇÃO do clique, não o estado — é o que a dica diz */}
                  <button
                    title={f.showInChat ? 'Remover o atalho da aba Fluxos do chat' : 'Mostrar como atalho na aba Fluxos do chat'}
                    onClick={() => update.mutateAsync({ id: f.id, showInChat: !f.showInChat }).then(() => toast.ok(f.showInChat ? 'Atalho removido do chat' : 'Atalho adicionado ao chat')).catch(toast.err)}
                    className="text-faint hover:text-accent-ink p-1"
                  >
                    {f.showInChat ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>
                  <button title="Duplicar neste cliente" onClick={() => onDuplicate(f)} className="text-faint hover:text-accent-ink p-1"><Copy size={15} /></button>
                  <button title="Exportar para usar em outro cliente" onClick={() => onExport(f)} className="text-faint hover:text-accent-ink p-1"><Download size={15} /></button>
                  <button title="Excluir" onClick={() => setDeleting(f)} className="text-faint hover:text-danger p-1"><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir fluxo" danger confirmLabel="Excluir" text={`"${deleting?.name}" e seu histórico de execuções serão removidos.`} onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Fluxo excluído'); } catch (err) { toast.err(err); throw err; } }} />
    </PageShell>
  );
}
