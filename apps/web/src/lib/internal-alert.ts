'use client';
import { toast } from '@/components/ui/Toast';
import { playInternalSound } from './message-sound';
import { openInternalChat, useWidget } from './internal-chat-store';
import { useUI } from './store';

/**
 * Aviso de mensagem da equipe (docs/chat-interno.md#avisos). Antes era só o mesmo "plim" de
 * mensagem de cliente — no meio do atendimento passava despercebido. Agora:
 * - som próprio (três notas subindo), respeitando o "silenciar sons";
 * - cartão na tela, em qualquer página, com quem mandou + prévia e "Abrir conversa";
 * - notificação do sistema (Windows/macOS) quando a aba está em segundo plano, se a pessoa permitiu;
 * - o contador no título da aba fica com o widget (`useInternalUnreadTitle`).
 * Quem já está com aquela conversa aberta e a aba visível não recebe cartão nem notificação.
 */
export function alertInternalMessage(m: { chatId: string; authorName: string; text: string }, chat?: { name: string; isGroup: boolean } | null) {
  const w = useWidget.getState();
  const visivel = typeof document !== 'undefined' && document.visibilityState === 'visible';
  const lendo = visivel && w.open && !w.minimized && w.chatId === m.chatId;
  if (!useUI.getState().soundMuted) playInternalSound();
  if (lendo) return;
  const title = chat?.isGroup ? `${m.authorName} em ${chat.name}` : m.authorName;
  const text = m.text.length > 160 ? `${m.text.slice(0, 157)}…` : m.text;
  const abrir = () => openInternalChat(m.chatId);
  toast.message(`💬 ${title}`, text, abrir);
  if (!visivel) desktopNotify(title, text, m.chatId, abrir);
}

function desktopNotify(title: string, body: string, chatId: string, onClick: () => void) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    // `tag` por conversa: várias mensagens seguidas trocam a notificação em vez de empilhar
    const n = new Notification(`Equipe: ${title}`, { body, tag: `internal-${chatId}` });
    n.onclick = () => { window.focus(); onClick(); n.close(); };
  } catch {
    /* navegador sem suporte (ex.: Android exige service worker) */
  }
}

/** Pode pedir permissão de notificação? (só com clique da pessoa) */
export const canAskNotification = () => typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default';
export const askNotification = () => Notification.requestPermission().catch(() => 'denied' as const);
