'use client';
import { CheckCircle2, Mail, MailOpen, Maximize2, Star } from 'lucide-react';
import type { KanbanCard as Card, KanbanColumn } from '@atendo/shared';
import { Avatar } from '@/components/chat/Avatar';
import { SeloEspera, formatTime } from '@/components/chat/ConversationList';
import { cn, formatPreview, readableColor } from '@/lib/utils';
import { formatPhone } from '@/components/ui/PhoneInput';

/**
 * Card do atendimento. Duplo clique (ou o botão, no celular) abre o mini-chat; clicar numa
 * pílula que é etapa do Kanban a promove a principal e o card muda de coluna. Os ícones do canto
 * (não lida / encerrar / abrir) só aparecem ao passar o mouse — no celular ficam sempre à vista.
 */
export function KanbanCard({ card, primary, agora, dragging, onOpen, onPromote, onEncerrar, onAlternarLida }: {
  card: Card;
  primary?: KanbanColumn;
  agora: number;
  dragging: boolean;
  onOpen: () => void;
  onPromote: (tagId: string) => void;
  /** encerrar sem abrir a conversa (mesmo modal do chat) */
  onEncerrar: () => void;
  /** com não lidas: marca como lida; sem: "marcar como não lida" (lembrete, como no WhatsApp) */
  onAlternarLida: () => void;
}) {
  const nome = card.contact.name ?? formatPhone(card.contact.phone);
  // na coluna de uma tag permanente o card está ali pelo contato (📌), não por etapa do atendimento
  const pelaPessoa = primary?.kind === 'permanent';
  return (
    <div
      onDoubleClick={onOpen}
      className={cn('group rounded-xl bg-panel border border-line p-2.5 select-none shadow-sm', dragging && 'shadow-lg ring-2 ring-accent/40 rotate-1')}
      style={primary ? { borderLeft: `3px ${pelaPessoa ? 'dashed' : 'solid'} ${primary.color}` } : undefined}
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
        <div className="flex items-center gap-0.5 -mr-1 -mt-0.5 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity" onDoubleClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={onAlternarLida} className="text-faint hover:text-ink p-0.5" title={card.unreadCount > 0 ? 'Marcar como lida' : 'Marcar como não lida'} aria-label={`${card.unreadCount > 0 ? 'Marcar como lida' : 'Marcar como não lida'}: ${nome}`}>
            {card.unreadCount > 0 ? <MailOpen size={13} /> : <Mail size={13} />}
          </button>
          <button type="button" onClick={onEncerrar} className="text-faint hover:text-ok p-0.5" title="Encerrar atendimento" aria-label={`Encerrar atendimento de ${nome}`}>
            <CheckCircle2 size={13} />
          </button>
          <button type="button" onClick={onOpen} className="text-faint hover:text-ink p-0.5" title="Abrir conversa" aria-label={`Abrir conversa de ${nome}`}>
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 mt-2">
        {primary && !pelaPessoa && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-white rounded-md px-1.5 py-0.5" style={{ background: primary.color }} title="Tag principal — etapa do atendimento">
            <Star size={8} className="fill-current" />{primary.name}
          </span>
        )}
        {primary && pelaPessoa && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border-2" style={{ borderColor: readableColor(primary.color), color: readableColor(primary.color) }} title="Tag permanente do contato — é a coluna dele no Kanban">📌 {primary.name}</span>
        )}
        {card.secondaryTags.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!t.isKanban}
            onClick={(e) => { e.stopPropagation(); onPromote(t.id); }}
            className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', t.isKanban ? 'hover:brightness-90 cursor-pointer' : 'cursor-default')}
            style={{ background: `color-mix(in srgb, ${readableColor(t.color)} 18%, transparent)`, color: readableColor(t.color) }}
            title={t.isKanban ? `Tornar "${t.name}" a principal (move o card)` : 'Esta tag não é etapa do Kanban'}
          >
            {t.name}
          </button>
        ))}
        {card.contactTags.filter((t) => !(pelaPessoa && t.id === primary?.id)).map((t) => (
          <span key={`c-${t.id}`} title="Tag do contato (permanente)" className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border" style={{ borderColor: readableColor(t.color), color: readableColor(t.color) }}>📌 {t.name}</span>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-faint">
        <span className="truncate flex-1">{card.number.label}{card.assignee ? ` · ${card.assignee.name}` : ' · Na fila'}</span>
        <SeloEspera desde={card.awaitingSince} encerrada={false} agora={agora} />
      </div>
    </div>
  );
}
