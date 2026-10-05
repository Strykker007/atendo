'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConversationStatus, ConversationOrigin } from '@atendo/shared';

interface UIState {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  /** número (perfil) selecionado; null = todos */
  numberId: string | null;
  /** filtro de departamento: id, 'none' (sem departamento) ou null = todos */
  departmentId: string | null;
  status: ConversationStatus;
  tagIds: string[];
  /** filtro de origem do lead; null = todas */
  origin: ConversationOrigin | null;
  /** admin: ver conversas de um atendente específico ('me' = as minhas); null = todas */
  assigneeId: string | null;
  conversationId: string | null;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setNumber: (id: string | null) => void;
  setDepartment: (id: string | null) => void;
  /** keep = true mantém a conversa selecionada (usado ao responder) */
  setStatus: (s: ConversationStatus, keep?: boolean) => void;
  setTags: (ids: string[]) => void;
  setOrigin: (o: ConversationOrigin | null) => void;
  setAssignee: (id: string | null) => void;
  setConversation: (id: string | null) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      rightPanelOpen: true,
      numberId: null,
      departmentId: null,
      status: 'waiting',
      tagIds: [],
      origin: null,
      assigneeId: null,
      conversationId: null,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setNumber: (numberId) => set({ numberId, conversationId: null }),
      setDepartment: (departmentId) => set({ departmentId }),
      setStatus: (status, keep) => set((s) => ({ status, conversationId: keep ? s.conversationId : null })),
      setTags: (tagIds) => set({ tagIds }),
      setOrigin: (origin) => set({ origin }),
      setAssignee: (assigneeId) => set({ assigneeId }),
      setConversation: (conversationId) => set({ conversationId }),
    }),
    { name: 'atendo-ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, rightPanelOpen: s.rightPanelOpen, numberId: s.numberId, departmentId: s.departmentId, conversationId: s.conversationId, status: s.status }) },
  ),
);
