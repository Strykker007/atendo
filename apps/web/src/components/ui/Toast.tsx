'use client';
import { create } from 'zustand';
import { CheckCircle2, AlertCircle, MessagesSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Toast { id: number; kind: 'success' | 'error' | 'warn' | 'message'; text: string; title?: string; onOpen?: () => void }
interface ToastState { items: Toast[]; push: (kind: Toast['kind'], text: string, extra?: Pick<Toast, 'title' | 'onOpen'>) => void; remove: (id: number) => void }

let seq = 0;
export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (kind, text, extra) => {
    const id = ++seq;
    // mensagem da equipe do mesmo chat: substitui o cartão anterior em vez de empilhar
    set((s) => ({ items: [...s.items.filter((t) => !(kind === 'message' && t.kind === 'message' && t.title === extra?.title)), { id, kind, text, ...extra }] }));
    // aviso costuma ser uma frase inteira explicando o que não deu: precisa de tempo para ler
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === 'message' ? 12000 : kind === 'warn' ? 8000 : 4000);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** Atalhos: toast.ok('Salvo'), toast.err(e), toast.warn('feito, mas…') */
export const toast = {
  ok: (text: string) => useToasts.getState().push('success', text),
  err: (e: unknown) => useToasts.getState().push('error', e instanceof Error ? e.message : String(e)),
  /** deu certo em parte (ex.: apagada só no painel) — não é erro, mas a pessoa precisa saber */
  warn: (text: string) => useToasts.getState().push('warn', text),
  /** mensagem da equipe (chat interno): quem/onde + prévia; clicar abre a conversa */
  message: (title: string, text: string, onOpen: () => void) => useToasts.getState().push('message', text, { title, onOpen }),
};

export function Toaster() {
  const { items, remove } = useToasts();
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2 w-80 max-w-[calc(100vw-2rem)]">
      {items.map((t) => t.kind === 'message' ? (
        <div key={t.id} role="alert" className="flex items-start gap-2 rounded-xl border-2 border-accent bg-panel px-3 py-2.5 text-sm shadow-xl">
          <MessagesSquare size={18} className="mt-0.5 shrink-0 text-accent" />
          <button type="button" onClick={() => { t.onOpen?.(); remove(t.id); }} className="min-w-0 flex-1 text-left">
            <span className="block font-semibold text-ink truncate">{t.title}</span>
            <span className="block text-muted line-clamp-2 break-words">{t.text}</span>
            <span className="mt-1 block text-[12px] font-medium text-accent-ink">Abrir conversa</span>
          </button>
          <button onClick={() => remove(t.id)} className="text-faint hover:text-ink" aria-label="Fechar aviso"><X size={14} /></button>
        </div>
      ) : (
        <div key={t.id} className={cn('flex items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg text-white', t.kind === 'success' ? 'bg-gray-900' : t.kind === 'warn' ? 'bg-amber-700' : 'bg-danger')}>
          {t.kind === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => remove(t.id)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
