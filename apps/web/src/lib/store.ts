'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConversationStatus, ConversationOrigin } from '@atendo/shared';

/** Abas da lista de conversas: os três status do atendimento + "Livres" (contatos isentos de ticket). */
export type ConversationTab = ConversationStatus | 'free';

interface UIState {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  /** empresa/unidade ativa no seletor do menu; null = todas as que a pessoa opera (docs/empresas.md) */
  companyId: string | null;
  /** lista de conversas agrupada por atendente (ícone de duas pessoas) */
  groupByAssignee: boolean;
  /** números marcados no filtro das conversas; vazio = todos (docs/18-perfis-de-acesso.md#número-padrão) */
  numberIds: string[];
  /**
   * De quem é o filtro de números guardado neste navegador. Outra pessoa entrando (computador da
   * portaria) ou login novo (`''`) faz a tela aplicar o padrão da pessoa (`useDefaultNumbers`).
   * null = ainda não conferido (quem vem da versão anterior mantém o que tinha)
   */
  numbersFor: string | null;
  /** login novo: o filtro de números volta ao padrão de quem entrou */
  resetNumbersOnLogin: () => void;
  /** filtro de departamento: id, 'none' (sem departamento) ou null = todos */
  departmentId: string | null;
  status: ConversationTab;
  tagIds: string[];
  /** filtro de origem do lead; null = todas */
  origin: ConversationOrigin | null;
  /** admin: ver conversas de um atendente específico ('me' = as minhas); null = todas */
  assigneeId: string | null;
  conversationId: string | null;
  /** abrir a conversa já rolada até esta mensagem (ex.: "Ver na conversa" do ticket). Não persiste */
  jumpTo: { conversationId: string; messageId: string } | null;
  /** filtro "último encerramento" das conversas (todas as abas): resultado e/ou motivo */
  closeFilter: { outcome: 'won' | 'lost' | null; reasonId: string | null };
  /** filtro "Gera ticket": só contatos que abrem atendimento. "Não gera" é o modo `status: 'free'` */
  onlyTickets: boolean;
  setOnlyTickets: (on: boolean) => void;
  /** som de mensagem nova desligado neste navegador (preferência de quem atende) */
  soundMuted: boolean;
  toggleSidebar: () => void;
  /** grupos do menu lateral fechados pela pessoa (o do item aberto fica sempre aberto) */
  closedNavGroups: string[];
  toggleNavGroup: (id: string) => void;
  toggleRightPanel: () => void;
  /** troca de unidade: o número e a conversa abertos eram da outra, então saem junto */
  setCompany: (id: string | null) => void;
  toggleGroupByAssignee: () => void;
  /** troca os números do filtro; `owner` grava de quem é (aplicação do padrão) */
  setNumbers: (ids: string[], owner?: string) => void;
  setDepartment: (id: string | null) => void;
  /** keep = true mantém a conversa selecionada (usado ao responder) */
  setStatus: (s: ConversationTab, keep?: boolean) => void;
  setTags: (ids: string[]) => void;
  setOrigin: (o: ConversationOrigin | null) => void;
  setAssignee: (id: string | null) => void;
  setConversation: (id: string | null) => void;
  /** abre a conversa e marca a mensagem para o painel rolar até ela */
  openAtMessage: (conversationId: string, messageId: string | null) => void;
  clearJump: () => void;
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
      numberIds: [],
      numbersFor: null,
      departmentId: null,
      status: 'waiting',
      tagIds: [],
      origin: null,
      assigneeId: null,
      conversationId: null,
      jumpTo: null,
      soundMuted: false,
      securePhotos: false,
      closeFilter: { outcome: null, reasonId: null },
      onlyTickets: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      closedNavGroups: [],
      toggleNavGroup: (id) => set((s) => ({ closedNavGroups: s.closedNavGroups.includes(id) ? s.closedNavGroups.filter((g) => g !== id) : [...s.closedNavGroups, id] })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setCompany: (companyId) => set({ companyId, numberIds: [], conversationId: null }),
      toggleGroupByAssignee: () => set((s) => ({ groupByAssignee: !s.groupByAssignee })),
      setNumbers: (numberIds, owner) => set((s) => {
        const igual = numberIds.length === s.numberIds.length && numberIds.every((id) => s.numberIds.includes(id));
        // a conversa aberta só fecha quando o filtro muda de fato (aplicar o mesmo padrão não fecha nada)
        return { numberIds, numbersFor: owner ?? s.numbersFor, ...(igual ? {} : { conversationId: null }) };
      }),
      resetNumbersOnLogin: () => set({ numbersFor: '' }),
      setDepartment: (departmentId) => set({ departmentId }),
      setStatus: (status, keep) => set((s) => ({ status, conversationId: keep ? s.conversationId : null })),
      setTags: (tagIds) => set({ tagIds }),
      setOrigin: (origin) => set({ origin }),
      setAssignee: (assigneeId) => set({ assigneeId }),
      setConversation: (conversationId) => set({ conversationId }),
      openAtMessage: (conversationId, messageId) => set({ conversationId, jumpTo: messageId ? { conversationId, messageId } : null }),
      clearJump: () => set({ jumpTo: null }),
      setSoundMuted: (soundMuted) => set({ soundMuted }),
      setSecurePhotos: (securePhotos) => set({ securePhotos }),
      setCloseFilter: (closeFilter) => set({ closeFilter }),
      setOnlyTickets: (onlyTickets) => set({ onlyTickets }),
    }),
    // `status` não é lembrado: a tela de conversas abre sempre em 'Aguardando' (a fila nova)
    {
      name: 'atendo-ui',
      // v1: agrupar por atendente passou a vir marcado — quem tinha o padrão antigo (desmarcado e
      // nunca mexeu) ganha o novo uma vez; daqui para a frente vale a escolha da pessoa
      // v2: o filtro de um número só (`numberId`) virou lista (`numberIds`)
      version: 2,
      migrate: (persisted, version) => {
        let p = (persisted ?? {}) as Record<string, unknown>;
        if (version < 1) p = { ...p, groupByAssignee: true };
        if (version < 2) {
          const { numberId, ...rest } = p;
          p = { ...rest, numberIds: typeof numberId === 'string' && numberId ? [numberId] : [], numbersFor: null };
        }
        return p as unknown as UIState;
      },
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, closedNavGroups: s.closedNavGroups, rightPanelOpen: s.rightPanelOpen, companyId: s.companyId, groupByAssignee: s.groupByAssignee, numberIds: s.numberIds, numbersFor: s.numbersFor, departmentId: s.departmentId, conversationId: s.conversationId, soundMuted: s.soundMuted, securePhotos: s.securePhotos }) },
  ),
);
