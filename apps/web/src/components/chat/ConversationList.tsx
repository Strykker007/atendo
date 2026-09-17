'use client';
import { useMemo, useState } from 'react';
import { Search, ChevronDown, Smartphone } from 'lucide-react';
import type { ConversationStatus } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { useConversations, useNumbers, useTags, type Conversation } from '@/lib/hooks';
import { TagPicker } from './TagPicker';
import { SkeletonConversations } from '@/components/ui/Skeleton';

const STATUS: { value: ConversationStatus; label: string }[] = [
  { value: 'waiting', label: 'Aguardando' },
  { value: 'in_progress', label: 'Em atendimento' },
  { value: 'closed', label: 'Encerrado' },
];

export function ConversationList() {
  const { numberId, setNumber, status, setStatus, tagIds, setTags, conversationId, setConversation } = useUI();
  const [search, setSearch] = useState('');
  const numbers = useNumbers();
  const tags = useTags();
  const conversations = useConversations({ status, numberId, tagIds, search: search || undefined });

  const selectedNumber = numbers.data?.find((n) => n.id === numberId);

  return (
    <>
      {/* Seletor de número (perfil): primeiro escolhe o número, depois vê as conversas dele */}
      <div className="h-14 px-3 flex items-center border-b border-surface-border">
        <div className="relative w-full">
          <select
            value={numberId ?? ''}
            onChange={(e) => setNumber(e.target.value || null)}
            className="w-full appearance-none rounded-lg bg-surface-muted pl-9 pr-8 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            <option value="">Todos os números</option>
            {numbers.data?.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} · {n.phone}
              </option>
            ))}
          </select>
          <Smartphone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          {selectedNumber && (
            <span className={cn('absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full ring-2 ring-white', selectedNumber.status === 'connected' ? 'bg-brand' : 'bg-amber-500')} />
          )}
        </div>
      </div>

      {/* Filtro principal, sempre visível */}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-3 rounded-lg bg-surface-muted p-1 text-xs font-medium">
          {STATUS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={cn('rounded-md py-1.5 transition-colors', status === s.value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Busca por contato + filtro de tags (abre a lista de tags ao focar) */}
      <div className="px-3 py-2 space-y-2 border-b border-surface-border">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar contato ou telefone"
            className="w-full rounded-lg bg-surface-muted pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>
        <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTags} placeholder="Filtrar por tag…" />
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {conversations.isLoading && <SkeletonConversations />}
        {conversations.isFetching && !conversations.isLoading && <div className="h-0.5 bg-brand/40 animate-pulse" />}
        {conversations.data?.length === 0 && <p className="p-6 text-sm text-gray-400 text-center">Nenhuma conversa aqui.</p>}
        {conversations.data?.map((c) => (
          <ConversationRow key={c.id} c={c} active={c.id === conversationId} onClick={() => setConversation(c.id)} showNumber={!numberId} />
        ))}
      </div>
    </>
  );
}

function ConversationRow({ c, active, onClick, showNumber }: { c: Conversation; active: boolean; onClick: () => void; showNumber: boolean }) {
  const name = c.contact.name ?? c.contact.phone;
  const time = useMemo(() => (c.lastMessageAt ? formatTime(c.lastMessageAt) : ''), [c.lastMessageAt]);
  return (
    <button onClick={onClick} className={cn('w-full text-left px-3 py-3 flex gap-3 border-b border-surface-border/60 hover:bg-surface-muted transition-colors', active && 'bg-brand-soft/60 hover:bg-brand-soft/60')}>
      <div className="w-11 h-11 rounded-full bg-gray-200 grid place-items-center text-gray-600 font-medium shrink-0">{name.slice(0, 1).toUpperCase()}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm truncate">{name}</span>
          <span className="text-[11px] text-gray-400 shrink-0">{time}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-xs text-gray-500 truncate">{c.lastMessagePreview ?? '—'}</span>
          {c.unreadCount > 0 && <span className="text-[10px] bg-brand text-white rounded-full px-1.5 py-0.5 min-w-5 text-center shrink-0">{c.unreadCount}</span>}
        </div>
        {(c.tags.length > 0 || showNumber) && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {showNumber && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{c.number.label}</span>}
            {c.tags.map(({ tag }) => (
              <span key={tag.id} className="text-[10px] px-1.5 py-0.5 rounded text-white" style={{ background: tag.color }}>
                {tag.name}
              </span>
            ))}
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
