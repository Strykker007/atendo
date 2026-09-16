'use client';
import { ConversationList } from '@/components/chat/ConversationList';
import { ChatPane } from '@/components/chat/ChatPane';
import { QuickRepliesPanel } from '@/components/chat/QuickRepliesPanel';
import { useUI } from '@/lib/store';
import { cn } from '@/lib/utils';

/**
 * Layout: [lista de conversas] [chat] [respostas rápidas]
 * No mobile mostra uma coluna por vez (lista OU chat).
 */
export default function ConversasPage() {
  const { conversationId, rightPanelOpen } = useUI();
  return (
    <>
      <section className={cn('w-full md:w-[360px] lg:w-[400px] shrink-0 border-r border-surface-border bg-white flex flex-col', conversationId && 'hidden md:flex')}>
        <ConversationList />
      </section>
      <section className={cn('flex-1 min-w-0 flex flex-col', !conversationId && 'hidden md:flex')}>
        <ChatPane />
      </section>
      {rightPanelOpen && (
        <aside className="hidden xl:flex w-80 shrink-0 border-l border-surface-border bg-white flex-col">
          <QuickRepliesPanel />
        </aside>
      )}
    </>
  );
}
