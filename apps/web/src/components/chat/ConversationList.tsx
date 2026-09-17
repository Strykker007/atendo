'use client';
import { useMemo, useState } from 'react';
import { Search, ChevronDown, ShieldCheck, QrCode } from 'lucide-react';
import type { ConversationStatus } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { useConversations, useConversationCounts, useNumbers, useTags, useMe, useAgents, type Conversation } from '@/lib/hooks';
import { avatarStyle, initialOf } from '@/lib/avatar';
import { TagPicker } from './TagPicker';
import { OriginBadge, ORIGIN_META } from './OriginBadge';
import type { ConversationOrigin } from '@/lib/hooks';
import { SkeletonConversations } from '@/components/ui/Skeleton';

/** Semáforo: cada status tem cor (texto/faixa) e fundo suave. */
export const STATUS_META: Record<ConversationStatus, { label: string; short: string; color: string; soft: string; bar: string }> = {
  waiting: { label: 'Aguardando atendimento', short: 'Aguardando', color: 'text-wait', soft: 'bg-wait-soft', bar: 'bg-wait' },
  in_progress: { label: 'Em atendimento', short: 'Atendendo', color: 'text-prog', soft: 'bg-prog-soft', bar: 'bg-prog' },
  closed: { label: 'Encerrado', short: 'Encerrado', color: 'text-done', soft: 'bg-done-soft', bar: 'bg-done' },
};
const ORDER: ConversationStatus[] = ['waiting', 'in_progress', 'closed'];

