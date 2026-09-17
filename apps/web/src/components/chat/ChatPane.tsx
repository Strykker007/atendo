'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, Check, CheckCheck, Clock, AlertCircle, PanelRightOpen, PanelRightClose, CheckCircle2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { useConversations, useMessages, useSendMessage, useSetStatus, useSetTags, useTags, useUsage, type Message } from '@/lib/hooks';
import { TagPicker } from './TagPicker';

export function ChatPane() {
  const { conversationId, setConversation, status, numberId, tagIds, rightPanelOpen, toggleRightPanel } = useUI();
  const list = useConversations({ status, numberId, tagIds });
  const conv = list.data?.find((c) => c.id === conversationId);
  const tags = useTags();
  const messages = useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const setStatus = useSetStatus();
  const setTags = useSetTags();
  const usage = useUsage();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.data?.length]);

  // permite que o painel de respostas rápidas insira texto no composer
  useEffect(() => {
    const h = (e: Event) => setText((t) => (t ? `${t} ` : '') + (e as CustomEvent<string>).detail);
    window.addEventListener('atendo:insert-text', h);
    return () => window.removeEventListener('atendo:insert-text', h);
  }, []);

  if (!conv) {
    return (
      <div className="flex-1 grid place-items-center text-gray-400 text-sm chat-bg">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-500">Atendo</p>
          <p>Selecione uma conversa para começar</p>
        </div>
      </div>
    );
  }

  const quotaHit = usage.data?.limits && usage.data.limits.hardLimit && usage.data.used.messages >= usage.data.limits.includedMessagesMonth;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || send.isPending) return;
    setText('');
    try {
      await send.mutateAsync(t);
    } catch (err) {
      setText(t);
      toast.err(err);
    }
  }

  return (
    <>
      {/* Cabeçalho: contato, tags, ações de status */}
      <header className="bg-white border-b border-surface-border px-3 py-2 flex items-center gap-3">
        <button className="md:hidden text-gray-500" onClick={() => setConversation(null)}>
          <ArrowLeft size={20} />
        </button>
        <div className="w-10 h-10 rounded-full bg-gray-200 grid place-items-center text-gray-600 font-medium shrink-0">
          {(conv.contact.name ?? conv.contact.phone).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{conv.contact.name ?? conv.contact.phone}</div>
          <div className="text-xs text-gray-500 truncate">
            {conv.contact.phone} · {conv.number.label}
            {conv.assignee && ` · ${conv.assignee.name}`}
          </div>
        </div>
        <div className="hidden lg:block w-72">
          <TagPicker compact tags={tags.data ?? []} value={conv.tags.map((t) => t.tag.id)} onChange={(ids) => setTags.mutate({ id: conv.id, tagIds: ids })} placeholder="Adicionar tag" />
        </div>
        {conv.status !== 'closed' ? (
          <button onClick={() => setStatus.mutate({ id: conv.id, status: 'closed' })} title="Encerrar atendimento" className="inline-flex items-center gap-1 text-xs rounded-lg border border-surface-border px-2.5 py-1.5 text-gray-600 hover:bg-surface-muted">
            <CheckCircle2 size={14} /> <span className="hidden sm:inline">Encerrar</span>
          </button>
        ) : (
          <button onClick={() => setStatus.mutate({ id: conv.id, status: 'in_progress' })} title="Reabrir" className="inline-flex items-center gap-1 text-xs rounded-lg border border-surface-border px-2.5 py-1.5 text-gray-600 hover:bg-surface-muted">
            <RotateCcw size={14} /> <span className="hidden sm:inline">Reabrir</span>
          </button>
        )}
        <button onClick={toggleRightPanel} className="hidden xl:block text-gray-400 hover:text-gray-600" title="Respostas rápidas">
          {rightPanelOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
        </button>
      </header>

      {/* Tags no mobile/tablet */}
      <div className="lg:hidden bg-white border-b border-surface-border px-3 py-1.5">
        <TagPicker compact tags={tags.data ?? []} value={conv.tags.map((t) => t.tag.id)} onChange={(ids) => setTags.mutate({ id: conv.id, tagIds: ids })} placeholder="Adicionar tag" />
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto chat-bg px-4 py-3 space-y-1.5 scrollbar-thin">
        {messages.data?.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      {quotaHit ? (
        <div className="bg-amber-50 border-t border-amber-200 px-4 py-3 text-sm text-amber-800">
          Limite de mensagens do plano <b>{usage.data?.plan}</b> atingido neste mês. Faça upgrade para continuar respondendo.
        </div>
      ) : conv.status === 'closed' ? (
        <div className="bg-white border-t border-surface-border px-4 py-3 text-sm text-gray-500 text-center">Conversa encerrada. Reabra para responder.</div>
      ) : (
        <form onSubmit={submit} className="bg-white border-t border-surface-border px-3 py-2 flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
            rows={1}
            placeholder="Digite uma mensagem (Enter envia, Shift+Enter quebra linha)"
            className="flex-1 resize-none max-h-40 rounded-xl bg-surface-muted px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <button disabled={!text.trim() || send.isPending} className="w-10 h-10 rounded-full bg-brand hover:bg-brand-hover text-white grid place-items-center disabled:opacity-50">
            <Send size={18} />
          </button>
        </form>
      )}
    </>
  );
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === 'out';
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm', out ? 'bg-[#d9fdd3]' : 'bg-white')}>
        {m.type !== 'text' && !m.text && <span className="italic text-gray-500">[{m.type}]</span>}
        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-gray-500">
          {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {out && <StatusIcon status={m.status} />}
        </div>
        {m.status === 'failed' && <p className="text-[10px] text-red-600 mt-0.5">{m.error ?? 'Falha ao enviar'}</p>}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'pending') return <Clock size={12} />;
  if (status === 'sent') return <Check size={13} />;
  if (status === 'delivered') return <CheckCheck size={13} />;
  if (status === 'read') return <CheckCheck size={13} className="text-sky-500" />;
  return <AlertCircle size={12} className="text-red-500" />;
}
