'use client';
import { create } from 'zustand';

/**
 * Tela de feedbacks pendentes (docs/feedback-de-atendimento.md#garantia-de-leitura): abre ao entrar
 * com pendências e quando a API recusa assumir atendimento (`reviews_pending`).
 */
export const useReviewGate = create<{ open: boolean; forced: boolean; show: (forced?: boolean) => void; hide: () => void }>((set) => ({
  open: false,
  forced: false,
  show: (forced = false) => set({ open: true, forced }),
  hide: () => set({ open: false, forced: false }),
}));
