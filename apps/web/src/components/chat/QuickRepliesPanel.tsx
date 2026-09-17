'use client';
import { useState } from 'react';
import { Folder, FolderOpen, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useQuickReplies, useConversation, useMe } from '@/lib/hooks';
import { useUI } from '@/lib/store';
import { Settings2 } from 'lucide-react';

/** Painel direito: sessões (pastas) com mensagens pré-configuradas. Clique insere no composer. */
export function QuickRepliesPanel() {
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
      <div className="h-12 px-3.5 flex items-center justify-between border-b border-line">
        <span className="font-medium text-sm inline-flex items-center gap-2"><Zap size={16} className="text-accent" /> Respostas rápidas</span>
        <Link href="/configuracoes" className="text-faint hover:text-ink" title="Gerenciar respostas"><Settings2 size={18} /></Link>
      </div>
      <div className="p-2.5 border-b border-line">
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
