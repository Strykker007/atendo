'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConversationStatus, ConversationOrigin } from '@atendo/shared';

interface UIState {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  /** empresa/unidade ativa no seletor do menu; null = todas as que a pessoa opera (docs/empresas.md) */
  companyId: string | null;
  /** lista de conversas agrupada por atendente (ícone de duas pessoas) */
  groupByAssignee: boolean;
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
  /** filtro "último encerramento" das conversas (todas as abas): resultado e/ou motivo */
  closeFilter: { outcome: 'won' | 'lost' | null; reasonId: string | null };
  /** som de mensagem nova desligado neste navegador (preferência de quem atende) */
  soundMuted: boolean;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  /** troca de unidade: o número e a conversa abertos eram da outra, então saem junto */
  setCompany: (id: string | null) => void;
  toggleGroupByAssignee: () => void;
  setNumber: (id: string | null) => void;
  setDepartment: (id: string | null) => void;
  /** keep = true mantém a conversa selecionada (usado ao responder) */
  setStatus: (s: ConversationStatus, keep?: boolean) => void;
  setTags: (ids: string[]) => void;
  setOrigin: (o: ConversationOrigin | null) => void;
  setAssignee: (id: string | null) => void;
  setConversation: (id: string | null) => void;
  setSoundMuted: (muted: boolean) => void;
  /** foto protegida marcada no anexo (docs/foto-protegida.md): lembra a última escolha do atendente */
  securePhotos: boolean;
  setSecurePhotos: (on: boolean) => void;
  setCloseFilter: (f: { outcome: 'won' | 'lost' | null; reasonId: string | null }) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      rightPanelOpen: true,
      companyId: null,
      // fila agrupada por atendente é o padrão (docs/empresas.md#fila-agrupada-por-atendente)
      groupByAssignee: true,
      numberId: null,
      departmentId: null,
      status: 'waiting',
      tagIds: [],
      origin: null,
      assigneeId: null,
      conversationId: null,
      soundMuted: false,
      securePhotos: false,
      closeFilter: { outcome: null, reasonId: null },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setCompany: (companyId) => set({ companyId, numberId: null, conversationId: null }),
      toggleGroupByAssignee: () => set((s) => ({ groupByAssignee: !s.groupByAssignee })),
      setNumber: (numberId) => set({ numberId, conversationId: null }),
      setDepartment: (departmentId) => set({ departmentId }),
      setStatus: (status, keep) => set((s) => ({ status, conversationId: keep ? s.conversationId : null })),
      setTags: (tagIds) => set({ tagIds }),
      setOrigin: (origin) => set({ origin }),
      setAssignee: (assigneeId) => set({ assigneeId }),
      setConversation: (conversationId) => set({ conversationId }),
      setSoundMuted: (soundMuted) => set({ soundMuted }),
      setSecurePhotos: (securePhotos) => set({ securePhotos }),
      setCloseFilter: (closeFilter) => set({ closeFilter }),
    }),
    // `status` não é lembrado: a tela de conversas abre sempre em 'Aguardando' (a fila nova)
    {
      name: 'atendo-ui',
      // v1: agrupar por atendente passou a vir marcado — quem tinha o padrão antigo (desmarcado e
      // nunca mexeu) ganha o novo uma vez; daqui para a frente vale a escolha da pessoa
      version: 1,
      migrate: (persisted, version) => (version < 1 ? { ...(persisted as object), groupByAssignee: true } : persisted) as UIState,
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, rightPanelOpen: s.rightPanelOpen, companyId: s.companyId, groupByAssignee: s.groupByAssignee, numberId: s.numberId, departmentId: s.departmentId, conversationId: s.conversationId, soundMuted: s.soundMuted, securePhotos: s.securePhotos }) },
  ),
);
