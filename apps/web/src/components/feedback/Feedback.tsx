'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Eye, Lightbulb, Lock, Paperclip, ThumbsUp, Trash2, Wrench } from 'lucide-react';
import { MESSAGE_TYPE_LABEL, REVIEW_KINDS, REVIEW_KIND_HINT, REVIEW_KIND_LABEL, type AttendanceReview, type MessageType, type ReviewKind } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { inputCls, Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { receiveNoteAlert } from '@/components/layout/TransferAlert';
import { useReviewGate } from '@/lib/review-gate';
import { useAckReview, useAttention, useCan, useCreateReview, useDeleteReview, useMe, useReview, useReviewMessages, useReviewSettings, useSeenReview, type Message } from '@/lib/hooks';

/**
 * Feedback de atendimento (docs/feedback-de-atendimento.md): peças usadas na auditoria (gestor
 * aponta), na tela Feedbacks (atendente dá ciência) e no shell (pendências ao entrar).
 */

export const KIND_STYLE: Record<ReviewKind, { icon: React.ReactNode; cls: string }> = {
  correction: { icon: <Wrench size={12} />, cls: 'bg-danger-soft text-danger' },
  opportunity: { icon: <Lightbulb size={12} />, cls: 'bg-warn-soft text-warn-ink' },
  guidance: { icon: <ClipboardCheck size={12} />, cls: 'bg-accent-soft text-accent-ink' },
  praise: { icon: <ThumbsUp size={12} />, cls: 'bg-ok-soft text-ok' },
};

export function KindBadge({ kind }: { kind: ReviewKind }) {
  const s = KIND_STYLE[kind];
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', s.cls)}>{s.icon}{REVIEW_KIND_LABEL[kind]}</span>;
}

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const horas = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`);

/** Situação em uma linha: o que o gestor precisa saber sem abrir. */
export function StatusLine({ r, gestor }: { r: AttendanceReview; gestor?: boolean }) {
  if (r.status === 'acknowledged') {
    return <span className="inline-flex items-center gap-1 text-[11.5px] text-ok font-medium"><CheckCircle2 size={12} />{r.requiresAck ? `Ciente em ${fmt(r.acknowledgedAt!)}` : `Visto em ${fmt(r.seenAt!)}`}</span>;
  }
  const prazo = r.deadlineMinutes ? ` · ${horas(r.onlineMinutes)} de ${horas(r.deadlineMinutes)} online` : '';
  if (r.status === 'overdue') return <span className="inline-flex items-center gap-1 text-[11.5px] text-danger font-semibold"><AlertTriangle size={12} />Prazo vencido sem ciência{prazo}</span>;
  // o atendente não entrou desde o apontamento: o prazo ainda nem começou a correr (folga, escala)
  const naoEntrou = gestor && r.agentLastSeenAt !== undefined && (!r.agentLastSeenAt || new Date(r.agentLastSeenAt) < new Date(r.createdAt));
  if (r.status === 'seen') return <span className="inline-flex items-center gap-1 text-[11.5px] text-warn-ink"><Eye size={12} />Visto em {fmt(r.seenAt!)}, sem ciência{prazo}</span>;
  return <span className="inline-flex items-center gap-1 text-[11.5px] text-muted"><Clock size={12} />{naoEntrou ? 'Ainda não entrou desde o feedback (o prazo só corre online)' : 'Ainda não abriu'}{prazo}</span>;
}

/** Mensagens do atendimento, só leitura. `selected` destaca o trecho; com `onToggle`, clicar marca. */
export function AttendanceBubbles({ msgs, contato, selected, onToggle }: { msgs: Message[]; contato: string; selected: string[]; onToggle?: (id: string) => void }) {
  const primeiro = useRef<HTMLDivElement>(null);
  // abriu o feedback: rola até o primeiro trecho marcado
  useEffect(() => { if (!onToggle) primeiro.current?.scrollIntoView({ block: 'center' }); }, [msgs.length, onToggle]);
  const primeiraMarcada = msgs.find((m) => selected.includes(m.id))?.id;
  return (
    <>
      {msgs.map((m) => {
        const nota = !!m.internal;
        const sai = m.direction === 'out';
        const marcada = selected.includes(m.id);
        const ref = m.id === primeiraMarcada ? primeiro : undefined;
        const autor = m.direction === 'in' ? (m.senderName || contato) : m.author?.name ?? m.authorName ?? 'Automático';
        const corpo = m.deletedAt ? <i className="text-muted">mensagem apagada</i> : m.text || (m.mediaName ? <span className="inline-flex items-center gap-1"><Paperclip size={12} />{m.mediaName}</span> : MESSAGE_TYPE_LABEL[m.type as MessageType] ?? m.type);
        return (
          <div key={m.id} ref={ref} className={cn('flex', sai ? 'justify-end' : 'justify-start')}>
            <div
              onClick={onToggle && !nota ? () => onToggle(m.id) : undefined}
              title={onToggle && !nota ? (marcada ? 'Desmarcar este trecho' : 'Marcar este trecho no feedback') : undefined}
              className={cn('max-w-[80%] rounded-xl px-3 py-1.5 text-[13px] shadow-sm transition', nota ? 'bg-warn-soft text-warn-ink' : sai ? 'bg-accent-soft text-ink' : 'bg-panel text-ink',
                onToggle && !nota && 'cursor-pointer hover:ring-2 hover:ring-danger/40', marcada && 'ring-2 ring-danger')}
            >
              <div className={cn('text-[10.5px] font-semibold flex items-center gap-1', sai || nota ? 'opacity-70' : 'text-accent')}>{nota && <Lock size={10} />}{autor}</div>
              {m.mediaUrl && m.mediaMime?.startsWith('image/') && !m.deletedAt && <img src={m.mediaUrl} alt="" className="mt-1 max-h-40 rounded-lg" />}
              <div className="whitespace-pre-wrap break-words">{corpo}</div>
              <div className="text-[10px] text-faint text-right tnum">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * Formulário do gestor, dentro da auditoria: tipo, texto e o trecho (marcado clicando nas
 * mensagens, que ficam com quem chama). Mostra a regra do tipo para ninguém se surpreender.
 */
export function ReviewComposer({ conversationId, closeEventId, agent, selected, onClear, onDone }: { conversationId: string; closeEventId: string; agent: { id: string; name: string }; selected: string[]; onClear: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<ReviewKind>('correction');
  const [text, setText] = useState('');
  const create = useCreateReview();
  const regras = useReviewSettings().data;
  const regra = regras?.kinds[kind];
  const enviar = () => create.mutateAsync({ conversationId, closeEventId, agentId: agent.id, kind, text, messageIds: selected })
    .then(() => { toast.ok(`Feedback enviado para ${agent.name}. Acompanhe em Feedbacks → Enviados.`); onDone(); })
    .catch(toast.err);
  return (
    <div className="rounded-xl border border-danger/30 bg-panel p-3 space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {REVIEW_KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} title={REVIEW_KIND_HINT[k]}
            className={cn('inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors', kind === k ? cn('border-transparent', KIND_STYLE[k].cls) : 'border-line text-muted hover:bg-field')}>
            {KIND_STYLE[k].icon}{REVIEW_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} autoFocus
        placeholder={kind === 'opportunity' ? 'Ex.: Você vendeu 10 preservativos, mas poderia ter oferecido o lubrificante, que estava em promoção.' : kind === 'praise' ? 'O que foi bem feito neste atendimento…' : `O que ${agent.name.split(' ')[0]} deveria ter feito diferente…`}
        className={cn(inputCls, 'resize-y')} />
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        <span>{selected.length ? <>{selected.length} mensagem(ns) marcada(s) · <button type="button" onClick={onClear} className="text-accent-ink hover:underline">limpar</button></> : 'Clique nas mensagens acima para marcar o trecho (opcional).'}</span>
        {regra && (
          <span className="ml-auto text-faint">
            {regra.requiresAck ? `Exige ciência${regra.deadlineHours ? ` em até ${regra.deadlineHours}h online` : ''}${regra.blocksClaim ? ' · trava novo atendimento até a ciência' : ''}` : 'Só precisa ser visto'}
          </span>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>Cancelar</Button>
        <Button size="sm" disabled={text.trim().length < 3} loading={create.isPending} onClick={enviar}>Enviar para {agent.name.split(' ')[0]}</Button>
      </div>
    </div>
  );
}

/**
 * Um feedback aberto. Para o atendente: abrir marca "visto"; "Li e estou ciente" (com resposta
 * opcional) fecha a pendência. Para o gestor: situação, resposta e apagar (só antes da ciência).
 */
export function ReviewDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useReview(id).data;
  const msgs = useReviewMessages(id);
  const me = useMe().data;
  const gestor = useCan('reviews.manage');
  const seen = useSeenReview();
  const ack = useAckReview();
  const del = useDeleteReview();
  const [reply, setReply] = useState('');
  const souEu = !!r && !!me && r.agent.id === me.id;
  useEffect(() => {
    if (r && souEu && !r.seenAt && !seen.isPending) seen.mutate(r.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, souEu, r?.seenAt]);

  if (!r) return <Modal open onClose={onClose} title="Feedback"><p className="py-8 text-center text-sm text-muted">Carregando…</p></Modal>;
  const contato = r.contact.name || r.contact.phone;
  const podeCiencia = souEu && r.requiresAck && !r.acknowledgedAt;
  const podeResponder = souEu && !r.agentReply && (!r.requiresAck || !!r.acknowledgedAt);

  return (
    <Modal open onClose={onClose} title={`Feedback · ${contato}`} width="max-w-2xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
          <KindBadge kind={r.kind} />
          <span>de <b className="text-ink font-medium">{r.reviewer.name}</b> para <b className="text-ink font-medium">{r.agent.name}</b></span>
          <span className="tnum">{fmt(r.createdAt)}</span>
          <StatusLine r={r} gestor={gestor && !souEu} />
        </div>
        <div className={cn('rounded-xl px-3.5 py-2.5 text-[13.5px] whitespace-pre-wrap break-words', KIND_STYLE[r.kind].cls)}>{r.text}</div>
        {r.agentReply && (
          <div className="rounded-xl border border-line bg-field/50 px-3.5 py-2.5 text-[13px]">
            <div className="text-[11px] font-semibold text-muted mb-0.5">Resposta de {r.agent.name} · {fmt(r.repliedAt!)}</div>
            <div className="whitespace-pre-wrap break-words text-ink">{r.agentReply}</div>
          </div>
        )}

        <div className="rounded-xl border border-line bg-field/40 p-3 max-h-[42vh] overflow-y-auto space-y-1.5">
          {msgs.isLoading && <p className="py-6 text-center text-sm text-muted">Carregando o atendimento…</p>}
          {msgs.data && !msgs.data.length && <p className="py-6 text-center text-sm text-muted">Sem mensagens neste atendimento.</p>}
          {msgs.data && <AttendanceBubbles msgs={msgs.data} contato={contato} selected={r.messageIds} />}
        </div>
        {r.messageIds.length > 0 && <p className="text-[11.5px] text-faint">Em vermelho, o trecho que {r.reviewer.name.split(' ')[0]} marcou.</p>}

        {(podeCiencia || podeResponder) && (
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={2000} placeholder="Quer comentar ou explicar algo? (opcional)" className={cn(inputCls, 'resize-y')} />
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {gestor && !souEu && !r.acknowledgedAt && (
            <Button variant="subtle" size="sm" icon={<Trash2 size={13} />} loading={del.isPending} className="mr-auto"
              onClick={() => confirm('Apagar este feedback? O atendente deixa de vê-lo.') && del.mutateAsync(r.id).then(() => { toast.ok('Feedback apagado'); onClose(); }).catch(toast.err)}>Apagar</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          {podeCiencia && <Button variant="success" icon={<CheckCircle2 size={15} />} loading={ack.isPending} onClick={() => ack.mutateAsync({ id: r.id, reply }).then(() => { toast.ok('Ciência registrada'); setReply(''); }).catch(toast.err)}>Li e estou ciente</Button>}
          {podeResponder && reply.trim() && <Button loading={ack.isPending} onClick={() => ack.mutateAsync({ id: r.id, reply }).then(() => { toast.ok('Resposta enviada'); setReply(''); }).catch(toast.err)}>Enviar resposta</Button>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Ao entrar (docs/feedback-de-atendimento.md#garantia-de-leitura): notas internas não lidas voltam
 * como cartão, e feedback pendente abre esta tela. Uma vez por sessão do navegador; a recusa ao
 * assumir atendimento (`reviews_pending`) abre de novo, sem o "Depois".
 */
export function AttentionGate() {
  const me = useMe().data;
  const cliente = !!me?.tenantId && me.role !== 'super_admin' && me.role !== 'partner' && !me.impersonatorId;
  const att = useAttention(cliente).data;
  const { open, forced, show, hide } = useReviewGate();
  const router = useRouter();
  const feito = useRef(false);
  useEffect(() => {
    if (!att || !me || feito.current) return;
    feito.current = true;
    const chave = `atendo:atencao:${me.id}`;
    try { if (sessionStorage.getItem(chave)) return; sessionStorage.setItem(chave, '1'); } catch { /* sem storage: mostra */ }
    for (const n of att.notes.slice(0, 3).reverse()) receiveNoteAlert(n);
    if (att.reviews.pending > 0) show(false);
  }, [att, me, show]);
  if (!open || !att) return null;
  const { pending, blocking, items } = att.reviews;
  if (!pending) return null;
  const ver = (id?: string) => { hide(); router.push(id ? `/feedbacks?abrir=${id}` : '/feedbacks'); };
  return (
    <Modal open onClose={hide} title={pending === 1 ? 'Você tem um feedback do gestor' : `Você tem ${pending} feedbacks do gestor`}>
      <div className="space-y-3">
        {blocking > 0 && (
          <p className="rounded-lg bg-danger-soft text-danger px-3 py-2 text-[12.5px] font-medium">
            {forced ? 'Para assumir um novo atendimento, ' : 'Até lá, '}dê ciência {blocking === 1 ? 'na correção' : `nas ${blocking} correções`} abaixo{forced ? '.' : ' — sem isso você não assume novo atendimento.'}
          </p>
        )}
        <ul className="space-y-1.5">
          {items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => ver(r.id)} className="w-full text-left rounded-xl border border-line hover:bg-field px-3 py-2">
                <div className="flex items-center gap-2 text-[12px] text-muted"><KindBadge kind={r.kind} /><span className="truncate">de <b className="text-ink">{r.reviewer.name}</b> · {r.contact.name || r.contact.phone}</span></div>
                <div className="mt-1 text-[13px] text-ink line-clamp-2">{r.text}</div>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={hide}>Depois</Button>
          <Button onClick={() => ver(items.length === 1 ? items[0].id : undefined)}>Ver agora</Button>
        </div>
      </div>
    </Modal>
  );
}
