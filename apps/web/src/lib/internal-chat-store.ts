'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Estado do widget, por navegador: aberto/minimizado, canto onde está preso e conversa aberta.
 * Fica fora do `useUI` para não misturar com a tela de conversas.
 */
interface WidgetState {
  open: boolean;
  minimized: boolean;
  /** lateral em que o widget fica preso (trava magnética) */
  side: 'left' | 'right';
  /** altura do ponto de ancoragem (centro do botão redondo), em px; null = embaixo */
  y: number | null;
  chatId: string | null;
  set: (p: Partial<Omit<WidgetState, 'set'>>) => void;
}
export const useWidget = create<WidgetState>()(persist(
  (set) => ({ open: false, minimized: false, side: 'right', y: null, chatId: null, set: (p) => set(p) }),
  {
    name: 'atendo-chat-interno',
    // v1: a posição livre (`pos`) virou lado + altura — a antiga é descartada
    version: 1,
    migrate: (s) => ({ ...(s as object), side: 'right', y: null }) as unknown as WidgetState,
    partialize: (s) => ({ open: s.open, minimized: s.minimized, side: s.side, y: s.y, chatId: s.chatId }),
  },
));


/** Abre o widget direto numa conversa (clique no aviso de mensagem interna). */
export const openInternalChat = (chatId: string) => useWidget.getState().set({ open: true, minimized: false, chatId });
