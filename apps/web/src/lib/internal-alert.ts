'use client';
import { pushInternalAlert } from '@/components/layout/TransferAlert';
import { playInternalSound } from './message-sound';
import { useWidget } from './internal-chat-store';
import { useUI } from './store';

/**
 * Aviso de mensagem da equipe (docs/chat-interno.md#avisos). Antes era só o mesmo "plim" de
 * mensagem de cliente — no meio do atendimento passava despercebido. Agora:
 * - som próprio (três notas subindo), respeitando o "silenciar sons";
 * - cartão FIXO no topo, em qualquer página, até a pessoa responder ou dispensar (o toast sumia
 *   sozinho e "ninguém via");
 * - notificação do sistema (Windows/macOS) sempre que o painel não está em foco, se permitida;
 * - o contador no título da aba fica com o widget (`useInternalUnreadTitle`).
 * Quem já está com aquela conversa aberta e a aba visível não recebe cartão nem notificação.
 */
export function alertInternalMessage(m: { chatId: string; authorName: string; text: string }, chat?: { name: string; isGroup: boolean } | null) {
  const w = useWidget.getState();
  const visivel = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
  const lendo = visivel && w.open && !w.minimized && w.chatId === m.chatId;
  if (!useUI.getState().soundMuted) playInternalSound();
  if (lendo) return;
  const title = chat?.isGroup ? `${m.authorName} em ${chat.name}` : m.authorName;
  const text = m.text.length > 160 ? `${m.text.slice(0, 157)}…` : m.text;
  pushInternalAlert(m.chatId, title, text);
}

/** Pode pedir permissão de notificação? (só com clique da pessoa) */
export const canAskNotification = () => typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default';
export const askNotification = () => Notification.requestPermission().catch(() => 'denied' as const);