export function ConversationList() {
  const { numberId, setNumber, status, setStatus, tagIds, setTags, origin, setOrigin, assigneeId, setAssignee, conversationId, setConversation } = useUI();
  const me = useMe();
  const isAdmin = me.data ? me.data.role !== 'agent' : false;
  const agents = useAgents();
  const [search, setSearch] = useState('');
  const numbers = useNumbers();
  const tags = useTags();
  const counts = useConversationCounts(numberId);
  const conversations = useConversations({ status, numberId, tagIds, origin, search: search || undefined, assigneeId: isAdmin && assigneeId ? (assigneeId === 'me' ? me.data?.id : assigneeId) : undefined });
  const selectedNumber = numbers.data?.find((n) => n.id === numberId);

  return (
    <>
      {/* Seletor de número (perfil): primeiro escolhe o número, depois vê as conversas dele */}
      <div className="h-12 px-2.5 flex items-center border-b border-line">
        <div className="relative w-full">
          <select
            value={numberId ?? ''}
            onChange={(e) => setNumber(e.target.value || null)}
            className="w-full appearance-none rounded-lg bg-field text-ink pl-8 pr-24 py-1.5 text-[12.5px] font-display font-semibold focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <option value="">Todos os números</option>
            {numbers.data?.map((n) => (
              <option key={n.id} value={n.id}>{n.label} · +{n.phone}</option>
            ))}
          </select>
          <span className={cn('absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ring-[3px]', selectedNumber ? (selectedNumber.status === 'connected' ? 'bg-ok ring-ok/25' : 'bg-warn ring-warn/25') : 'bg-faint ring-line')} />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
            {selectedNumber && (
              <span className={cn('inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5', selectedNumber.provider === 'meta' ? 'bg-meta-soft text-meta-ink' : 'bg-evo-soft text-evo-ink')}>
                {selectedNumber.provider === 'meta' ? <ShieldCheck size={10} /> : <QrCode size={10} />}
                {selectedNumber.provider === 'meta' ? 'Oficial' : 'QR'}
              </span>
            )}
            <ChevronDown size={15} className="text-faint" />
          </div>
        </div>
      </div>

      {/* Filtro principal com contadores */}
      <div className="px-2.5 pt-2">
        <div className="grid grid-cols-3 rounded-lg bg-field p-1 text-[11.5px] font-semibold">
          {ORDER.map((s) => {
            const m = STATUS_META[s];
            const n = counts.data?.[s];
            const on = status === s;
            // atendente comum só vê as próprias em atendimento: o rótulo diz isso
            const label = s === 'in_progress' && !isAdmin ? 'Minhas' : m.short;
            return (
              <button key={s} onClick={() => setStatus(s)} className={cn('rounded-md py-1 transition-colors flex items-center justify-center gap-1', on ? 'bg-side text-white shadow-sm' : 'text-muted hover:text-ink')}>
                {label}
                {n !== undefined && <span className={cn('tnum text-[10px] font-bold rounded-full px-1.5 min-w-[18px]', on ? 'bg-white/20 text-white' : cn(m.soft, m.color))}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Busca por contato + filtro de tags */}
      <div className="px-2.5 py-1.5 space-y-1.5 border-b border-line">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar contato ou telefone" className="w-full rounded-lg bg-field text-ink placeholder:text-faint pl-8 pr-3 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/40" />
        </div>
        <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTags} placeholder="Filtrar por tag…" />
        {/* admin em "Atendendo": escolher de quem ver */}
        {isAdmin && status === 'in_progress' && (
          <select value={assigneeId ?? ''} onChange={(e) => setAssignee(e.target.value || null)} className="w-full rounded-lg bg-field text-ink px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-accent/40">
            <option value="">Todos os atendentes ({counts.data?.in_progress_all ?? 0})</option>
            <option value="me">Só as minhas ({counts.data?.in_progress_mine ?? 0})</option>
            {agents.data?.filter((a) => a.id !== me.data?.id && a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {/* origem do lead — chips pequenos, um clique liga/desliga */}
        <div className="flex flex-wrap gap-1">
          {(['ad', 'link', 'post', 'organic'] as ConversationOrigin[]).map((o) => (
            <button key={o} onClick={() => setOrigin(origin === o ? null : o)} className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-md border transition-colors', origin === o ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>
              {ORIGIN_META[o].label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {conversations.isLoading && <SkeletonConversations />}
        {conversations.isFetching && !conversations.isLoading && <div className="h-0.5 bg-accent/40 animate-pulse" />}
        {conversations.data?.length === 0 && (
          <div className="p-8 text-center">
            <div className={cn('mx-auto w-10 h-10 rounded-full grid place-items-center mb-2', STATUS_META[status].soft, STATUS_META[status].color)}>0</div>
            <p className="text-sm text-muted">Nenhuma conversa em <b className="text-ink">{STATUS_META[status].short.toLowerCase()}</b>.</p>
          </div>
        )}
        {conversations.data?.map((c) => (
          <ConversationRow key={c.id} c={c} active={c.id === conversationId} onClick={() => setConversation(c.id)} showNumber={!numberId} />
        ))}
      </div>
    </>
  );
}

function ConversationRow({ c, active, onClick, showNumber }: { c: Conversation; active: boolean; onClick: () => void; showNumber: boolean }) {
  const name = c.contact.name ?? `+${c.contact.phone}`;
  const time = useMemo(() => (c.lastMessageAt ? formatTime(c.lastMessageAt) : ''), [c.lastMessageAt]);
  const m = STATUS_META[c.status];
  return (
    <button onClick={onClick} className={cn('relative w-full text-left pl-3.5 pr-2.5 py-2 flex gap-2.5 border-b border-line hover:bg-field transition-colors', active && 'bg-accent-soft hover:bg-accent-soft')}>
      {/* faixa de status (semáforo) */}
      <span className={cn('absolute left-0 top-0 bottom-0 w-[5px]', m.bar)} aria-hidden />
      <div className="w-9 h-9 rounded-lg grid place-items-center font-display font-semibold text-[14px] shrink-0" style={avatarStyle(c.contact.phone)}>{initialOf(name)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-[13px] truncate', c.unreadCount > 0 ? 'font-bold text-ink' : 'font-semibold text-ink')}>{name}</span>
          <span className="tnum text-[10.5px] text-faint shrink-0 font-mono">{time}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className={cn('text-xs truncate', c.unreadCount > 0 ? 'text-ink' : 'text-muted')}>{c.lastMessagePreview ?? '—'}</span>
          {c.unreadCount > 0 && <span className="tnum text-[10px] font-bold bg-accent text-white rounded-full px-1.5 py-0.5 min-w-[20px] text-center shrink-0">{c.unreadCount}</span>}
        </div>
        {(c.tags.length > 0 || showNumber || c.assignee || c.origin !== 'organic') && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            <OriginBadge origin={c.origin} data={c.originData} />
            {showNumber && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-field text-muted font-medium">{c.number.label}</span>}
            {c.tags.map(({ tag }) => (
              <span key={tag.id} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background: `color-mix(in srgb, ${tag.color} 18%, transparent)`, color: tag.color }}>{tag.name}</span>
            ))}
            {c.assignee && c.status === 'in_progress' && <span className="ml-auto text-[10px] text-faint truncate">↳ {c.assignee.name}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
