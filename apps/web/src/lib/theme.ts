'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

/** Tema: claro (Semáforo), escuro (Sala de controle) ou seguir o sistema. */
export const useTheme = create<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>()(
  persist((set) => ({ mode: 'light', setMode: (mode) => set({ mode }) }), { name: 'atendo-theme' }),
);

export function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
