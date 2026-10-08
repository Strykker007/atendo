'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const VELOCIDADES = [1, 1.5, 2] as const;
export type Velocidade = (typeof VELOCIDADES)[number];

/**
 * Velocidade dos áudios do chat, uma só para todos — como no WhatsApp.
 *
 * Global e persistida: quem ouve em 1.5x quer que o próximo áudio (de outra conversa, ou o que
 * acabou de chegar) já toque em 1.5x, sem ajustar de novo. Por navegador, não por pessoa.
 */
export const useAudioSpeed = create<{ velocidade: Velocidade; proxima: () => void }>()(
  persist(
    (set, get) => ({
      velocidade: 1,
      proxima: () => {
        const i = VELOCIDADES.indexOf(get().velocidade);
        set({ velocidade: VELOCIDADES[(i + 1) % VELOCIDADES.length] });
      },
    }),
    {
      name: 'vogochat_audio_speed',
      // valor salvo à mão ou de versão antiga não pode virar uma velocidade fora da lista
      merge: (salvo, atual) => {
        const v = (salvo as { velocidade?: number } | undefined)?.velocidade;
        return { ...atual, velocidade: VELOCIDADES.includes(v as Velocidade) ? (v as Velocidade) : 1 };
      },
    },
  ),
);
