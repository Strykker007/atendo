'use client';
import { useState } from 'react';
import { Folder, FolderOpen, Zap, Workflow, Play, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useFlows, useStartFlow, useHasFeature, useActiveRun } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useQuickReplies, useConversation, useMe } from '@/lib/hooks';
import { useUI } from '@/lib/store';
import { Settings2 } from 'lucide-react';

/** Painel direito: sessões (pastas) com mensagens pré-configuradas. Clique insere no composer. */
export function QuickRepliesPanel() {
  const [tab, setTab] = useState<'replies' | 'flows'>('replies');
  return (
    <>
      <div className="h-12 px-2 flex items-center border-b border-line">
        <div className="grid grid-cols-2 w-full rounded-lg bg-field p-0.5 text-[12px] font-semibold">
          <button onClick={() => setTab('replies')} className={cn('rounded-md py-1 flex items-center justify-center gap-1.5', tab === 'replies' ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}><Zap size={13} /> Mensagens</button>
          <button onClick={() => setTab('flows')} className={cn('rounded-md py-1 flex items-center justify-center gap-1.5', tab === 'flows' ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}><Workflow size={13} /> Fluxos</button>
        </div>
      </div>
      {tab === 'replies' ? <RepliesTab /> : <FlowsTab />}
    </>
  );
}

/** Aba Fluxos: dispara um fluxo na conversa aberta. Plugável no plano. */
function FlowsTab() {
  const { conversationId } = useUI();
  const feature = useHasFeature('flows');
  const flows = useFlows();
  const start = useStartFlow();
  const active = useActiveRun(conversationId);
  const list = flows.data?.filter((f) => f.isActive) ?? [];
  if (!feature.loading && !feature.has) {
    return (
      <div className="p-5 text-center space-y-2">
        <div className="mx-auto w-10 h-10 rounded-xl bg-accent-soft text-accent-ink grid place-items-center"><Lock size={18} /></div>
        <p className="text-sm font-semibold text-ink">Fluxos de automação</p>
        <p className="text-xs text-muted">Disponível nos planos Pro e Business.</p>
        <Link href="/plano" className="text-xs text-accent-ink underline">Ver planos</Link>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {!conversationId && <p className="p-5 text-xs text-muted text-center">Abra uma conversa para disparar um fluxo nela.</p>}
      {active.data && <div className="m-2.5 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-ink">🤖 <b>{active.data.flow.name}</b> está rodando nesta conversa. Disparar outro substitui este.</div>}
      {list.length === 0 && flows.data && <p className="p-5 text-xs text-muted text-center">Nenhum fluxo ativo. <Link href="/fluxos" className="text-accent-ink underline">Criar</Link></p>}
      <ul className="divide-y divide-line">
        {list.map((f) => (
          <li key={f.id} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink truncate">{f.name}</div>
              {f.description && <div className="text-[11px] text-muted truncate">{f.description}</div>}
            </div>
            <Button size="sm" icon={<Play size={12} />} disabled={!conversationId} loading={start.isPending && start.variables?.flowId === f.id} onClick={() => conversationId && start.mutateAsync({ flowId: f.id, conversationId }).then(() => toast.ok(`Fluxo "${f.name}" iniciado`)).catch(toast.err)}>Iniciar</Button>
          </li>
        ))}
      </ul>
      <p className="px-3 py-3 text-[10.5px] text-faint">Enquanto o fluxo roda, o robô responde. Você pode parar a qualquer momento no cabeçalho da conversa. <Link href="/fluxos" className="underline">Gerenciar fluxos</Link></p>
    </div>
  );
}

function RepliesTab() {
  const folders = useQuickReplies();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');

  const me = useMe();
  const { conversationId } = useUI();
  const conv = useConversation(conversationId).data;

  /** Substitui {{contact.name}} / {{agent.name}} antes de mandar para o composer. */
  const insert = (body: string) => {
    const contactName = conv?.contact.name ?? conv?.contact.phone ?? '';
    const agentName = me.data?.name ?? '';
    const text = body.replace(/\{\{\s*contact\.name\s*\}\}/g, contactName).replace(/\{\{\s*agent\.name\s*\}\}/g, agentName);
    window.dispatchEvent(new CustomEvent('atendo:insert-text', { detail: text }));
  };
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());

  return (
    <>
      <div className="p-2.5 border-b border-line flex items-center gap-2">
        <Link href="/configuracoes" className="text-faint hover:text-ink shrink-0" title="Gerenciar respostas"><Settings2 size={16} /></Link>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar resposta…" className="w-full rounded-lg bg-field px-3 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/40" />
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {folders.data?.map((f) => {
          const replies = f.replies.filter((r) => !q || match(r.title) || match(r.body));
          if (q && replies.length === 0) return null;
          const isOpen = open[f.id] ?? !!q;
          return (
            <div key={f.id}>
              <button onClick={() => setOpen((o) => ({ ...o, [f.id]: !isOpen }))} className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink hover:bg-field">
                {isOpen ? <FolderOpen size={16} className="text-warn" /> : <Folder size={16} className="text-warn" />}
                <span className="flex-1 text-left truncate">{f.name}</span>
                <span className="text-xs text-faint">{f.replies.length}</span>
              </button>
              {isOpen &&
                replies.map((r) => (
                  <button key={r.id} onClick={() => insert(r.body)} className={cn('w-full text-left pl-10 pr-4 py-2 hover:bg-accent-soft border-l-2 border-transparent hover:border-accent')}>
                    <div className="text-sm font-medium truncate">{r.title}</div>
                    <div className="text-xs text-muted line-clamp-2">{r.body}</div>
                  </button>
                ))}
            </div>
          );
        })}
        {folders.data?.length === 0 && <p className="p-6 text-sm text-faint text-center">Nenhuma resposta ainda. <Link href="/configuracoes" className="text-accent underline">Criar</Link></p>}
      </div>
    </>
  );
}
