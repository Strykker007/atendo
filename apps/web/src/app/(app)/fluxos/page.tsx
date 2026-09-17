'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Plus, Workflow, Trash2, Zap, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { useFlows, useDeleteFlow, useHasFeature, useMe, type FlowSummary } from '@/lib/hooks';

const TRIGGER_LABEL = { manual: 'Manual (pelo chat)', new_conversation: 'Toda conversa nova', keyword: 'Palavra-chave' };

export default function FluxosPage() {
  const me = useMe();
  const isAdmin = me.data ? me.data.role !== 'agent' : false;
  const feature = useHasFeature('flows');
  const flows = useFlows();
  const remove = useDeleteFlow();
  const [deleting, setDeleting] = useState<FlowSummary | null>(null);

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
      <PageHeader title="Fluxos de automação" subtitle="Atendimento automático que você desenha: mensagens, menus, perguntas, condições e entrega para humano." action={isAdmin && <Link href="/fluxos/novo"><Button icon={<Plus size={16} />}>Novo fluxo</Button></Link>} />
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
              {isAdmin && <button onClick={() => setDeleting(f)} className="text-faint hover:text-danger p-1"><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir fluxo" danger confirmLabel="Excluir" text={`"${deleting?.name}" e seu histórico de execuções serão removidos.`} onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Fluxo excluído'); } catch (err) { toast.err(err); throw err; } }} />
    </PageShell>
  );
}
