'use client';
import { Copy, ExternalLink, Phone, Reply } from 'lucide-react';
import type { ContentButton } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useSendMessage } from '@/lib/hooks';

/** Mensagem recebida: os botões de resposta são do atendente (ver `ButtonsMessage`). */
type ReplyTo = { conversationId: string; externalId?: string };

/**
 * Mensagem com botões (template, `buttonsMessage`, `interactiveMessage`). Na mensagem ENVIADA, os
 * botões são o que o contato toca no celular — aqui ficam só como prévia. Na RECEBIDA (outra empresa
 * mandou "Ativar conversa" para nós), o botão de resposta é nosso: clicar responde com o título dele,
 * citando a mensagem — é o mesmo que tocar no celular. "Copiar" copia para o atendente, sem enviar nada.
 */
export function ButtonsMessage({ text, header, footer, buttons, replyTo }: { text: string | null; header?: string; footer?: string; buttons: ContentButton[]; replyTo?: ReplyTo }) {
  return (
    <div className="min-w-[180px]">
      {header && <p className="font-semibold mb-0.5 break-words">{header}</p>}
      {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
      {footer && <p className="text-[11px] opacity-70 mt-0.5 break-words">{footer}</p>}
      {!!buttons.length && (
        <div className="mt-1.5 -mx-2.5 border-t border-black/10 dark:border-white/10 divide-y divide-black/10 dark:divide-white/10">
          {buttons.map((b, i) => <Botao key={`${b.id ?? b.title}-${i}`} b={b} replyTo={replyTo} />)}
        </div>
      )}
    </div>
  );
}

const ICONE = { reply: Reply, url: ExternalLink, call: Phone, copy: Copy } as const;

function Botao({ b, replyTo }: { b: ContentButton; replyTo?: ReplyTo }) {
  const Icone = ICONE[b.kind];
  const base = 'w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium text-accent';

  if (b.kind === 'copy' && b.value) {
    const copiar = () => navigator.clipboard.writeText(b.value!).then(() => toast.ok('Copiado'), () => toast.err(new Error('Não foi possível copiar')));
    return <button type="button" onClick={copiar} title={b.value} className={cn(base, 'hover:bg-black/5 dark:hover:bg-white/10')}><Icone size={13} />{b.title}</button>;
  }
  if (b.kind === 'url' && b.value && /^https?:\/\//i.test(b.value)) {
    return <a href={b.value} target="_blank" rel="noreferrer noopener" title={b.value} className={cn(base, 'hover:bg-black/5 dark:hover:bg-white/10')}><Icone size={13} />{b.title}</a>;
  }
  if (b.kind === 'reply' && replyTo) return <BotaoResposta b={b} replyTo={replyTo} base={base} />;
  // resposta rápida / ligação: é ação do contato, não do atendente
  return <div title={b.value ?? 'Opção que o contato vê no celular'} className={cn(base, 'opacity-70 cursor-default')}><Icone size={13} />{b.title}</div>;
}

function BotaoResposta({ b, replyTo, base }: { b: ContentButton; replyTo: ReplyTo; base: string }) {
  const send = useSendMessage(replyTo.conversationId);
  const responder = () =>
    send.mutateAsync({ type: 'text', text: b.title, ...(replyTo.externalId && { quotedExternalId: replyTo.externalId }), simulateTypingChars: b.title.length })
      .then(() => toast.ok(`Respondido: "${b.title}"`))
      .catch(toast.err);
  return (
    <button type="button" onClick={() => void responder()} disabled={send.isPending} title={`Responder "${b.title}" (o mesmo que tocar no botão pelo celular)`} className={cn(base, 'hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50')}>
      <Reply size={13} />{b.title}
    </button>
  );
}
