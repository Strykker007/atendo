'use client';
import { create } from 'zustand';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, X } from 'lucide-react';
import { useUI } from '@/lib/store';
import { playTransferAlarm } from '@/lib/message-sound';

/** Atendimento transferido para quem está com o painel aberto (evento `transfer_alert`, só dele). */
export interface TransferAlertEvent { conversationId: string; contactName: string; byName: string | null }

interface State { items: (TransferAlertEvent & { at: number })[]; push: (e: TransferAlertEvent) => void; remove: (conversationId: string) => void }

export const useTransferAlerts = create<State>((set) => ({
  items: [],
  // a mesma conversa transferida de novo substitui o aviso anterior; no máximo 3 na tela
  push: (e) => set((s) => ({ items: [...s.items.filter((i) => i.conversationId !== e.conversationId), { ...e, at: Date.now() }].slice(-3) })),
  remove: (conversationId) => set((s) => ({ items: s.items.filter((i) => i.conversationId !== conversationId) })),
}));

/** Chegada pelo socket: alarme (respeita o som desligado) + aviso em destaque que só sai no clique. */
export function receiveTransferAlert(e: TransferAlertEvent) {
  useTransferAlerts.getState().push(e);
  if (!useUI.getState().soundMuted) playTransferAlarm();
}

/**
 * Aviso no topo da tela, fixo até a pessoa abrir ou dispensar — um toast some sozinho e a
 * transferência passava batida para quem estava em outra aba do painel.
 */
export function TransferAlerts() {
  const { items, remove } = useTransferAlerts();
  const setConversation = useUI((s) => s.setConversation);
  const router = useRouter();
  if (!items.length) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] space-y-2 w-[26rem] max-w-[calc(100vw-2rem)]" role="alert" aria-live="assertive">
      {items.map((t) => (
        <div key={t.conversationId} className="flex items-start gap-3 rounded-2xl border-2 border-accent bg-panel px-4 py-3 shadow-2xl ring-4 ring-accent/20 animate-pulse [animation-iteration-count:3]">
          <span className="mt-0.5 grid place-items-center w-9 h-9 rounded-full bg-accent text-white shrink-0"><ArrowRightLeft size={17} /></span>
          <div className="flex-1 min-w-0">
            <div className="font-display font-semibold text-ink">Atendimento transferido para você</div>
            <div className="text-sm text-muted truncate">
              <b className="text-ink">{t.contactName}</b>{t.byName ? ` · por ${t.byName}` : ''}
            </div>
            <button
              type="button"
              onClick={() => { setConversation(t.conversationId); remove(t.conversationId); router.push('/conversas'); }}
              className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              Abrir conversa
            </button>
          </div>
          <button type="button" onClick={() => remove(t.conversationId)} className="text-muted hover:text-ink" aria-label="Dispensar"><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}
