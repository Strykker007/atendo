'use client';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, ClipboardCheck, Lock, MessagesSquare, X } from 'lucide-react';
import { REVIEW_KIND_LABEL, type ReviewAlertEvent } from '@atendo/shared';
import { useUI } from '@/lib/store';
import { playInternalSound, playTransferAlarm } from '@/lib/message-sound';
import { openInternalChat, useWidget } from '@/lib/internal-chat-store';
import { askNotification, canAskNotification } from '@/lib/internal-alert';

/** Atendimento transferido para quem está com o painel aberto (evento `transfer_alert`, só dele). */
export interface TransferAlertEvent { conversationId: string; contactName: string; byName: string | null }
/** Nota interna para esta pessoa: atendente da conversa ou citada com @ (evento `note_alert`). */
export interface NoteAlertEvent { conversationId: string; contactName: string; byName: string; text: string }

/**
 * Avisos da equipe que precisam ser vistos: transferência, nota interna e mensagem do chat
 * interno. Ficam fixos no topo até a pessoa abrir ou dispensar — toast some sozinho e passava
 * batido para quem estava em outra tela (docs/chat-interno.md#avisos).
 */
type Alert =
  | ({ kind: 'transfer' } & TransferAlertEvent)
  | ({ kind: 'note' } & NoteAlertEvent)
  | { kind: 'internal'; chatId: string; title: string; text: string }
  // o evento tem o próprio `kind` (tipo do feedback): vai inteiro em `ev` para não colidir
  | { kind: 'review'; ev: ReviewAlertEvent };
type Item = Alert & { key: string; at: number };

const keyOf = (a: Alert) => (a.kind === 'internal' ? `internal:${a.chatId}` : a.kind === 'review' ? `review:${a.ev.reviewId}` : `${a.kind}:${a.conversationId}`);

interface State { items: Item[]; push: (a: Alert) => void; remove: (key: string) => void }

export const useTeamAlerts = create<State>((set) => ({
  items: [],
  // o mesmo assunto de novo substitui o aviso anterior; no máximo 3 na tela
  push: (a) => set((s) => {
    const key = keyOf(a);
    return { items: [...s.items.filter((i) => i.key !== key), { ...a, key, at: Date.now() }].slice(-3) };
  }),
  remove: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
}));

/** Chegada pelo socket: alarme (respeita o som desligado) + aviso em destaque que só sai no clique. */
export function receiveTransferAlert(e: TransferAlertEvent) {
  useTeamAlerts.getState().push({ kind: 'transfer', ...e });
  if (!useUI.getState().soundMuted) playTransferAlarm();
  desktopNotify('Atendimento transferido para você', `${e.contactName}${e.byName ? ` · por ${e.byName}` : ''}`, `transfer-${e.conversationId}`);
}

export function receiveNoteAlert(e: NoteAlertEvent) {
  useTeamAlerts.getState().push({ kind: 'note', ...e });
  if (!useUI.getState().soundMuted) playInternalSound();
  desktopNotify(`Nota interna de ${e.byName} · ${e.contactName}`, e.text, `note-${e.conversationId}`);
}

/**
 * Feedback de atendimento (docs/feedback-de-atendimento.md): novo (para o atendente), ciência,
 * resposta ou prazo vencido (para quem apontou). Ciência só atualiza a lista, sem cartão.
 */
export function receiveReviewAlert(e: ReviewAlertEvent) {
  if (e.type === 'acknowledged') return;
  useTeamAlerts.getState().push({ kind: 'review', ev: e });
  if (!useUI.getState().soundMuted) playInternalSound();
  desktopNotify(REVIEW_TITLE[e.type](e), e.text, `review-${e.reviewId}`);
}
const REVIEW_TITLE: Record<ReviewAlertEvent['type'], (e: ReviewAlertEvent) => string> = {
  new: (e) => `${REVIEW_KIND_LABEL[e.kind]} de ${e.byName}`,
  overdue: (e) => `${e.byName} ainda não deu ciência do feedback`,
  acknowledged: (e) => `${e.byName} deu ciência`,
  replied: (e) => `${e.byName} respondeu ao feedback`,
};

export function pushInternalAlert(chatId: string, title: string, text: string) {
  useTeamAlerts.getState().push({ kind: 'internal', chatId, title, text });
  desktopNotify(`Equipe: ${title}`, text, `internal-${chatId}`, () => openInternalChat(chatId));
}

/**
 * Notificação do Windows/macOS sempre que a janela do painel não está em foco — não só com a aba
 * escondida: com o painel atrás de outro programa a aba continua "visível" e ninguém via nada.
 */
