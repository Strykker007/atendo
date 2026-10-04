'use client';
import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { messagePreview } from '@atendo/shared';
import { Modal, inputCls, btnPrimary, btnGhost } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useConversations, useForwardMessage, type Conversation, type Message } from '@/lib/hooks';
import { Avatar } from './Avatar';

/** Mesmo limite do WhatsApp (e da API): até 5 conversas por encaminhamento. */
const MAX = 5;

/**
 * Escolher para quais conversas encaminhar. Lista as conversas ativas (em atendimento e na
 * fila) — encerrada exige reabrir, e encaminhar não deveria reabrir atendimento por tabela.
 */
export function ForwardModal({ message, onClose }: { message: Message; onClose: () => void }) {
  const [busca, setBusca] = useState('');
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const filtro = { numberId: null, tagIds: [], search: busca.trim() || undefined };
  const emAtendimento = useConversations({ ...filtro, status: 'in_progress' });
  const naFila = useConversations({ ...filtro, status: 'waiting' });
  const encaminhar = useForwardMessage();

  const conversas = useMemo(() => {
    const todas = [...(emAtendimento.data ?? []), ...(naFila.data ?? [])].filter((c) => c.id !== message.conversationId);
    return [...new Map(todas.map((c) => [c.id, c])).values()];
  }, [emAtendimento.data, naFila.data, message.conversationId]);
  const carregando = emAtendimento.isLoading || naFila.isLoading;

  function alternar(id: string) {
    setEscolhidas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : atual.length >= MAX ? atual : [...atual, id]));
  }

  async function enviar() {
    try {
      const r = await encaminhar.mutateAsync({ conversationId: message.conversationId, messageId: message.id, targetConversationIds: escolhidas });
      if (r.sent.length) toast.ok(r.sent.length === 1 ? 'Mensagem encaminhada' : `Encaminhada para ${r.sent.length} conversas`);
      if (r.failed.length) {
        const nome = (id: string) => { const c = conversas.find((x) => x.id === id); return c?.contact.name ?? c?.contact.phone ?? 'conversa'; };
        toast.err(new Error(r.failed.map((f) => `${nome(f.conversationId)}: ${f.error}`).join(' · ')));
      }
      if (!r.failed.length) onClose();
      else setEscolhidas(r.failed.map((f) => f.conversationId));
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Encaminhar mensagem">
      <div className="space-y-3">
        <div className="rounded-lg bg-field px-3 py-2 text-xs text-muted line-clamp-2 break-words">{messagePreview(message)}</div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone" className={cn(inputCls, 'pl-8')} />
        </div>
        <ul className="max-h-72 overflow-y-auto -mx-1">
          {carregando && <li className="px-2 py-3 text-sm text-muted">Carregando conversas…</li>}
          {!carregando && !conversas.length && <li className="px-2 py-3 text-sm text-muted">Nenhuma conversa ativa encontrada.</li>}
          {conversas.map((c) => <Linha key={c.id} c={c} marcada={escolhidas.includes(c.id)} bloqueada={!escolhidas.includes(c.id) && escolhidas.length >= MAX} onClick={() => alternar(c.id)} />)}
        </ul>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-faint">{escolhidas.length}/{MAX} selecionadas</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>Cancelar</button>
            <button type="button" onClick={enviar} disabled={!escolhidas.length || encaminhar.isPending} className={btnPrimary}>{encaminhar.isPending ? 'Encaminhando…' : 'Encaminhar'}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Linha({ c, marcada, bloqueada, onClick }: { c: Conversation; marcada: boolean; bloqueada: boolean; onClick: () => void }) {
  const nome = c.contact.name ?? c.contact.phone;
  return (
    <li>
      <button type="button" onClick={onClick} disabled={bloqueada} className={cn('w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-field disabled:opacity-50', marcada && 'bg-accent-soft hover:bg-accent-soft')}>
        <Avatar name={nome} phone={c.contact.phone} src={c.contact.avatarUrl} className="w-8 h-8 text-[12px]" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink truncate">{nome}</span>
          <span className="block text-[11px] text-muted truncate">{c.number.label}{c.assignee ? ` · ${c.assignee.name}` : ' · na fila'}</span>
        </span>
        <span className={cn('grid place-items-center w-5 h-5 rounded-full border shrink-0', marcada ? 'bg-accent border-accent text-white' : 'border-line')}>{marcada && <Check size={12} />}</span>
      </button>
    </li>
  );
}
