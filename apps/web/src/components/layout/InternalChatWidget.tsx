'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ArrowLeft, Check, ChevronDown, ChevronUp, MessagesSquare, Plus, Send, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import {
  internalMessagesInOrder, useCreateInternalChat, useInternalChats, useInternalMessages, useInternalUsers, useMarkInternalRead, useMe, useSendInternalMessage,
  type InternalChat,
} from '@/lib/hooks';

/**
/**
 * Estado do widget, por navegador: aberto/minimizado, canto onde está preso e conversa aberta.
 * Fica fora do `useUI` para não misturar com a tela de conversas.
 */
interface WidgetState {
  open: boolean;
  minimized: boolean;
  /** lateral em que o widget fica preso (trava magnética) */
  side: 'left' | 'right';
  /** altura do ponto de ancoragem (centro do botão redondo), em px; null = embaixo */
  y: number | null;
  chatId: string | null;
  set: (p: Partial<Omit<WidgetState, 'set'>>) => void;
}
const useWidget = create<WidgetState>()(persist(
  (set) => ({ open: false, minimized: false, side: 'right', y: null, chatId: null, set: (p) => set(p) }),
  {
    name: 'atendo-chat-interno',
    // v1: a posição livre (`pos`) virou lado + altura — a antiga é descartada
    version: 1,
    migrate: (s) => ({ ...(s as object), side: 'right', y: null }) as unknown as WidgetState,
    partialize: (s) => ({ open: s.open, minimized: s.minimized, side: s.side, y: s.y, chatId: s.chatId }),
  },
));

