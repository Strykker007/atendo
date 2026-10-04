'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { ChatPane } from '@/components/chat/ChatPane';

/**
 * Mini-chat do Kanban: o mesmo `ChatPane` da tela de conversas, em modo embutido. Envio,
 * cota do plano, janela de 24h, posse e socket são os mesmos — nada é reimplementado aqui.
 */
export function KanbanChatDialog({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] grid place-items-center p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-3xl h-[90vh] bg-panel rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-line text-xs text-faint">
          <span>Conversa · Esc para fechar</span>
          <button onClick={onClose} className="p-1 rounded-md hover:text-ink hover:bg-field" title="Fechar (Esc)"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <ChatPane conversationId={conversationId} />
        </div>
      </div>
    </div>
  );
}
