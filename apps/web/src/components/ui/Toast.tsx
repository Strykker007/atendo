'use client';
import { create } from 'zustand';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Toast { id: number; kind: 'success' | 'error' | 'warn'; text: string }
interface ToastState { items: Toast[]; push: (kind: Toast['kind'], text: string) => void; remove: (id: number) => void }

let seq = 0;
export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (kind, text) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, kind, text }] }));
    // aviso costuma ser uma frase inteira explicando o que não deu: precisa de tempo para ler
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === 'warn' ? 8000 : 4000);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** Atalhos: toast.ok('Salvo'), toast.err(e), toast.warn('feito, mas…') */
export const toast = {
  ok: (text: string) => useToasts.getState().push('success', text),
  err: (e: unknown) => useToasts.getState().push('error', e instanceof Error ? e.message : String(e)),
  /** deu certo em parte (ex.: apagada só no painel) — não é erro, mas a pessoa precisa saber */
  warn: (text: string) => useToasts.getState().push('warn', text),
};

export function Toaster() {
  const { items, remove } = useToasts();
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2 w-80 max-w-[calc(100vw-2rem)]">
      {items.map((t) => (
        <div key={t.id} className={cn('flex items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg text-white', t.kind === 'success' ? 'bg-gray-900' : t.kind === 'warn' ? 'bg-amber-700' : 'bg-danger')}>
          {t.kind === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => remove(t.id)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