const W = 340;
const H = 480;
/** distância mínima da borda da tela */
const M = 12;
const BOLHA = 48;
const BARRA = 42;
/** abaixo disto é clique, não arrasto (trackpad sempre mexe um pouco ao clicar) */
const LIMIAR = 5;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
const iniciais = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
const hora = (d: string) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Tamanho da janela, atualizado ao redimensionar: o widget nunca fica fora da tela. */
function useViewport() {
  const [vp, setVp] = useState(() => (typeof window === 'undefined' ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return vp;
}

/**
 * Chat interno da equipe (docs/chat-interno.md): widget flutuante montado no shell, então
 * continua aberto (e na mesma conversa) ao trocar de página. Arrasta pelo cabeçalho ou pelo
 * botão redondo e, ao soltar, gruda na lateral mais próxima na altura em que foi solto. A janela
 * aberta é sempre encaixada inteira na tela: abre para cima quando o botão está na metade de
 * baixo e para baixo na metade de cima. O dono do sistema "entrando como" não é da equipe:
 * não vê o widget (audita pela tela de auditoria).
 */
export function InternalChatWidget() {
  const me = useMe();
  const habilitado = !!me.data?.tenantId && me.data.role !== 'super_admin' && !me.data.impersonatorId;
  const { open, minimized, side, y, chatId, set } = useWidget();
  const chats = useInternalChats(habilitado);
  const naoLidas = (chats.data ?? []).reduce((a, c) => a + (c.unread ?? 0), 0);
  const vp = useViewport();

  // tamanho do que está na tela: botão, barra minimizada ou janela (limitada ao tamanho da tela)
  const w = !open ? BOLHA : Math.min(W, vp.w - 2 * M);
  const h = !open ? BOLHA : minimized ? BARRA : Math.min(H, vp.h - 2 * M);
  // posição encaixada: lateral escolhida + altura da âncora, sempre dentro da tela
  const ancora = clamp(y ?? vp.h - M - BOLHA / 2, M + BOLHA / 2, vp.h - M - BOLHA / 2);
  const naMetadeDeBaixo = ancora > vp.h / 2;
  const encaixe = {
    left: side === 'left' ? M : vp.w - w - M,
    top: clamp(naMetadeDeBaixo ? ancora + BOLHA / 2 - h : ancora - BOLHA / 2, M, vp.h - h - M),
  };

  // arrasto: posição livre enquanto segura; ao soltar, trava na lateral mais próxima
  const [livre, setLivre] = useState<{ left: number; top: number } | null>(null);
  const arrasto = useRef<{ dx: number; dy: number; x0: number; y0: number; moveu: boolean } | null>(null);
  function iniciarArrasto(e: React.PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-no-drag]')) return;
    arrasto.current = { dx: e.clientX - encaixe.left, dy: e.clientY - encaixe.top, x0: e.clientX, y0: e.clientY, moveu: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function mover(e: React.PointerEvent) {
    const a = arrasto.current;
    if (!a) return;
    if (!a.moveu && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < LIMIAR) return;
    a.moveu = true;
    setLivre({ left: clamp(e.clientX - a.dx, M, vp.w - w - M), top: clamp(e.clientY - a.dy, M, vp.h - h - M) });
  }
  /** Solta: devolve se foi arrasto (true) ou clique (false). */
  function soltar() {
    const a = arrasto.current;
    arrasto.current = null;
    if (!a?.moveu || !livre) { setLivre(null); return false; }
    const centroY = livre.top + h / 2;
    set({
      side: livre.left + w / 2 < vp.w / 2 ? 'left' : 'right',
      // a âncora fica na borda do widget voltada para o lado da tela onde ele foi solto
      y: centroY > vp.h / 2 ? livre.top + h - BOLHA / 2 : livre.top + BOLHA / 2,
    });
    setLivre(null);
    return true;
  }
  const cancelar = () => { arrasto.current = null; setLivre(null); };

  if (!habilitado) return null;
  const pos = livre ?? encaixe;
  // anima só o encaixe; durante o arrasto acompanha o ponteiro sem atraso
  const estilo: React.CSSProperties = { left: pos.left, top: pos.top, transition: livre ? 'none' : 'left .2s ease, top .2s ease' };

  if (!open) {
    return (
      <div className="fixed z-[65] touch-none" style={estilo}>
        <button
          type="button"
          onPointerDown={iniciarArrasto}
          onPointerMove={mover}
          onPointerUp={() => { if (!soltar()) set({ open: true, minimized: false }); }}
          onPointerCancel={cancelar}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set({ open: true, minimized: false }); } }}
          className={cn('relative grid place-items-center w-12 h-12 rounded-full bg-accent text-white shadow-xl hover:opacity-95', livre ? 'cursor-grabbing' : 'cursor-pointer')}
          title="Chat interno da equipe (arraste para mudar de canto)"
          aria-label="Abrir chat interno"
        >
          <MessagesSquare size={20} />
          {naoLidas > 0 && <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold grid place-items-center tnum">{naoLidas > 99 ? '99+' : naoLidas}</span>}
        </button>
      </div>
    );
  }

  const aberta = chats.data?.find((c) => c.id === chatId) ?? null;
  return (
    <div className="fixed z-[65] flex flex-col rounded-2xl border border-line bg-panel shadow-2xl overflow-hidden" style={{ ...estilo, width: w, height: h }} role="dialog" aria-label="Chat interno">
      <div
        className={cn('flex items-center gap-2 px-3 bg-side text-white select-none touch-none shrink-0', livre ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ height: BARRA }}
        onPointerDown={iniciarArrasto}
        onPointerMove={mover}
        onPointerUp={() => { soltar(); }}
        onPointerCancel={cancelar}
      >
        {aberta && !minimized && (
          <button data-no-drag type="button" onClick={() => set({ chatId: null })} className="p-1 rounded hover:bg-white/10" aria-label="Voltar"><ArrowLeft size={15} /></button>
        )}
        <MessagesSquare size={15} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-sm font-semibold">{aberta && !minimized ? aberta.name : 'Chat da equipe'}</span>
        {naoLidas > 0 && minimized && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-[10px] font-bold grid place-items-center tnum">{naoLidas}</span>}
        <button data-no-drag type="button" onClick={() => set({ minimized: !minimized })} className="p-1 rounded hover:bg-white/10" aria-label={minimized ? 'Expandir' : 'Minimizar'}>
          {minimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button data-no-drag type="button" onClick={() => set({ open: false })} className="p-1 rounded hover:bg-white/10" aria-label="Fechar"><X size={15} /></button>
      </div>
      {!minimized && (aberta ? <ChatView chat={aberta} meId={me.data!.id} /> : <Home chats={chats.data ?? []} loading={chats.isLoading} onOpen={(id) => set({ chatId: id })} />)}
    </div>
  );
}

/** Lista de conversas + equipe (online primeiro) + novo grupo. */
function Home({ chats, loading, onOpen }: { chats: InternalChat[]; loading: boolean; onOpen: (id: string) => void }) {
  const [aba, setAba] = useState<'chats' | 'equipe' | 'grupo'>(chats.length ? 'chats' : 'equipe');
  const users = useInternalUsers(true);
  const create = useCreateInternalChat();
  const [marcados, setMarcados] = useState<string[]>([]);
  const [nome, setNome] = useState('');

  async function abrirCom(userIds: string[], name?: string) {
    try {
      const c = await create.mutateAsync({ userIds, name });
      setMarcados([]); setNome('');
      onOpen(c.id);
    } catch (err) { toast.err(err); }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="grid grid-cols-3 gap-1 m-2 rounded-lg bg-field p-1 text-[11.5px] font-semibold">
        {([['chats', 'Conversas'], ['equipe', 'Equipe'], ['grupo', 'Novo grupo']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setAba(id)} className={cn('rounded-md py-1.5', aba === id ? 'bg-side text-white' : 'text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {aba === 'chats' && (
          loading ? <p className="p-4 text-sm text-faint">Carregando…</p> : !chats.length ? (
            <p className="p-4 text-sm text-muted">Nenhuma conversa ainda. Escolha alguém em <b>Equipe</b>.</p>
          ) : (
            <ul className="divide-y divide-line">
              {chats.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpen(c.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field">
                    <span className="w-8 h-8 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[11px] font-bold shrink-0">{c.isGroup ? <Users size={14} /> : iniciais(c.name)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1"><span className="truncate text-sm font-medium text-ink">{c.name}</span>{c.lastMessageAt && <span className="ml-auto text-[10.5px] text-faint shrink-0">{hora(c.lastMessageAt)}</span>}</span>
                      <span className="block truncate text-[12px] text-muted">{c.lastMessagePreview ?? (c.isGroup ? `${c.members.length} membros` : 'Sem mensagens')}</span>
                    </span>
                    {!!c.unread && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center tnum">{c.unread}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {(aba === 'equipe' || aba === 'grupo') && (
          users.isLoading ? <p className="p-4 text-sm text-faint">Carregando…</p> : !users.data?.length ? (
            <p className="p-4 text-sm text-muted">Ninguém mais na equipe.</p>
          ) : (
            <ul className="divide-y divide-line">
              {users.data.map((u) => {
                const on = marcados.includes(u.id);
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      disabled={create.isPending}
                      onClick={() => (aba === 'equipe' ? void abrirCom([u.id]) : setMarcados((m) => (on ? m.filter((x) => x !== u.id) : [...m, u.id])))}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field"
                    >
                      <span className="relative w-8 h-8 rounded-full bg-field text-muted grid place-items-center text-[11px] font-bold shrink-0">
                        {iniciais(u.name)}
                        <span className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-panel', u.online ? 'bg-ok' : 'bg-faint')} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm text-ink">{u.name}</span>
                        <span className="block text-[11.5px] text-faint">{u.online ? 'Online agora' : 'Offline'}</span>
                      </span>
                      {aba === 'grupo' && <span className={cn('w-5 h-5 rounded border grid place-items-center', on ? 'bg-accent border-accent text-white' : 'border-line')}>{on && <Check size={12} />}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>
      {aba === 'grupo' && (
        <form className="flex gap-2 p-2 border-t border-line" onSubmit={(e) => { e.preventDefault(); if (marcados.length && nome.trim()) void abrirCom(marcados, nome.trim()); }}>
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder={`Nome do grupo (${marcados.length} selecionado${marcados.length === 1 ? '' : 's'})`} className="flex-1 min-w-0 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40" />
          <button type="submit" disabled={!marcados.length || !nome.trim() || create.isPending} className="rounded-lg bg-accent px-3 text-white disabled:opacity-50" aria-label="Criar grupo"><Plus size={15} /></button>
        </form>
      )}
    </div>
  );
}

/** Conversa aberta: histórico (rola para cima para trazer as anteriores) + campo de envio. */
function ChatView({ chat, meId }: { chat: InternalChat; meId: string }) {
  const msgs = useInternalMessages(chat.id);
  const lista = useMemo(() => internalMessagesInOrder(msgs.data), [msgs.data]);
  const send = useSendInternalMessage(chat.id);
  const read = useMarkInternalRead();
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);
  const ultima = lista[lista.length - 1]?.id;

  // mensagem nova: desce e marca como lida (a conversa está aberta na frente da pessoa)
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
    if (ultima && chat.unread) read.mutate(chat.id);
  }, [ultima]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar() {
    const t = texto.trim();
    if (!t) return;
    setTexto('');
    try { await send.mutateAsync(t); } catch (err) { setTexto(t); toast.err(err); }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {chat.isGroup && <p className="px-3 py-1.5 text-[11.5px] text-faint border-b border-line truncate">{chat.members.map((m) => m.name).join(', ')}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 py-2 space-y-1.5">
        {msgs.hasNextPage && (
          <button type="button" onClick={() => void msgs.fetchNextPage()} disabled={msgs.isFetchingNextPage} className="mx-auto block text-[12px] text-accent hover:underline">
            {msgs.isFetchingNextPage ? 'Carregando…' : 'Mensagens anteriores'}
          </button>
        )}
        {msgs.isLoading && <p className="text-sm text-faint">Carregando…</p>}
        {!msgs.isLoading && !lista.length && <p className="text-sm text-muted text-center pt-6">Comece a conversa. Tudo aqui fica registrado para auditoria.</p>}
        {lista.map((m) => {
          const minha = m.authorId === meId;
          return (
            <div key={m.id} className={cn('flex flex-col max-w-[85%]', minha ? 'ml-auto items-end' : 'items-start')}>
              {chat.isGroup && !minha && <span className="text-[10.5px] text-muted px-1">{m.authorName}</span>}
              <div className={cn('rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words', minha ? 'bg-accent text-white rounded-br-sm' : 'bg-field text-ink rounded-bl-sm')}>{m.text}</div>
              <span className="text-[10px] text-faint px-1">{hora(m.createdAt)}</span>
            </div>
          );
        })}
        <div ref={fim} />
      </div>
      <form className="flex items-end gap-2 p-2 border-t border-line" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
          rows={1}
          maxLength={4000}
          placeholder="Mensagem para a equipe"
          className="flex-1 min-w-0 max-h-28 resize-none rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <button type="submit" disabled={!texto.trim() || send.isPending} className="rounded-lg bg-accent p-2 text-white disabled:opacity-50" aria-label="Enviar"><Send size={15} /></button>
      </form>
    </div>
  );
}
