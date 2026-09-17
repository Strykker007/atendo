'use client';
import { useEffect, useRef, useState } from 'react';
import { Paperclip, FileText, Download, X } from 'lucide-react';
import { ArrowLeft, Send, Check, CheckCheck, Clock, AlertCircle, PanelRightOpen, PanelRightClose, CheckCircle2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { useConversation, useMessages, useSendMessage, useSetStatus, useSetTags, useTags, useUsage, uploadFile, mediaTypeOf, type Message, type Upload } from '@/lib/hooks';
import { TagPicker } from './TagPicker';

export function ChatPane() {
  const { conversationId, setConversation, status, setStatus: setFilterStatus, rightPanelOpen, toggleRightPanel } = useUI();
  const conv = useConversation(conversationId).data;
  const tags = useTags();
  const messages = useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const setStatus = useSetStatus();
  const setTags = useSetTags();
  const usage = useUsage();
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      setAttachment(await uploadFile(file));
    } catch (err) {
      toast.err(err);
    } finally {
      setUploading(false);
    }
  }

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
    if ((!t && !attachment) || send.isPending) return;
    const att = attachment;
    setText('');
    setAttachment(null);
    try {
      if (att) {
        await send.mutateAsync({ type: mediaTypeOf(att.mimeType), mediaKey: att.key, text: t || undefined, media: { url: att.url, mimeType: att.mimeType, fileName: att.fileName } });
      } else {
        await send.mutateAsync({ type: 'text', text: t });
      }
      // responder tira a conversa de "Aguardando": acompanha o filtro para ela não sumir da lista
      if (status === 'waiting' && conv?.status === 'waiting') setFilterStatus('in_progress', true);
    } catch (err) {
      setText(t);
      setAttachment(att);
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
        <form onSubmit={submit} className="bg-white border-t border-surface-border px-3 py-2 space-y-2">
          {attachment && (
            <div className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2 text-sm">
              {attachment.mimeType.startsWith('image/') ? <img src={attachment.url} alt="" className="w-12 h-12 rounded object-cover" /> : <FileText size={20} className="text-gray-500" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{attachment.fileName}</div>
                <div className="text-xs text-gray-400">{(attachment.size / 1024).toFixed(0)} KB · legenda opcional abaixo</div>
              </div>
              <button type="button" onClick={() => setAttachment(null)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" hidden onChange={pickFile} accept="image/*,audio/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} title="Anexar arquivo" className="w-10 h-10 rounded-full text-gray-500 hover:bg-surface-muted grid place-items-center disabled:opacity-50">
            <Paperclip size={18} className={uploading ? 'animate-pulse' : ''} />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
            rows={1}
            placeholder={attachment ? 'Legenda (opcional)' : 'Digite uma mensagem (Enter envia, Shift+Enter quebra linha)'}
            className="flex-1 resize-none max-h-40 rounded-xl bg-surface-muted px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <button disabled={(!text.trim() && !attachment) || send.isPending || uploading} className="w-10 h-10 rounded-full bg-brand hover:bg-brand-hover text-white grid place-items-center disabled:opacity-50">
            <Send size={18} />
          </button>
          </div>
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
        <MediaBody m={m} />
        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-gray-500">
          {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {out && <StatusIcon status={m.status} />}
        </div>
        {(m.status === 'failed' || (m.error && !m.mediaUrl)) && <p className="text-[10px] text-red-600 mt-0.5">{m.error ?? 'Falha ao enviar'}</p>}
      </div>
    </div>
  );
}

/** Corpo de mídia da bolha. Sem mediaUrl ainda (download em andamento) mostra placeholder. */
function MediaBody({ m }: { m: Message }) {
  if (m.type === 'text' || m.type === 'template') return null;
  if (!m.mediaUrl) return <span className="italic text-gray-500 text-xs">[{labelOf(m.type)}{m.error ? ' · indisponível' : m.status === 'pending' ? '' : ' · carregando…'}]</span>;
  if (m.type === 'image' || m.type === 'sticker') return <a href={m.mediaUrl} target="_blank" rel="noreferrer"><img src={m.mediaUrl} alt="" className="rounded-md max-h-72 max-w-full object-contain mb-1" /></a>;
  if (m.type === 'audio') return <audio controls preload="metadata" src={m.mediaUrl} className="max-w-[260px] h-10 mb-1" />;
  if (m.type === 'video') return <video controls preload="metadata" src={m.mediaUrl} className="rounded-md max-h-72 max-w-full mb-1" />;
  return (
    <a href={m.mediaUrl} target="_blank" rel="noreferrer" download={m.mediaName ?? undefined} className="flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 mb-1 hover:bg-black/10">
      <FileText size={20} className="text-gray-500 shrink-0" />
      <span className="truncate text-xs font-medium flex-1">{m.mediaName ?? labelOf(m.type)}</span>
      <Download size={14} className="text-gray-400" />
    </a>
  );
}
const labelOf = (t: string) => ({ image: 'imagem', audio: 'áudio', video: 'vídeo', document: 'documento', sticker: 'figurinha', location: 'localização', contact: 'contato' } as Record<string, string>)[t] ?? t;

function StatusIcon({ status }: { status: string }) {
  if (status === 'pending') return <Clock size={12} />;
  if (status === 'sent') return <Check size={13} />;
  if (status === 'delivered') return <CheckCheck size={13} />;
  if (status === 'read') return <CheckCheck size={13} className="text-sky-500" />;
  return <AlertCircle size={12} className="text-red-500" />;
}
