'use client';
import { useState } from 'react';
import { Folder, FolderOpen, Plus, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuickReplies } from '@/lib/hooks';

/** Painel direito: sessões (pastas) com mensagens pré-configuradas. Clique insere no composer. */
export function QuickRepliesPanel() {
  const folders = useQuickReplies();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');

  const insert = (body: string) => window.dispatchEvent(new CustomEvent('atendo:insert-text', { detail: body }));
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());

  return (
    <>
      <div className="h-14 px-4 flex items-center justify-between border-b border-surface-border">
        <span className="font-medium text-sm inline-flex items-center gap-2"><Zap size={16} className="text-brand" /> Respostas rápidas</span>
        <button className="text-gray-400 hover:text-gray-600" title="Nova pasta"><Plus size={18} /></button>
      </div>
      <div className="p-3 border-b border-surface-border">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar resposta…" className="w-full rounded-lg bg-surface-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40" />
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {folders.data?.map((f) => {
          const replies = f.replies.filter((r) => !q || match(r.title) || match(r.body));
          if (q && replies.length === 0) return null;
          const isOpen = open[f.id] ?? !!q;
          return (
            <div key={f.id}>
              <button onClick={() => setOpen((o) => ({ ...o, [f.id]: !isOpen }))} className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-surface-muted">
                {isOpen ? <FolderOpen size={16} className="text-amber-500" /> : <Folder size={16} className="text-amber-500" />}
                <span className="flex-1 text-left truncate">{f.name}</span>
                <span className="text-xs text-gray-400">{f.replies.length}</span>
              </button>
              {isOpen &&
                replies.map((r) => (
                  <button key={r.id} onClick={() => insert(r.body)} className={cn('w-full text-left pl-10 pr-4 py-2 hover:bg-brand-soft/60 border-l-2 border-transparent hover:border-brand')}>
                    <div className="text-sm font-medium truncate">{r.title}</div>
                    <div className="text-xs text-gray-500 line-clamp-2">{r.body}</div>
                  </button>
                ))}
            </div>
          );
        })}
        {folders.data?.length === 0 && <p className="p-6 text-sm text-gray-400 text-center">Crie uma pasta para organizar suas respostas.</p>}
      </div>
    </>
  );
}