function desktopNotify(title: string, body: string, tag: string, onClick?: () => void) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    // `tag` por assunto: várias mensagens seguidas trocam a notificação em vez de empilhar
    const n = new Notification(title, { body, tag, requireInteraction: true });
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
  } catch {
    /* navegador sem suporte (ex.: Android exige service worker) */
  }
}

const VISUAL = {
  transfer: { icon: <ArrowRightLeft size={17} />, cls: 'border-accent ring-accent/20', dot: 'bg-accent' },
  note: { icon: <Lock size={16} />, cls: 'border-warn ring-warn/20', dot: 'bg-warn' },
  internal: { icon: <MessagesSquare size={17} />, cls: 'border-accent ring-accent/20', dot: 'bg-accent' },
  review: { icon: <ClipboardCheck size={17} />, cls: 'border-danger ring-danger/20', dot: 'bg-danger' },
} as const;

export function TransferAlerts() {
  const { items, remove } = useTeamAlerts();
  const setConversation = useUI((s) => s.setConversation);
  const router = useRouter();
  // abriu a conversa do chat interno por outro caminho (widget): o aviso dela já cumpriu o papel
  const lendo = useWidget((w) => (w.open && !w.minimized ? w.chatId : null));
  useEffect(() => { if (lendo) remove(`internal:${lendo}`); }, [lendo, remove]);
  // sem permissão, o aviso só existe dentro do painel: oferece ativar a notificação do computador
  const [podePedir, setPodePedir] = useState(false);
  useEffect(() => { setPodePedir(canAskNotification()); }, [items.length]);
  if (!items.length) return null;

  const abrir = (t: Item) => {
    remove(t.key);
    if (t.kind === 'internal') return openInternalChat(t.chatId);
    if (t.kind === 'review') return router.push(`/feedbacks?abrir=${t.ev.reviewId}${t.ev.type === 'new' ? '' : '&aba=enviados'}`);
    setConversation(t.conversationId);
    router.push('/conversas');
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] space-y-2 w-[26rem] max-w-[calc(100vw-2rem)]" role="alert" aria-live="assertive">
      {items.map((t) => {
        const v = VISUAL[t.kind];
        return (
          <div key={t.key} className={`flex items-start gap-3 rounded-2xl border-2 bg-panel px-4 py-3 shadow-2xl ring-4 animate-pulse [animation-iteration-count:3] ${v.cls}`}>
            <span className={`mt-0.5 grid place-items-center w-9 h-9 rounded-full text-white shrink-0 ${v.dot}`}>{v.icon}</span>
            <div className="flex-1 min-w-0">
              {t.kind === 'transfer' && (
                <>
                  <div className="font-display font-semibold text-ink">Atendimento transferido para você</div>
                  <div className="text-sm text-muted truncate"><b className="text-ink">{t.contactName}</b>{t.byName ? ` · por ${t.byName}` : ''}</div>
                </>
              )}
              {t.kind === 'note' && (
                <>
                  <div className="font-display font-semibold text-ink">Nota interna de {t.byName}</div>
                  <div className="text-[12px] text-muted truncate">na conversa com <b className="text-ink">{t.contactName}</b></div>
                  <div className="mt-1 text-sm text-ink line-clamp-3 whitespace-pre-wrap break-words">{t.text}</div>
                </>
              )}
              {t.kind === 'review' && (
                <>
                  <div className="font-display font-semibold text-ink">{REVIEW_TITLE[t.ev.type](t.ev)}</div>
                  <div className="text-[12px] text-muted truncate">atendimento de <b className="text-ink">{t.ev.contactName}</b></div>
                  <div className="mt-1 text-sm text-ink line-clamp-3 whitespace-pre-wrap break-words">{t.ev.text}</div>
                </>
              )}
              {t.kind === 'internal' && (
                <>
                  <div className="font-display font-semibold text-ink truncate">💬 {t.title}</div>
                  <div className="mt-0.5 text-sm text-ink line-clamp-3 whitespace-pre-wrap break-words">{t.text}</div>
                </>
              )}
              <button type="button" onClick={() => abrir(t)} className={`mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 ${v.dot}`}>
                {t.kind === 'internal' ? 'Responder' : t.kind === 'review' ? 'Ver feedback' : 'Abrir conversa'}
              </button>
            </div>
            <button type="button" onClick={() => remove(t.key)} className="text-muted hover:text-ink" aria-label="Dispensar"><X size={16} /></button>
          </div>
        );
      })}
      {podePedir && (
        <button type="button" onClick={() => { void askNotification().then(() => setPodePedir(false)); }} className="w-full rounded-xl bg-side text-white text-[12px] px-3 py-2 shadow-lg hover:opacity-90">
          🔔 Ativar avisos no computador — para ver mesmo com o painel atrás de outra janela
        </button>
      )}
    </div>
  );
}
