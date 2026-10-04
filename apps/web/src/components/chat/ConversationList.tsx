'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown, ShieldCheck, QrCode, CheckSquare, Square, X, Clock, SlidersHorizontal, Star, BotOff } from 'lucide-react';
import type { ConversationStatus } from '@atendo/shared';
import { cn, formatPreview } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { useConversations, useConversationCounts, useNumbers, useTags, useMe, useAgents, botPaused, type Conversation, type OrdemConversas } from '@/lib/hooks';
import { Avatar } from './Avatar';
import { TagPicker } from './TagPicker';
import { OriginBadge, ORIGIN_META } from './OriginBadge';
import { ChannelBadge, channelColor } from './ChannelBadge';
import type { ConversationOrigin } from '@/lib/hooks';
import { SkeletonConversations } from '@/components/ui/Skeleton';
import { BulkCloseModal } from './BulkCloseModal';
import { Button } from '@/components/ui/Button';
import { usePersistedState } from '@/lib/persisted';
import { useCan } from '@/lib/hooks';

/** Semáforo: cada status tem cor (texto/faixa) e fundo suave. */
export const STATUS_META: Record<ConversationStatus, { label: string; short: string; color: string; soft: string; bar: string }> = {
  waiting: { label: 'Aguardando atendimento', short: 'Aguardando', color: 'text-wait', soft: 'bg-wait-soft', bar: 'bg-wait' },
  in_progress: { label: 'Em atendimento', short: 'Atendendo', color: 'text-prog', soft: 'bg-prog-soft', bar: 'bg-prog' },
  closed: { label: 'Encerrado', short: 'Encerrado', color: 'text-done', soft: 'bg-done-soft', bar: 'bg-done' },
};
const ORDER: ConversationStatus[] = ['waiting', 'in_progress', 'closed'];

/**
 * Relógio da lista: um intervalo só, no pai, em vez de um por linha.
 *
 * Sem isto o selo de espera congela no valor que tinha quando a lista chegou — o painel fica
 * aberto o dia inteiro, e "5min" ainda apareceria duas horas depois, que é pior do que não
 * mostrar nada.
 */
