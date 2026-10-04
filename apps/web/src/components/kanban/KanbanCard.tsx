'use client';
import { Maximize2, Star } from 'lucide-react';
import type { KanbanCard as Card, KanbanColumn } from '@atendo/shared';
import { Avatar } from '@/components/chat/Avatar';
import { SeloEspera, formatTime } from '@/components/chat/ConversationList';
import { cn, formatPreview } from '@/lib/utils';

/**
 * Card do atendimento. Duplo clique (ou o botão, no celular) abre o mini-chat; clicar numa
 * pílula que é etapa do Kanban a promove a principal e o card muda de coluna.
 */
export function KanbanCard({ card, primary, agora, dragging, onOpen, onPromote }: {
  card: Card;
  primary?: KanbanColumn;
  agora: number;
  dragging: boolean;
  onOpen: () => void;
  onPromote: (tagId: string) => void;
}) {
  const nome = card.contact.name ?? `+${card.contact.phone}`;
  return (
    <div
      onDoubleClick={onOpen}
      className={cn('group rounded-xl bg-panel border border-line p-2.5 select-none shadow-sm', dragging && 'shadow-lg ring-2 ring-accent/40 rotate-1')}
      style={primary ? { borderLeft: `3px solid ${primary.color}` } : undefined}
    >
      <div className="flex items-start gap-2">
        <Avatar name={nome} phone={card.contact.phone} src={card.contact.avatarUrl} className="w-8 h-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[13px] text-ink truncate flex-1">{nome}</span>
            {card.lastMessageAt && <span className="text-[10px] text-faint tnum shrink-0">{formatTime(card.lastMessageAt)}</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-xs text-muted truncate flex-1">{formatPreview(card.lastMessagePreview)}</p>
            {card.unreadCount > 0 && <span className="text-[10px] font-bold text-white bg-accent rounded-full min-w-4 h-4 px-1 grid place-items-center tnum">{card.unreadCount}</span>}
          </div>
        </div>
        <button onClick={onOpen} className="md:opacity-0 md:group-hover:opacity-100 text-faint hover:text-ink p-0.5 -mr-1 -mt-0.5" title="Abrir conversa">
          <Maximize2 size={13} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 mt-2">
        {primary && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-white rounded-md px-1.5 py-0.5" style={{ background: primary.color }} title="Tag principal — etapa no Kanban">
            <Star size={8} className="fill-current" />{primary.name}
          </span>
        )}
        {card.secondaryTags.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!t.isKanban}
            onClick={(e) => { e.stopPropagation(); onPromote(t.id); }}
            className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', t.isKanban ? 'hover:brightness-90 cursor-pointer' : 'cursor-default')}
            style={{ background: `color-mix(in srgb, ${t.color} 18%, transparent)`, color: t.color }}
            title={t.isKanban ? `Tornar "${t.name}" a principal (move o card)` : 'Esta tag não é etapa do Kanban'}
          >
            {t.name}
          </button>
        ))}
        {card.contactTags.map((t) => (
          <span key={`c-${t.id}`} title="Tag do contato (permanente)" className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border" style={{ borderColor: t.color, color: t.color }}>📌 {t.name}</span>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-faint">
        <span className="truncate flex-1">{card.number.label}{card.assignee ? ` · ${card.assignee.name}` : ' · Na fila'}</span>
        <SeloEspera desde={card.awaitingSince} encerrada={false} agora={agora} />
      </div>
    </div>
  );
}
