'use client';
import { useEffect } from 'react';
import { PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { ChatPane } from '@/components/chat/ChatPane';
import { QuickRepliesPanel } from '@/components/chat/QuickRepliesPanel';
import { usePersistedState } from '@/lib/persisted';
import { cn } from '@/lib/utils';

/**
 * Mini-chat do Kanban: o mesmo `ChatPane` da tela de conversas, em modo embutido. Envio,
 * cota do plano, janela de 24h, posse e socket são os mesmos — nada é reimplementado aqui.
 *
 * Ao lado, o mesmo painel de respostas rápidas e fluxos da tela de conversas (telas largas),
 * preso a esta conversa. Recolher fica guardado à parte do painel da tela de conversas.
 */
export function KanbanChatDialog({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [painel, setPainel] = usePersistedState('kanban-painel', true);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] grid place-items-center p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('w-full h-[90vh] bg-panel rounded-2xl shadow-xl flex flex-col overflow-hidden', painel ? 'max-w-3xl lg:max-w-6xl' : 'max-w-3xl')}>
        <div className="flex items-center justify-between gap-1 px-3 py-1.5 border-b border-line text-xs text-faint">
          <span className="flex-1">Conversa · Esc para fechar</span>
          <button onClick={() => setPainel(!painel)} className="hidden lg:block p-1 rounded-md hover:text-ink hover:bg-field" title={painel ? 'Recolher respostas rápidas' : 'Abrir respostas rápidas e fluxos'}>
            {painel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <button onClick={onClose} className="p-1 rounded-md hover:text-ink hover:bg-field" title="Fechar (Esc)"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <ChatPane conversationId={conversationId} />
          </div>
          {painel && (
            <aside className="hidden lg:flex w-72 shrink-0 min-h-0 overflow-hidden border-l border-line bg-panel flex-col">
              <QuickRepliesPanel conversationId={conversationId} onClose={() => setPainel(false)} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
