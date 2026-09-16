'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConversationStatus } from '@atendo/shared';

interface UIState {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  /** número (perfil) selecionado; null = todos */
  numberId: string | null;
  status: ConversationStatus;
  tagIds: string[];
  conversationId: string | null;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setNumber: (id: string | null) => void;
  setStatus: (s: ConversationStatus) => void;
  setTags: (ids: string[]) => void;
  setConversation: (id: string | null) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      rightPanelOpen: true,
      numberId: null,
      status: 'waiting',
      tagIds: [],
      conversationId: null,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setNumber: (numberId) => set({ numberId, conversationId: null }),
      setStatus: (status) => set({ status, conversationId: null }),
      setTags: (tagIds) => set({ tagIds }),
      setConversation: (conversationId) => set({ conversationId }),
    }),
    { name: 'atendo-ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, rightPanelOpen: s.rightPanelOpen, numberId: s.numberId }) },
  ),
);
