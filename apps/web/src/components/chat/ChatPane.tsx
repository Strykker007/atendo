'use client';
import { useEffect, useRef, useState } from 'react';
import { Paperclip, FileText, Download, X, RefreshCw, WifiOff, Hand, ArrowRightLeft, Undo2, UserRound, Lock, Unlock, CalendarPlus } from 'lucide-react';
import { AppointmentModal } from '@/components/scheduling/AppointmentModal';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Send, Check, CheckCheck, Clock, AlertCircle, PanelRightOpen, PanelRightClose, CheckCircle2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { useConversation, useMessages, useResend, useClaim, useTransfer, useRelease, useMe, useAgents, useSendNote, useActiveRun, useStopFlow, useSetContactTags, useHasFeature, useContactCard, useSendMessage, useSetStatus, useSetTags, useTags, useUsage, uploadFile, mediaTypeOf, type Message, type Upload } from '@/lib/hooks';
import { TagPicker } from './TagPicker';
import { STATUS_META } from './ConversationList';
import { avatarStyle, initialOf } from '@/lib/avatar';
import { OriginBadge } from './OriginBadge';

export function ChatPane() {
  const { conversationId, setConversation, status, setStatus: setFilterStatus, rightPanelOpen, toggleRightPanel } = useUI();
  const conv = useConversation(conversationId).data;
  const me = useMe();
  const agents = useAgents();
  const claim = useClaim();
  const transfer = useTransfer();
  const release = useRelease();
  const [transferOpen, setTransferOpen] = useState(false);
  const isAdmin = me.data ? me.data.role !== 'agent' : false;
  const mine = !!conv && conv.assignee?.id === me.data?.id;
  const ownedByOther = !!conv && !!conv.assignee && !mine;
  // Cadeado: gerente/admin numa conversa de outra pessoa. Fechado = não envia nada.
  // Aberto = manda NOTA INTERNA (só a equipe vê). Reseta ao trocar de conversa.
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => setUnlocked(false), [conversationId]);
  const sendNote = useSendNote(conversationId);
  const noteMode = isAdmin && ownedByOther;
  const activeRun = useActiveRun(conversationId);
  const stopFlow = useStopFlow();
  const sched = useHasFeature('scheduling');
  const [scheduling, setScheduling] = useState(false);
  const card = useContactCard(conv?.contact.id ?? null, sched.has);
  const tags = useTags();
  const messages = useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const setStatus = useSetStatus();
  const setTags = useSetTags();
  const setContactTags = useSetContactTags();
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
      <div className="flex-1 grid place-items-center chat-bg">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-accent/10 text-accent grid place-items-center mb-3"><Send size={20} /></div>
          <p className="font-display font-semibold text-ink">Selecione uma conversa</p>
          <p className="text-sm text-muted mt-1">A fila à esquerda está separada por status: aguardando, em atendimento e encerrado.</p>
        </div>
      </div>
    );
  }

  const quotaHit = usage.data?.limits && usage.data.limits.hardLimit && usage.data.used.messages >= usage.data.limits.includedMessagesMonth;
  const numberOffline = conv.number.status && conv.number.status !== 'connected';

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (noteMode) {
      if (!unlocked || !t || sendNote.isPending) return;
      setText('');
      try {
        await sendNote.mutateAsync(t);
      } catch (err) {
        setText(t);
        toast.err(err);
      }
      return;
    }
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
      <header className="bg-panel border-b border-line px-3 py-1.5 flex items-center gap-2 min-w-0">
        <button className="md:hidden text-muted" onClick={() => setConversation(null)}>
          <ArrowLeft size={20} />
        </button>
        <div className="w-9 h-9 rounded-lg grid place-items-center font-display font-semibold shrink-0" style={avatarStyle(conv.contact.phone)}>
          {initialOf(conv.contact.name ?? conv.contact.phone)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate text-ink">{conv.contact.name ?? `+${conv.contact.phone}`}</div>
          <div className="text-xs text-muted truncate tnum flex items-center gap-1.5">
            <span className="truncate">+{conv.contact.phone} · {conv.number.label}{conv.assignee && ` · ${conv.assignee.name}`}</span>
            <OriginBadge origin={conv.origin} data={conv.originData} detailed />
          </div>
        </div>
        <span className={cn('hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1', STATUS_META[conv.status].soft, STATUS_META[conv.status].color)}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />{STATUS_META[conv.status].short}
        </span>
        {sched.has && (
          <Button size="sm" variant="ghost" icon={<CalendarPlus size={14} />} onClick={() => setScheduling(true)} title="Agendar horário para este cliente"><span className="hidden sm:inline">Agendar</span></Button>
        )}
        {conv.status === 'waiting' && (
          <Button size="sm" icon={<Hand size={14} />} loading={claim.isPending} loadingText="Assumindo…" onClick={() => claim.mutateAsync(conv.id).then(() => { toast.ok('Você assumiu este atendimento'); setFilterStatus('in_progress', true); }).catch(toast.err)} title="Assumir atendimento">
            <span className="hidden sm:inline">Assumir</span>
          </Button>
        )}
        {conv.status === 'in_progress' && (mine || isAdmin) && (
          <div className="relative">
            <Button size="sm" variant="ghost" icon={<ArrowRightLeft size={14} />} onClick={() => setTransferOpen((o) => !o)} title="Transferir ou devolver à fila">
              <span className="hidden sm:inline">Transferir</span>
            </Button>
            {transferOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl bg-panel border border-line shadow-lg py-1 text-sm" onMouseLeave={() => setTransferOpen(false)}>
                <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Transferir para</div>
                {agents.data?.filter((a) => a.isActive && a.id !== conv.assignee?.id).map((a) => (
                  <button key={a.id} onClick={() => { setTransferOpen(false); transfer.mutateAsync({ id: conv.id, agentId: a.id }).then(() => toast.ok(`Transferido para ${a.name}`)).catch(toast.err); }} className="w-full text-left px-3 py-1.5 hover:bg-field text-ink flex items-center gap-2">
                    <UserRound size={13} className="text-faint" /> {a.name}
                  </button>
                ))}
                {agents.data?.filter((a) => a.isActive && a.id !== conv.assignee?.id).length === 0 && <div className="px-3 py-1.5 text-muted text-xs">Nenhum outro atendente ativo.</div>}
                <div className="border-t border-line my-1" />
                <button onClick={() => { setTransferOpen(false); release.mutateAsync(conv.id).then(() => { toast.ok('Devolvida para a fila'); setFilterStatus('waiting', true); }).catch(toast.err); }} className="w-full text-left px-3 py-1.5 hover:bg-field text-ink flex items-center gap-2">
                  <Undo2 size={13} className="text-faint" /> Devolver à fila
                </button>
              </div>
            )}
          </div>
        )}
        {conv.status !== 'closed' ? (
          <Button size="sm" variant="ghost" icon={<CheckCircle2 size={14} />} loading={setStatus.isPending} onClick={() => setStatus.mutateAsync({ id: conv.id, status: 'closed' }).then(() => toast.ok('Atendimento encerrado')).catch(toast.err)} title="Encerrar atendimento">
            <span className="hidden sm:inline">Encerrar</span>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} loading={setStatus.isPending} onClick={() => setStatus.mutateAsync({ id: conv.id, status: 'in_progress' }).then(() => toast.ok('Conversa reaberta')).catch(toast.err)} title="Reabrir">
            <span className="hidden sm:inline">Reabrir</span>
          </Button>
        )}
        <button onClick={toggleRightPanel} className="hidden xl:block text-faint hover:text-ink" title="Respostas rápidas">
          {rightPanelOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
        </button>
      </header>

      {/* Ficha de agendamento do contato */}
      {sched.has && card.data && (card.data.upcoming.length > 0 || card.data.visits > 0) && (
        <div className="bg-panel border-b border-line px-3 py-1 text-[11.5px] text-muted flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>💈 {card.data.visits} visita{card.data.visits === 1 ? '' : 's'}{card.data.last ? ` · última ${new Date(card.data.last.startAt).toLocaleDateString('pt-BR')} (${card.data.last.service.name})` : ''}</span>
          {card.data.upcoming.map((a) => <span key={a.id} className="text-ink">Próximo: <b>{new Date(a.startAt).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b> · {a.service.name} com {a.professional.name}{a.status === 'confirmed' ? ' ✅' : ''}</span>)}
        </div>
      )}

      {/* Fluxo de automação rodando */}
      {activeRun.data && (
        <div className="bg-accent-soft border-b border-accent/20 px-3 py-1.5 text-xs text-accent-ink flex items-center gap-2">
          <span className="animate-pulse">🤖</span>
          <span className="flex-1 truncate">Fluxo <b>{activeRun.data.flow.name}</b> está atendendo{activeRun.data.status === 'waiting' && activeRun.data.waitUntil ? ` · aguardando até ${new Date(activeRun.data.waitUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : activeRun.data.status === 'waiting' ? ' · esperando resposta do contato' : ''}</span>
          <Button size="sm" variant="ghost" loading={stopFlow.isPending} onClick={() => conversationId && stopFlow.mutateAsync(conversationId).then(() => toast.ok('Fluxo parado — a conversa é sua')).catch(toast.err)}>Parar e assumir</Button>
        </div>
      )}

      {/* Tags: do atendimento (esta conversa) e da pessoa (valem para sempre) */}
      <div className="bg-panel border-b border-line px-3 py-1 grid sm:grid-cols-2 gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-faint shrink-0 w-14" title="Tags deste atendimento">Conversa</span>
          <div className="flex-1 min-w-0"><TagPicker compact tags={tags.data ?? []} value={conv.tags.map((t) => t.tag.id)} onChange={(ids) => setTags.mutate({ id: conv.id, tagIds: ids })} placeholder="Adicionar tag" /></div>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-faint shrink-0 w-14" title="Tags da pessoa — valem em todas as conversas dela">📌 Contato</span>
          <div className="flex-1 min-w-0"><TagPicker compact tags={tags.data ?? []} value={(conv.contact.tags ?? []).map((t) => t.tag.id)} onChange={(ids) => setContactTags.mutate({ contactId: conv.contact.id, tagIds: ids })} placeholder="Tag permanente" /></div>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto chat-bg px-4 py-2.5 space-y-1 scrollbar-thin">
        {messages.isLoading && (
          <div className="space-y-2 pt-2">
            {[60, 40, 75, 35].map((w, i) => (
              <div key={i} className={i % 2 ? 'flex justify-end' : 'flex'}><div className="animate-pulse rounded-lg bg-panel/70 h-9" style={{ width: `${w}%` }} /></div>
            ))}
          </div>
        )}
        {messages.data?.map((m) => <Bubble key={m.id} m={m} canResend={!numberOffline} />)}
        <div ref={bottomRef} />
      </div>

      <AppointmentModal open={scheduling} onClose={() => setScheduling(false)} contact={conv.contact} conversationId={conv.id} />

      {/* Composer */}
      {noteMode ? (
        <form onSubmit={submit} className={cn('border-t px-3 py-2 flex items-end gap-2 transition-colors', unlocked ? 'bg-warn-soft border-warn/40' : 'bg-field border-line')}>
          <Button type="button" variant="ghost" className={cn('w-9 h-9 rounded-full p-0 border-0', unlocked ? 'bg-warn text-white hover:bg-warn' : 'bg-transparent text-muted')} onClick={() => setUnlocked((u) => !u)} title={unlocked ? 'Fechar cadeado (parar de enviar notas)' : 'Abrir cadeado para enviar nota interna ao atendente'} icon={unlocked ? <Unlock size={18} /> : <Lock size={18} />} />
          {unlocked ? (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())} rows={1} placeholder={`Nota interna para ${conv.assignee?.name} — o cliente não vê`} className="flex-1 resize-none max-h-40 rounded-xl bg-panel text-ink placeholder:text-warn-ink/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-warn/50" />
              <Button type="submit" className="w-9 h-9 rounded-full p-0 bg-warn hover:bg-warn/90" disabled={!text.trim()} loading={sendNote.isPending} icon={<Send size={18} />} title="Enviar nota interna" />
            </>
          ) : (
            <div className="flex-1 text-sm text-muted py-2.5"><b className="text-ink">{conv.assignee?.name}</b> está atendendo. Abra o cadeado para mandar uma nota interna, ou transfira para você.</div>
          )}
        </form>
      ) : ownedByOther && !isAdmin ? (
        <div className="bg-field border-t border-line px-4 py-3 text-sm text-muted flex items-center gap-2">
          <UserRound size={16} className="shrink-0" />
          <span className="flex-1"><b className="text-ink">{conv.assignee?.name}</b> está atendendo esta conversa. Peça a transferência ou aguarde a devolução à fila.</span>
        </div>
      ) : numberOffline ? (
        <div className="bg-danger-soft border-t border-danger/30 px-4 py-3 text-sm text-danger-ink flex items-center gap-2">
          <WifiOff size={16} className="shrink-0" />
          <span className="flex-1">O número <b>{conv.number.label}</b> está desconectado. Você continua recebendo, mas não consegue responder.</span>
          <Link href="/numeros" className="underline font-medium whitespace-nowrap">Conectar</Link>
        </div>
      ) : quotaHit ? (
        <div className="bg-warn-soft border-t border-warn/30 px-4 py-3 text-sm text-warn-ink">
          Limite de mensagens do plano <b>{usage.data?.plan}</b> atingido neste mês. Faça upgrade para continuar respondendo.
        </div>
      ) : conv.status === 'closed' ? (
        <div className="bg-panel border-t border-line px-4 py-3 text-sm text-muted text-center">Conversa encerrada. Reabra para responder.</div>
      ) : (
        <form onSubmit={submit} className="bg-panel border-t border-line px-2.5 py-1.5 space-y-1.5">
          {attachment && (
            <div className="flex items-center gap-3 rounded-xl bg-field px-3 py-2 text-sm">
              {attachment.mimeType.startsWith('image/') ? <img src={attachment.url} alt="" className="w-12 h-12 rounded object-cover" /> : <FileText size={20} className="text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{attachment.fileName}</div>
                <div className="text-xs text-faint">{(attachment.size / 1024).toFixed(0)} KB · legenda opcional abaixo</div>
              </div>
              <button type="button" onClick={() => setAttachment(null)} className="text-faint hover:text-ink"><X size={16} /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" hidden onChange={pickFile} accept="image/*,audio/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx" />
          <Button type="button" variant="ghost" className="w-9 h-9 rounded-full p-0 border-0 bg-transparent text-muted" onClick={() => fileRef.current?.click()} loading={uploading} title={uploading ? 'Enviando arquivo…' : 'Anexar arquivo'} icon={<Paperclip size={18} />} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
            rows={1}
            placeholder={attachment ? 'Legenda (opcional)' : 'Mensagem… (Enter envia)'}
            className="flex-1 resize-none max-h-40 rounded-xl bg-field text-ink placeholder:text-faint px-3.5 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <Button type="submit" className="w-9 h-9 rounded-full p-0" disabled={(!text.trim() && !attachment) || uploading} loading={send.isPending} icon={<Send size={18} />} title="Enviar" />
          </div>
        </form>
      )}
    </>
  );
}

function Bubble({ m, canResend }: { m: Message; canResend: boolean }) {
  const out = m.direction === 'out';
  const resend = useResend();
  if (m.internal) {
    return (
      <div className="flex justify-center my-1">
        <div className="max-w-[80%] rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-sm shadow-sm">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-warn-ink mb-0.5"><Lock size={11} /> Nota interna · {m.author?.name ?? 'gerente'} <span className="text-warn-ink/60 normal-case tracking-normal font-normal">· só a equipe vê</span></div>
          <p className="whitespace-pre-wrap break-words text-ink">{m.text}</p>
          <div className="text-[10px] text-warn-ink/70 text-right tnum font-mono mt-0.5">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[72%] px-2.5 py-1.5 text-[13px] shadow-sm', out ? 'bg-chat-out text-chat-out-ink rounded-xl rounded-br-sm' : 'bg-chat-in text-chat-in-ink rounded-xl rounded-bl-sm')}>
        <MediaBody m={m} />
        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
        <div className={cn('flex items-center justify-end gap-1 mt-0.5 text-[10px] tnum font-mono', out ? 'text-chat-out-ink/75' : 'text-faint')}>
          {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {out && <StatusIcon status={m.status} />}
        </div>
        {(m.status === 'failed' || (m.error && !m.mediaUrl)) && (
          <p className={cn('text-[10px] mt-0.5 flex items-center gap-2', out ? 'text-danger-ink bg-danger-soft rounded px-1.5 py-0.5' : 'text-danger')}>
            <span className="flex-1">{m.error ?? 'Falha ao enviar'}</span>
            {m.status === 'failed' && canResend && (
              <button onClick={() => resend.mutateAsync({ conversationId: m.conversationId, messageId: m.id }).catch(toast.err)} disabled={resend.isPending} className="inline-flex items-center gap-1 rounded bg-panel/70 px-1.5 py-0.5 text-danger-ink hover:bg-panel">
                <RefreshCw size={10} className={resend.isPending ? 'animate-spin' : ''} /> reenviar
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/** Corpo de mídia da bolha. Sem mediaUrl ainda (download em andamento) mostra placeholder. */
function MediaBody({ m }: { m: Message }) {
  if (m.type === 'text' || m.type === 'template') return null;
  if (!m.mediaUrl) return <span className="italic text-muted text-xs">[{labelOf(m.type)}{m.error ? ' · indisponível' : m.status === 'pending' ? '' : ' · carregando…'}]</span>;
  if (m.type === 'image' || m.type === 'sticker') return <a href={m.mediaUrl} target="_blank" rel="noreferrer"><img src={m.mediaUrl} alt="" className="rounded-md max-h-72 max-w-full object-contain mb-1" /></a>;
  if (m.type === 'audio') return <audio controls preload="metadata" src={m.mediaUrl} className="max-w-[260px] h-10 mb-1" />;
  if (m.type === 'video') return <video controls preload="metadata" src={m.mediaUrl} className="rounded-md max-h-72 max-w-full mb-1" />;
  return (
    <a href={m.mediaUrl} target="_blank" rel="noreferrer" download={m.mediaName ?? undefined} className="flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 mb-1 hover:bg-black/10">
      <FileText size={20} className="text-muted shrink-0" />
      <span className="truncate text-xs font-medium flex-1">{m.mediaName ?? labelOf(m.type)}</span>
      <Download size={14} className="text-faint" />
    </a>
  );
}
const labelOf = (t: string) => ({ image: 'imagem', audio: 'áudio', video: 'vídeo', document: 'documento', sticker: 'figurinha', location: 'localização', contact: 'contato' } as Record<string, string>)[t] ?? t;

function StatusIcon({ status }: { status: string }) {
  if (status === 'pending') return <Clock size={12} />;
  if (status === 'sent') return <Check size={13} />;
  if (status === 'delivered') return <CheckCheck size={13} />;
  if (status === 'read') return <CheckCheck size={13} className="opacity-100" />;
  return <AlertCircle size={12} className="text-danger" />;
}