export function useMinuto() {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

export function ConversationList() {
  const { numberId, setNumber, status, setStatus, tagIds, setTags, origin, setOrigin, assigneeId, setAssignee, conversationId, setConversation } = useUI();
  const me = useMe();
  // quem vê a fila da equipe é decidido pela PERMISSÃO, não pelo papel: é isso que permite um
  // "atendente líder" enxergar a equipe, e um gerente com o acesso retirado deixar de ver
  const isAdmin = useCan('conversations.view_all');
  const agents = useAgents();
  const [search, setSearch] = useState('');
  const numbers = useNumbers();
  const tags = useTags();
  const counts = useConversationCounts(numberId);
  const agora = useMinuto();
  /**
   * Filtros escondidos atrás do ícone.
   *
   * Busca e os três status são o que se usa o tempo todo; tag, origem, ordem e atendente são
   * ajuste ocasional e ocupavam quatro faixas fixas no alto da lista — espaço que a fila de
   * conversas precisa mais. O ponto no ícone avisa quando há filtro ligado, senão esconder
   * vira armadilha: a lista some e ninguém lembra por quê.
   */
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [ordem, setOrdem] = usePersistedState<OrdemConversas>('ordem-conversas', 'recent');
  const [selecionando, setSelecionando] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [encerrando, setEncerrando] = useState(false);
  const conversations = useConversations({ status, numberId, tagIds, origin, sort: status === 'closed' ? 'recent' : ordem, search: search || undefined, assigneeId: isAdmin && assigneeId ? (assigneeId === 'me' ? me.data?.id : assigneeId) : undefined });
  const selectedNumber = numbers.data?.find((n) => n.id === numberId);
  const filtrosAtivos = (tagIds.length ? 1 : 0) + (origin ? 1 : 0) + (assigneeId ? 1 : 0) + (ordem !== 'recent' ? 1 : 0);

  const visiveis = conversations.data ?? [];
  // trocar de filtro limpa a seleção: encerrar em massa o que saiu da tela seria fechar no
  // escuro, e é exatamente o tipo de erro que não dá para desfazer em trinta conversas
  useEffect(() => { setMarcados([]); setSelecionando(false); }, [status, numberId, origin, assigneeId]);
  const marcadosVisiveis = marcados.filter((id) => visiveis.some((c) => c.id === id));
  const todosMarcados = visiveis.length > 0 && marcadosVisiveis.length === visiveis.length;
  const alternar = (id: string) => setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  function sair() { setSelecionando(false); setMarcados([]); }

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
              <option key={n.id} value={n.id}>{n.label} · {n.phone.slice(-4)}</option>
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

      {/* Busca sempre à vista; o resto dos filtros atrás do ícone */}
      <div className="px-2.5 py-1.5 space-y-1.5 border-b border-line">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar contato ou telefone" className="w-full rounded-lg bg-field text-ink placeholder:text-faint pl-8 pr-3 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          <button
            onClick={() => setFiltrosAbertos((v) => !v)}
            title={filtrosAtivos ? `${filtrosAtivos} filtro(s) ligado(s)` : 'Filtros'}
            className={cn('relative shrink-0 w-8 h-8 rounded-lg grid place-items-center', filtrosAbertos || filtrosAtivos ? 'bg-accent-soft text-accent-ink' : 'text-faint hover:text-ink hover:bg-field')}
          >
            <SlidersHorizontal size={15} />
            {filtrosAtivos > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-white text-[9px] font-bold grid place-items-center tnum">{filtrosAtivos}</span>}
          </button>
        </div>
        {filtrosAbertos && (
        <>
        <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTags} placeholder="Filtrar por tag…" />
        {/* admin em "Atendendo": escolher de quem ver */}
        {isAdmin && status === 'in_progress' && (
          <select value={assigneeId ?? ''} onChange={(e) => setAssignee(e.target.value || null)} className="w-full rounded-lg bg-field text-ink px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-accent/40">
            <option value="">Todos os atendentes ({counts.data?.in_progress_all ?? 0})</option>
            <option value="me">Só as minhas ({counts.data?.in_progress_mine ?? 0})</option>
            {agents.data?.filter((a) => a.id !== me.data?.id && a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {/* Ordem da fila. Em "Encerrado" não existe espera, então só aparece nos abertos. */}
        {status !== 'closed' && (
          <div className="flex gap-1">
            {([['recent', 'Mais recentes'], ['waiting', 'Esperando há mais tempo']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setOrdem(id)}
                className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-md border transition-colors', ordem === id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* origem do lead — chips pequenos, um clique liga/desliga */}
        <div className="flex flex-wrap gap-1">
          {(['ad', 'link', 'post', 'organic'] as ConversationOrigin[]).map((o) => (
            <button key={o} onClick={() => setOrigin(origin === o ? null : o)} className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-md border transition-colors', origin === o ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>
              {ORIGIN_META[o].label}
            </button>
          ))}
        </div>
        {filtrosAtivos > 0 && (
          <button onClick={() => { setTags([]); setOrigin(null); setAssignee(null); setOrdem('recent'); }} className="text-[11px] text-accent-ink hover:underline">
            Limpar filtros
          </button>
        )}
        </>
        )}
      </div>

      {/* Seleção em massa. Fora de "Encerrado" — ali não há o que encerrar. */}
      {status !== 'closed' && (
        <div className="px-2.5 py-1.5 border-b border-line">
          {!selecionando ? (
            <button
              onClick={() => setSelecionando(true)}
              disabled={visiveis.length === 0}
              className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted hover:text-ink disabled:opacity-40"
            >
              <CheckSquare size={14} /> Selecionar
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setMarcados(todosMarcados ? [] : visiveis.map((c) => c.id))} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                {todosMarcados ? <CheckSquare size={14} className="text-accent" /> : <Square size={14} className="text-faint" />}
                Todos ({visiveis.length})
              </button>
              <span className="tnum text-[11px] text-muted ml-auto">{marcadosVisiveis.length} marcado(s)</span>
              <Button
                onClick={() => setEncerrando(true)}
                disabled={marcadosVisiveis.length === 0}
                className="h-7 px-2.5 text-[11.5px]"
              >
                Encerrar
              </Button>
              <button onClick={sair} className="p-1 rounded-md text-faint hover:text-ink hover:bg-field" title="Sair da seleção"><X size={15} /></button>
            </div>
          )}
        </div>
      )}

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
        {visiveis.map((c) => (
          <ConversationRow
            key={c.id}
            c={c}
            active={c.id === conversationId}
            onClick={() => (selecionando ? alternar(c.id) : setConversation(c.id))}
            agora={agora}
            selecionando={selecionando}
            marcado={marcados.includes(c.id)}
          />
        ))}
      </div>

      {encerrando && (
        <BulkCloseModal ids={marcadosVisiveis} onDone={sair} onClose={() => setEncerrando(false)} />
      )}
    </>
  );
}

function ConversationRow({ c, active, onClick, agora, selecionando, marcado }: { c: Conversation; active: boolean; onClick: () => void; agora: number; selecionando: boolean; marcado: boolean }) {
  const name = c.contact.name ?? `+${c.contact.phone}`;
  const time = useMemo(() => (c.lastMessageAt ? formatTime(c.lastMessageAt) : ''), [c.lastMessageAt]);
  const m = STATUS_META[c.status];
  return (
    <button onClick={onClick} className={cn('relative w-full text-left pl-3.5 pr-2.5 py-2 flex gap-2.5 border-b border-line hover:bg-field transition-colors', active && !selecionando && 'bg-accent-soft hover:bg-accent-soft', selecionando && marcado && 'bg-accent-soft')}>
      {/* faixa de status (semáforo) */}
      <span className={cn('absolute left-0 top-0 bottom-0 w-[5px]', m.bar)} aria-hidden />
      {/* faixa do canal: na borda direita porque a esquerda já é do semáforo de status */}
      <span className="absolute right-0 top-0 bottom-0 w-1" style={{ background: channelColor(c.number.color) }} title={`Canal: ${c.number.label}`} aria-hidden />
      {selecionando && (
        <span className="self-center shrink-0">
          {marcado ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} className="text-faint" />}
        </span>
      )}
      <Avatar name={name} phone={c.contact.phone} src={c.contact.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-[13px] truncate', c.unreadCount > 0 ? 'font-bold text-ink' : 'font-semibold text-ink')}>{botPaused(c) ? <span title="Robô pausado nesta conversa" className="mr-1 inline-flex align-[-1px] text-warn-ink"><BotOff size={12} /></span> : c.activeFlowRunId && <span title="Em automação" className="mr-1">🤖</span>}{name}</span>
          {/* o canal fica aqui, na linha da hora: embaixo, junto das tags, ele acrescentava uma
              faixa inteira — a lista dobrava de altura. Sempre visível: é por ele que a resposta sai */}
          <ChannelBadge channel={c.number} phone="none" className="shrink-0 max-w-[120px]" />
          <span className="tnum text-[10.5px] text-faint shrink-0 font-mono">{time}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className={cn('text-xs truncate', c.unreadCount > 0 ? 'text-ink' : 'text-muted')}>{formatPreview(c.lastMessagePreview)}</span>
          <SeloEspera desde={c.awaitingSince} encerrada={c.status === 'closed'} agora={agora} />
          {c.unreadCount > 0 && <span className="tnum text-[10px] font-bold bg-accent text-white rounded-full px-1.5 py-0.5 min-w-[20px] text-center shrink-0">{c.unreadCount}</span>}
        </div>
        {(c.tags.length > 0 || (c.contact.tags?.length ?? 0) > 0 || c.assignee || c.origin !== 'organic') && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            <OriginBadge origin={c.origin} data={c.originData} />
            {/* principal (etapa no Kanban) primeiro, cheia e com estrela; as outras em tom claro */}
            {[...c.tags].sort((x, y) => Number(!!y.isPrimary) - Number(!!x.isPrimary)).map(({ tag, isPrimary }) => isPrimary ? (
              <span key={tag.id} title="Tag principal — etapa no Kanban" className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-white" style={{ background: tag.color }}><Star size={8} className="fill-current" />{tag.name}</span>
            ) : (
              <span key={tag.id} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background: `color-mix(in srgb, ${tag.color} 18%, transparent)`, color: tag.color }}>{tag.name}</span>
            ))}
            {(c.contact.tags ?? []).map(({ tag }) => (
              <span key={`c-${tag.id}`} title="Tag do contato (permanente)" className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border" style={{ borderColor: tag.color, color: tag.color }}>📌 {tag.name}</span>
            ))}
            {c.assignee && c.status === 'in_progress' && <span className="ml-auto text-[10px] text-faint truncate">↳ {c.assignee.name}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * Há quanto tempo o contato espera resposta.
 *
 * É a informação que decide o que atender agora, e ela não está em lugar nenhum da tela: a
 * hora da última mensagem diz *quando* falaram, não *há quanto tempo ninguém responde*. A cor
 * sobe junto com o atraso — o olho precisa achar os atrasados sem ler número por número.
 *
 * Conversa já respondida (ou encerrada) não mostra nada: selo em tudo vira ruído e ninguém
 * mais repara nos vermelhos.
 */
export function SeloEspera({ desde, encerrada, agora }: { desde: string | null; encerrada: boolean; agora: number }) {
  if (!desde || encerrada) return null;
  const minutos = Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 60_000));
  const cor = minutos >= 60 ? 'bg-danger-soft text-danger' : minutos >= 15 ? 'bg-wait-soft text-wait' : 'bg-field text-muted';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-md px-1 py-0.5 shrink-0 tnum', cor)} title={`Sem resposta desde ${new Date(desde).toLocaleString('pt-BR')}`}>
      <Clock size={9} /> {duracaoCurta(minutos)}
    </span>
  );
}

/** "12min", "3h", "2d" — cabe ao lado da prévia sem empurrar nada. */
export function duracaoCurta(minutos: number) {
  if (minutos < 60) return `${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h`;
  return `${Math.floor(horas / 24)}d`;
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
