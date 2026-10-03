'use client';
import { ConversationList } from '@/components/chat/ConversationList';
import { ChatPane } from '@/components/chat/ChatPane';
import { QuickRepliesPanel } from '@/components/chat/QuickRepliesPanel';
import { PanelRightOpen } from 'lucide-react';
import { useUI } from '@/lib/store';
import { cn } from '@/lib/utils';

/**
 * Layout: [lista de conversas] [chat] [respostas rápidas]
 * No mobile mostra uma coluna por vez (lista OU chat).
 */
export default function ConversasPage() {
  const { conversationId, rightPanelOpen, toggleRightPanel } = useUI();
  return (
    <>
      <section className={cn('w-full md:w-[320px] lg:w-[350px] shrink-0 border-r border-line bg-panel flex flex-col', conversationId && 'hidden md:flex')}>
        <ConversationList />
      </section>
      <section className={cn('flex-1 min-w-0 flex flex-col', !conversationId && 'hidden md:flex')}>
        <ChatPane />
      </section>
      {rightPanelOpen ? (
        <aside className="hidden xl:flex w-72 shrink-0 border-l border-line bg-panel flex-col">
          <QuickRepliesPanel />
        </aside>
      ) : (
        /**
         * Faixa de reabrir, do mesmo jeito que o menu recolhido da esquerda mantém o botão.
         *
         * Sem ela existe um beco: o outro botão de reabrir vive no cabeçalho do chat, que só
         * aparece com uma conversa aberta — fechar o painel na tela de "selecione uma conversa"
         * deixava a pessoa sem nenhuma forma de trazê-lo de volta.
         */
        <aside className="hidden xl:flex w-9 shrink-0 border-l border-line bg-panel flex-col items-center pt-3">
          <button onClick={toggleRightPanel} className="p-1 rounded-md text-faint hover:text-ink hover:bg-field" title="Abrir respostas rápidas">
            <PanelRightOpen size={17} />
          </button>
        </aside>
      )}
    </>
  );
}
