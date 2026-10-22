'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Headset, LogOut, Plus, Reply, Send, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import {
  internalMessagesInOrder, useAddInternalMembers, useCan, useCreateInternalChat, useDeleteInternalChat, useInternalChats, useInternalMessages, useInternalUsers, useMarkInternalRead, useMe,
  useOpenStaffChat, useOpenSupportChat, useRemoveInternalMember, useRenameInternalChat, useSendInternalMessage, useSupportChats, useSupportCounts, useStaffChats, useStaffUsers, useSupportTenants, useSupportTicketAction,
  type ChatScope, type InternalChat, type InternalMessage, type InternalUser, type SupportTicket, type SupportView,
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
const BOLHA = 56;
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
 * baixo e para baixo na metade de cima.
 *
 * Dois modos: a equipe do cliente vê só as conversas internas dela (o canal **Suporte** saiu do
 * widget do cliente em 19/10/2026); o dono do sistema (logado como ele mesmo) vê os canais de suporte de todos os clientes
 * (docs/chat-interno.md#suporte). "Entrando como" um cliente, o dono vê só o canal de suporte
 * daquele cliente — já aberto — e responde como Suporte.
 */
export function InternalChatWidget() {
  const me = useMe();
  const ehDono = me.data?.role === 'super_admin' && !me.data.impersonatorId;
  const ehEquipe = !!me.data?.tenantId && me.data.role !== 'super_admin' && !me.data.impersonatorId;
  /** dono "entrando como": usa as rotas do cliente, que devolvem só o canal de suporte */
  const entrandoComo = !!me.data?.tenantId && !!me.data.impersonatorId;
  const habilitado = ehDono || ehEquipe || entrandoComo;
  /** dono por marcação, na empresa dele: chat da equipe dele + Equipe do suporte (docs/donos-do-sistema.md) */
  const donoMarcado = ehEquipe && !!me.data?.systemOwner;
  const scope: ChatScope = ehDono ? 'support' : 'team';
  const titulo = ehDono ? 'Suporte aos clientes' : entrandoComo ? 'Suporte a este cliente' : 'Chat da equipe';
  const { open, minimized, side, y, chatId: chatSalvo, set } = useWidget();
  const chatsEquipe = useInternalChats(ehEquipe || entrandoComo);
  // `all` = todo canal com mensagem: é onde a conversa aberta é encontrada (as abas da fila são recortes)
  const chatsSuporte = useSupportChats('all', ehDono);
  const chats = ehDono ? chatsSuporte : chatsEquipe;
  // equipe do cliente: o widget é só comunicação interna — o canal Suporte não aparece (a API
  // ainda o devolve; "entrando como" o dono usa a mesma rota para abrir esse canal)
  const listaChats = ehEquipe ? chatsEquipe.data?.filter((c) => !c.isSupport) : chats.data;
  // dono: também a equipe do suporte (colegas super_admin) — docs/chat-interno.md#equipe-do-suporte
  const chatsStaff = useStaffChats(ehDono || donoMarcado);
  const naoLidas = [...(listaChats ?? []), ...(ehDono || donoMarcado ? chatsStaff.data ?? [] : [])].reduce((a, c) => a + (c.unread ?? 0), 0);
  const equipe = useInternalUsers(ehEquipe);
  const colegas = useStaffUsers(ehDono);
  // entrando como: a única conversa é o canal de suporte do cliente, aberto direto
  const chatId = entrandoComo ? chatsEquipe.data?.find((c) => c.isSupport)?.id ?? null : chatSalvo;
  const online = ((ehDono ? colegas.data : equipe.data) ?? []).filter((u) => u.online);
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
        <Launcher
          titulo={titulo}
          dono={ehDono || entrandoComo}
          naoLidas={naoLidas}
          online={online}
          side={side}
          arrastando={!!livre}
          onPointerDown={iniciarArrasto}
          onPointerMove={mover}
          onPointerUp={() => { if (!soltar()) set({ open: true, minimized: false }); }}
          onPointerCancel={cancelar}
          onOpen={() => set({ open: true, minimized: false })}
        />
      </div>
    );
  }

  const aberta = listaChats?.find((c) => c.id === chatId) ?? (ehDono || donoMarcado ? chatsStaff.data?.find((c) => c.id === chatId) : null) ?? null;
  const voltar = entrandoComo ? null : () => set({ chatId: null });
  return (
    <div className="fixed z-[65] flex flex-col rounded-2xl border border-line bg-panel shadow-2xl overflow-hidden" style={{ ...estilo, width: w, height: h }} role="dialog" aria-label="Chat interno">
      <div
        className={cn('flex items-center gap-2 px-3 bg-gradient-to-br from-accent to-accent-hover text-white select-none touch-none shrink-0 shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)]', livre ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ height: BARRA }}
        onPointerDown={iniciarArrasto}
        onPointerMove={mover}
        onPointerUp={() => {
          // clique (sem arrastar) em qualquer ponto da barra minimizada reabre; os botões dela
          // (`data-no-drag`) não iniciam o gesto, então não caem aqui
          const naBarra = !!arrasto.current;
          if (!soltar() && naBarra && minimized) set({ minimized: false });
        }}
        onPointerCancel={cancelar}
        title={minimized ? 'Clique para abrir (arraste para mudar de lado)' : undefined}
      >
        {aberta && !minimized && voltar && (
          <button data-no-drag type="button" onClick={voltar} className="p-1 rounded hover:bg-white/10" aria-label="Voltar"><ArrowLeft size={15} /></button>
        )}
        <ChatGlyph size={18} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-sm font-semibold">{aberta && !minimized ? aberta.name : titulo}</span>
        {naoLidas > 0 && minimized && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-[10px] font-bold grid place-items-center tnum">{naoLidas}</span>}
        <button data-no-drag type="button" onClick={() => set({ minimized: !minimized })} className="p-1 rounded hover:bg-white/10" aria-label={minimized ? 'Expandir' : 'Minimizar'}>
          {minimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button data-no-drag type="button" onClick={() => set({ open: false })} className="p-1 rounded hover:bg-white/10" aria-label="Fechar"><X size={15} /></button>
      </div>
      {!minimized && (aberta
        ? <ChatView chat={aberta} meId={me.data!.id} scope={aberta.isStaff ? 'staff' : entrandoComo ? 'support' : scope} api={aberta.isStaff ? 'staff' : entrandoComo ? 'team' : scope} onLeave={() => set({ chatId: null })} />
        : ehDono
          ? <OwnerHome staff={chatsStaff.data ?? []} onOpen={(id) => set({ chatId: id })} />
          : donoMarcado
            ? <TeamAndStaffHome chats={listaChats ?? []} staff={chatsStaff.data ?? []} loading={chats.isLoading} onOpen={(id) => set({ chatId: id })} />
            : <Home chats={listaChats ?? []} loading={chats.isLoading} onOpen={(id) => set({ chatId: id })} />)}
    </div>
  );
}

/**
 * Desenho do chat da equipe: dois balões sobrepostos — o de trás vazado, o da frente cheio com
 * os três pontos de "digitando" (animados quando há mensagem nova). Feito à mão em SVG para ter
 * identidade própria, em vez do ícone genérico da biblioteca.
 */
function ChatGlyph({ size = 26, className, vivo = false }: { size?: number; className?: string; vivo?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <path d="M13 7.5V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-.5v3.2a.6.6 0 0 1-1 .45L20.8 17" stroke="currentColor" strokeOpacity=".75" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10.5h13a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6.6l-4.6 3.7a.6.6 0 0 1-1-.47V24.5H6a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z" fill="currentColor" />
      {[8.6, 12.5, 16.4].map((cx, i) => (
        <circle key={cx} cx={cx} cy="17.5" r="1.45" className={cn('fill-accent', vivo && 'typing-dot')} style={vivo ? { animationDelay: `${i * 0.15}s`, transformBox: 'fill-box', transformOrigin: 'center' } : undefined} />
      ))}
    </svg>
  );
}

const MAX_ROSTOS = 3;

/**
 * Botão do chat fechado. Squircle com degradê da cor da marca, brilho interno e sombra colorida;
 * selo de não lidas com pulso; ponto verde quando há colega online. Ao passar o mouse, uma
 * etiqueta desliza para dentro da tela com quem está online agora (rostos sobrepostos).
 */
function Launcher({ titulo, dono, naoLidas, online, side, arrastando, onOpen, ...ponteiro }: {
  titulo: string;
  /** dono do sistema: a etiqueta fala de clientes, não de colegas online */
  dono: boolean;
  naoLidas: number;
  online: InternalUser[];
  side: 'left' | 'right';
  arrastando: boolean;
  onOpen: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  const rostos = online.slice(0, MAX_ROSTOS);
  return (
    <div className="group relative">
      <button
        type="button"
        {...ponteiro}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        className={cn(
          'relative grid place-items-center w-14 h-14 rounded-[20px] text-white',
          'bg-gradient-to-br from-accent to-accent-hover',
          'shadow-[0_10px_28px_-6px_color-mix(in_srgb,var(--accent)_55%,transparent),inset_0_1px_0_rgb(255_255_255/0.28),inset_0_-2px_0_rgb(0_0_0/0.12)]',
          'ring-1 ring-white/10 transition-transform duration-200 ease-out motion-reduce:transition-none',
          arrastando ? 'cursor-grabbing scale-105 rotate-3' : 'cursor-pointer hover:-translate-y-0.5 hover:scale-[1.04] active:scale-95',
        )}
        title={`${titulo} (arraste para mudar de lado)`}
        aria-label={`Abrir ${titulo.toLowerCase()}${naoLidas ? ` — ${naoLidas} não lida(s)` : ''}`}
      >
        {/* brilho de vidro na metade de cima */}
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[20px] bg-[radial-gradient(120%_85%_at_25%_0%,rgb(255_255_255/0.38),transparent_58%)]" />
        {dono
          ? <Headset size={26} strokeWidth={2.2} className="relative drop-shadow-[0_1px_1px_rgb(0_0_0/0.2)]" />
          : <ChatGlyph size={34} vivo={naoLidas > 0} className="relative drop-shadow-[0_1px_1px_rgb(0_0_0/0.2)]" />}

        {naoLidas > 0 && (
          <span className="absolute -top-1.5 -right-1.5">
            <span aria-hidden className="absolute inset-0 rounded-full bg-danger opacity-60 animate-ping motion-reduce:animate-none" />
            <span className="relative grid place-items-center min-w-[22px] h-[22px] px-1 rounded-full bg-danger text-white text-[11px] font-bold tnum ring-2 ring-panel shadow">{naoLidas > 99 ? '99+' : naoLidas}</span>
          </span>
        )}
        {online.length > 0 && (
          <span aria-hidden className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-ok ring-2 ring-panel" />
        )}
      </button>

      {/* etiqueta do hover: sai para o lado de dentro da tela */}
      {!arrastando && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-2xl border border-line bg-panel/95 backdrop-blur px-3 py-2 shadow-xl',
            'opacity-0 transition-all duration-200 group-hover:opacity-100 motion-reduce:transition-none',
            side === 'right' ? 'right-full mr-3 translate-x-2 group-hover:translate-x-0' : 'left-full ml-3 -translate-x-2 group-hover:translate-x-0',
          )}
        >
          <div className="flex items-center gap-2.5">
            {rostos.length > 0 && (
              <div className="flex -space-x-2">
                {rostos.map((u) => (
                  <span key={u.id} className="w-7 h-7 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[10px] font-bold ring-2 ring-panel">{iniciais(u.name)}</span>
                ))}
                {online.length > MAX_ROSTOS && <span className="w-7 h-7 rounded-full bg-field text-muted grid place-items-center text-[10px] font-bold ring-2 ring-panel">+{online.length - MAX_ROSTOS}</span>}
              </div>
            )}
            <div className="leading-tight">
              <p className="text-[13px] font-semibold text-ink">{titulo}</p>
              <p className="text-[11.5px] text-muted">
                {dono ? (naoLidas ? '' : 'Nenhuma mensagem nova') : online.length ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-ok mr-1 align-middle" />{online.length} online agora</> : 'Ninguém online agora'}
                {naoLidas > 0 && <span className="text-danger font-semibold">{dono ? '' : ' · '}{naoLidas} nova{naoLidas > 1 ? 's' : ''}</span>}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Dono do sistema: a fila de suporte (docs/chat-interno.md#fila-de-suporte). O canal de cada
 * cliente nunca some, então a lista não pode ser "todos os canais": as abas mostram só o que
 * pede ação — **Fila** (ninguém assumiu, na ordem de chegada), **Meus** (comigo), **Ativos**
 * (fila + em andamento de qualquer um do suporte) e **Encerrados** (7 dias). **Clientes** puxa
 * conversa com quem ainda não escreveu.
 */
type OwnerTab = Exclude<SupportView, 'all'> | 'clientes';
function OwnerHome({ staff, onOpen }: { staff: InternalChat[]; onOpen: (id: string) => void }) {
  const [modo, setModo] = useState<'clientes' | 'equipe'>('clientes');
  const [aba, setAba] = useState<OwnerTab>('queue');
  const [busca, setBusca] = useState('');
  const counts = useSupportCounts();
  const lista = useSupportChats(aba === 'clientes' ? 'all' : aba, aba !== 'clientes');
  const tenants = useSupportTenants(aba === 'clientes');
  const abrir = useOpenSupportChat();
  const termo = busca.trim().toLowerCase();
  const clientes = (tenants.data ?? []).filter((t) => !termo || t.name.toLowerCase().includes(termo));
  const chats = lista.data ?? [];

  async function falarCom(tenantId: string) {
    try { const c = await abrir.mutateAsync(tenantId); onOpen(c.id); } catch (err) { toast.err(err); }
  }

  const ABAS: [OwnerTab, string, number | undefined][] = [
    ['queue', 'Fila', counts.data?.queue],
    ['mine', 'Meus', counts.data?.mine],
    ['active', 'Ativos', counts.data?.active],
    ['resolved', 'Encerrados', undefined],
    ['clientes', 'Clientes', undefined],
  ];
  const VAZIO: Record<Exclude<OwnerTab, 'clientes'>, string> = {
    queue: 'Fila vazia: ninguém esperando atendimento.',
    mine: 'Nenhum atendimento com você agora. Assuma um na Fila.',
    active: 'Nenhum atendimento em aberto.',
    resolved: 'Nenhum atendimento encerrado nos últimos 7 dias.',
  };

  const naoLidasEquipe = staff.reduce((a, c) => a + (c.unread ?? 0), 0);
  const MODOS = [['clientes', 'Clientes', Headset, 0], ['equipe', 'Equipe do suporte', Users, naoLidasEquipe]] as const;
  const seletor = (
    <div className="flex gap-1 mx-2 mt-2 text-[12px] font-semibold">
      {MODOS.map(([id, label, Icone, n]) => (
        <button key={id} type="button" onClick={() => setModo(id)} className={cn('flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 border', modo === id ? 'border-accent text-accent bg-accent-soft' : 'border-line text-muted hover:text-ink')}>
          <Icone size={13} />{label}
          {n > 0 && <span className="min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center tnum">{n}</span>}
        </button>
      ))}
    </div>
  );
  if (modo === 'equipe') return <div className="flex-1 min-h-0 flex flex-col">{seletor}<StaffHome chats={staff} onOpen={onOpen} /></div>;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {seletor}
      <div className="grid grid-cols-5 gap-0.5 m-2 rounded-lg bg-field p-1 text-[10.5px] font-semibold">
        {ABAS.map(([id, label, n]) => (
          <button key={id} type="button" onClick={() => setAba(id)} className={cn('rounded-md py-1.5 px-0.5 truncate', aba === id ? 'bg-side text-white' : 'text-muted hover:text-ink')}>
            {label}{!!n && <span className={cn('ml-0.5 tnum', id === 'queue' && aba !== id && 'text-danger')}>{n}</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {aba !== 'clientes' && (
          lista.isLoading ? <p className="p-4 text-sm text-faint">Carregando…</p> : !chats.length ? (
            <p className="p-4 text-sm text-muted">{VAZIO[aba]}{aba === 'queue' && <> Para puxar conversa, escolha em <b>Clientes</b>.</>}</p>
          ) : (
            <ul className="divide-y divide-line">
              {chats.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpen(c.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field">
                    <span className="w-8 h-8 rounded-[11px] bg-accent-soft text-accent-ink grid place-items-center text-[11px] font-bold shrink-0">{iniciais(c.name)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                        {c.ticket && <span className="text-[10.5px] text-faint shrink-0">#{c.ticket.number}</span>}
                        {c.ticket && aba !== 'resolved'
                          ? <span className={cn('ml-auto text-[10.5px] shrink-0', c.ticket.status === 'open' ? 'text-danger font-semibold' : 'text-faint')} title="Esperando desde">{espera(c.ticket.openedAt)}</span>
                          : c.lastMessageAt && <span className="ml-auto text-[10.5px] text-faint shrink-0">{hora(c.lastMessageAt)}</span>}
                      </span>
                      <span className={cn('block truncate text-[12px]', c.unread ? 'text-ink font-medium' : 'text-muted')}>{c.lastMessagePreview ?? 'Sem mensagens'}</span>
                      {c.ticket?.assigneeName && aba !== 'mine' && (
                        <span className="block truncate text-[10.5px] text-faint">{c.ticket.status === 'resolved' ? `Encerrado por ${c.ticket.resolvedByName ?? c.ticket.assigneeName}` : `Com ${c.ticket.assigneeName}`}</span>
                      )}
                    </span>
                    {!!c.unread && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center tnum">{c.unread}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {aba === 'clientes' && (
          <>
            <div className="px-2 pb-2">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" className="w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            {tenants.isLoading ? <p className="p-4 text-sm text-faint">Carregando…</p> : (
              <ul className="divide-y divide-line">
                {clientes.map((t) => (
                  <li key={t.id}>
                    <button type="button" disabled={abrir.isPending} onClick={() => void falarCom(t.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field">
                      <span className="w-8 h-8 rounded-[11px] bg-field text-muted grid place-items-center text-[11px] font-bold shrink-0">{iniciais(t.name)}</span>
                      <span className="flex-1 min-w-0 truncate text-sm text-ink">{t.name}</span>
                      {!t.isActive && <span className="text-[10.5px] text-faint">inativo</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Equipe do suporte (docs/chat-interno.md#equipe-do-suporte): o canal com todos os super_admins
 * fixado no topo, as conversas diretas e, embaixo, os colegas (clicar abre a direta).
 */
/** Dono por marcação: a equipe da empresa dele ou a equipe do suporte, um seletor em cima. */
function TeamAndStaffHome({ chats, staff, loading, onOpen }: { chats: InternalChat[]; staff: InternalChat[]; loading: boolean; onOpen: (id: string) => void }) {
  const [modo, setModo] = useState<'empresa' | 'suporte'>('empresa');
  const n = (xs: InternalChat[]) => xs.reduce((a, c) => a + (c.unread ?? 0), 0);
  const MODOS = [['empresa', 'Minha equipe', Users, n(chats)], ['suporte', 'Equipe do suporte', Headset, n(staff)]] as const;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex gap-1 mx-2 mt-2 text-[12px] font-semibold">
        {MODOS.map(([id, label, Icone, k]) => (
          <button key={id} type="button" onClick={() => setModo(id)} className={cn('flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 border', modo === id ? 'border-accent text-accent bg-accent-soft' : 'border-line text-muted hover:text-ink')}>
            <Icone size={13} />{label}
            {k > 0 && <span className="min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center tnum">{k}</span>}
          </button>
        ))}
      </div>
      {modo === 'suporte' ? <StaffHome chats={staff} onOpen={onOpen} /> : <Home chats={chats} loading={loading} onOpen={onOpen} />}
    </div>
  );
}

function StaffHome({ chats, onOpen }: { chats: InternalChat[]; onOpen: (id: string) => void }) {
  const colegas = useStaffUsers(true);
  const abrir = useOpenStaffChat();
  async function falarCom(userId: string) {
    try { const c = await abrir.mutateAsync(userId); onOpen(c.id); } catch (err) { toast.err(err); }
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin mt-2">
      <ul className="divide-y divide-line">
        {chats.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onOpen(c.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field">
              {c.isGroup
                ? <span className="w-8 h-8 rounded-[11px] bg-gradient-to-br from-accent to-accent-hover text-white grid place-items-center shrink-0 shadow-sm"><Users size={15} /></span>
                : <span className="w-8 h-8 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[11px] font-bold shrink-0">{iniciais(c.name)}</span>}
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1"><span className="truncate text-sm font-medium text-ink">{c.name}</span>{c.lastMessageAt && <span className="ml-auto text-[10.5px] text-faint shrink-0">{hora(c.lastMessageAt)}</span>}</span>
                <span className={cn('block truncate text-[12px]', c.unread ? 'text-ink font-medium' : 'text-muted')}>{c.lastMessagePreview ?? (c.isGroup ? 'Todo o suporte participa' : 'Sem mensagens')}</span>
              </span>
              {!!c.unread && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center tnum">{c.unread}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="px-3 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Colegas</p>
      {colegas.isLoading ? <p className="px-3 py-2 text-sm text-faint">Carregando…</p> : !colegas.data?.length ? (
        <p className="px-3 py-2 text-sm text-muted">Ninguém mais no suporte ainda.</p>
      ) : (
        <ul className="divide-y divide-line">
          {colegas.data.map((u) => (
            <li key={u.id}>
              <button type="button" disabled={abrir.isPending} onClick={() => void falarCom(u.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field">
                <span className="relative w-8 h-8 rounded-full bg-field text-muted grid place-items-center text-[11px] font-bold shrink-0">
                  {iniciais(u.name)}
                  <span className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-panel', u.online ? 'bg-ok' : 'bg-faint')} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm text-ink">{u.name}</span>
                  <span className="block text-[11.5px] text-faint">{u.online ? 'Online agora' : 'Offline'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "agora", "12 min", "3 h", "2 d" — há quanto tempo o atendimento espera. */
function espera(iso: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / 1440)} d`;
}

/**
 * Faixa do canal de suporte com o atendimento. Cliente: se está na fila (e a posição) ou com
 * quem. Suporte (logado como ele mesmo): assumir, devolver à fila e encerrar.
 */
function SupportTicketBar({ ticket, owner, actions, meId }: { ticket: SupportTicket | null | undefined; owner: boolean; actions: boolean; meId: string }) {
  const acao = useSupportTicketAction();
  const run = (action: 'assign' | 'release' | 'resolve', ok: string) => {
    if (!ticket) return;
    acao.mutate({ id: ticket.id, action }, { onSuccess: () => toast.ok(ok), onError: (err) => toast.err(err) });
  };
  const ativo = ticket && ticket.status !== 'resolved' ? ticket : null;
  const texto = !ativo
    ? owner ? 'Sem atendimento aberto. Responder abre um, já com você.' : 'Canal direto com o suporte do sistema — toda a sua equipe vê.'
    : ativo.status === 'open'
      ? owner ? `#${ativo.number} na fila há ${espera(ativo.openedAt)}` : `Atendimento #${ativo.number} na fila${ativo.position ? ` — posição ${ativo.position}` : ''}. Já já alguém do suporte responde.`
      : owner ? `#${ativo.number} com ${ativo.assigneeId === meId ? 'você' : ativo.assigneeName ?? 'o suporte'}` : `Atendimento #${ativo.number} em andamento com ${ativo.assigneeName ?? 'o suporte'}.`;
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] text-muted border-b border-line bg-accent-soft/40">
      <Headset size={13} className="shrink-0 text-accent" />
      <span className="flex-1 min-w-0 truncate" title={texto}>{texto}</span>
      {actions && ativo && (
        <span className="flex gap-1 shrink-0">
          {ativo.assigneeId !== meId && <button type="button" disabled={acao.isPending} onClick={() => run('assign', 'Atendimento com você.')} className="rounded px-1.5 py-0.5 bg-accent text-white font-semibold hover:bg-accent-hover">Assumir</button>}
          {ativo.status === 'in_progress' && <button type="button" disabled={acao.isPending} onClick={() => run('release', 'Devolvido para a fila.')} className="rounded px-1.5 py-0.5 border border-line hover:bg-field" title="Devolver para a fila">Fila</button>}
          <button type="button" disabled={acao.isPending} onClick={() => run('resolve', 'Atendimento encerrado.')} className="rounded px-1.5 py-0.5 border border-line hover:bg-field text-ok font-semibold">Encerrar</button>
        </span>
      )}
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
                    {c.isSupport
                      ? <span className="w-8 h-8 rounded-[11px] bg-gradient-to-br from-accent to-accent-hover text-white grid place-items-center shrink-0 shadow-sm"><Headset size={15} /></span>
                      : <span className="w-8 h-8 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[11px] font-bold shrink-0">{c.isGroup ? <Users size={14} /> : iniciais(c.name)}</span>}
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

/**
 * Conversa aberta: histórico (rola para cima para trazer as anteriores) + campo de envio.
 * Responder como no WhatsApp: botão no balão (ou duplo clique) cita a mensagem; clicar na
 * citação leva até a original. Grupo: botão de membros abre o painel do grupo.
 */
/** `scope` = de que lado da conversa a tela está (textos); `api` = quais rotas usa (padrão: as do `scope`). */
function ChatView({ chat, meId, scope, api = scope, onLeave }: { chat: InternalChat; meId: string; scope: ChatScope; api?: ChatScope; onLeave: () => void }) {
  const msgs = useInternalMessages(chat.id, api);
  const lista = useMemo(() => internalMessagesInOrder(msgs.data), [msgs.data]);
  const send = useSendInternalMessage(chat.id, api);
  const read = useMarkInternalRead(api);
  // canal de suporte: várias pessoas do cliente de um lado, o suporte do outro — mostra quem escreveu
  const mostraAutor = chat.isGroup || !!chat.isSupport;
  const [texto, setTexto] = useState('');
  const [respondendo, setRespondendo] = useState<InternalMessage | null>(null);
  const [painel, setPainel] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const ultima = lista[lista.length - 1]?.id;

  // mensagem nova: desce e marca como lida (a conversa está aberta na frente da pessoa)
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
    if (ultima && chat.unread) read.mutate(chat.id);
  }, [ultima]); // eslint-disable-line react-hooks/exhaustive-deps
  // trocou de conversa: a citação era da outra
  useEffect(() => { setRespondendo(null); setPainel(false); }, [chat.id]);

  function responder(m: InternalMessage) {
    setRespondendo(m);
    campo.current?.focus();
  }
  /** Leva até a mensagem citada e pisca o balão (se ela já está carregada). */
  function irPara(id: string) {
    const el = document.getElementById(`im-${id}`);
    if (!el) { toast.warn('Mensagem antiga: role para cima para carregar.'); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('ring-2', 'ring-accent');
    setTimeout(() => el.classList.remove('ring-2', 'ring-accent'), 1200);
  }

  async function enviar() {
    const t = texto.trim();
    if (!t) return;
    const citada = respondendo;
    setTexto(''); setRespondendo(null);
    try { await send.mutateAsync({ text: t, replyToId: citada?.id }); } catch (err) { setTexto(t); setRespondendo(citada); toast.err(err); }
  }

  if (painel && chat.isGroup && !chat.isStaff) return <GroupPanel chat={chat} meId={meId} onBack={() => setPainel(false)} onLeave={onLeave} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* suporte: atendimento da fila; ações só para o dono logado como ele mesmo (as rotas são de super_admin; entrando como, só o status) */}
      {chat.isSupport && <SupportTicketBar ticket={chat.ticket} owner={scope === 'support'} actions={api === 'support'} meId={meId} />}
      {chat.isGroup && !chat.isStaff && (
        <button type="button" onClick={() => setPainel(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] text-muted border-b border-line hover:bg-field text-left" title="Membros e opções do grupo">
          <Users size={13} className="shrink-0" />
          <span className="truncate flex-1">{chat.members.map((m) => m.name).join(', ')}</span>
          <span className="text-accent shrink-0">Gerenciar</span>
        </button>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 py-2 space-y-1.5">
        {msgs.hasNextPage && (
          <button type="button" onClick={() => void msgs.fetchNextPage()} disabled={msgs.isFetchingNextPage} className="mx-auto block text-[12px] text-accent hover:underline">
            {msgs.isFetchingNextPage ? 'Carregando…' : 'Mensagens anteriores'}
          </button>
        )}
        {msgs.isLoading && <p className="text-sm text-faint">Carregando…</p>}
        {!msgs.isLoading && !lista.length && <p className="text-sm text-muted text-center pt-6">Comece a conversa. Tudo aqui fica registrado para auditoria.</p>}
        {lista.map((m) => {
          if (m.system) return <p key={m.id} id={`im-${m.id}`} className="mx-auto w-fit max-w-[90%] rounded-full bg-field px-3 py-0.5 text-center text-[11px] text-muted">{m.text} · {hora(m.createdAt)}</p>;
          const minha = m.authorId === meId;
          return (
            <div key={m.id} className={cn('group flex items-center gap-1 max-w-[88%]', minha ? 'ml-auto flex-row-reverse' : '')}>
              <div className={cn('flex flex-col min-w-0', minha ? 'items-end' : 'items-start')}>
                {mostraAutor && !minha && (
                  <span className="flex items-center gap-1 text-[10.5px] text-muted px-1">
                    {m.authorName}
                    {m.fromSupport && <span className="rounded-full bg-accent px-1.5 text-[9.5px] font-semibold text-white">Suporte</span>}
                  </span>
                )}
                <div id={`im-${m.id}`} onDoubleClick={() => responder(m)} className={cn('rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words transition-shadow', minha ? 'bg-accent text-white rounded-br-sm' : 'bg-field text-ink rounded-bl-sm')}>
                  {m.replyToId && (
                    <button
                      type="button"
                      onClick={() => m.replyTo && irPara(m.replyTo.id)}
                      className={cn('mb-1 block w-full text-left rounded-lg border-l-[3px] px-2 py-1 text-[12px]', minha ? 'bg-white/15 border-white/70' : 'bg-panel border-accent')}
                    >
                      {m.replyTo ? (
                        <>
                          <span className={cn('block font-semibold', minha ? 'text-white' : 'text-accent')}>{m.replyTo.authorId === meId ? 'Você' : m.replyTo.authorName}</span>
                          <span className={cn('block line-clamp-2', minha ? 'text-white/85' : 'text-muted')}>{m.replyTo.text}</span>
                        </>
                      ) : <span className="italic opacity-80">Mensagem indisponível</span>}
                    </button>
                  )}
                  {m.text}
                </div>
                <span className="text-[10px] text-faint px-1">{hora(m.createdAt)}</span>
              </div>
              <button type="button" onClick={() => responder(m)} className="shrink-0 p-1 rounded-full text-faint hover:text-ink hover:bg-field opacity-0 group-hover:opacity-100 focus:opacity-100" title="Responder" aria-label="Responder">
                <Reply size={14} />
              </button>
            </div>
          );
        })}
        <div ref={fim} />
      </div>
      {respondendo && (
        <div className="flex items-start gap-2 mx-2 mt-2 rounded-lg border-l-[3px] border-accent bg-field px-2.5 py-1.5">
          <div className="flex-1 min-w-0 text-[12px]">
            <span className="block font-semibold text-accent">Respondendo a {respondendo.authorId === meId ? 'você' : respondendo.authorName}</span>
            <span className="block truncate text-muted">{respondendo.text}</span>
          </div>
          <button type="button" onClick={() => setRespondendo(null)} className="text-muted hover:text-ink" aria-label="Cancelar resposta"><X size={14} /></button>
        </div>
      )}
      <form className="flex items-end gap-2 p-2 border-t border-line" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <textarea
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); }
            if (e.key === 'Escape' && respondendo) setRespondendo(null);
          }}
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

/**
 * Painel do grupo: nome, membros, adicionar/tirar, sair e apagar. Quem criou o grupo (ou quem
 * gerencia a equipe) mexe em tudo; os demais só veem os membros e podem sair. Cada mudança vira
 * um aviso no histórico, e apagar só esconde dos membros — a auditoria continua lendo.
 */
function GroupPanel({ chat, meId, onBack, onLeave }: { chat: InternalChat; meId: string; onBack: () => void; onLeave: () => void }) {
  const gerenteDaEquipe = useCan('team.manage');
  const gerencia = chat.createdById === meId || gerenteDaEquipe;
  const users = useInternalUsers(gerencia);
  const add = useAddInternalMembers(chat.id);
  const remove = useRemoveInternalMember(chat.id);
  const rename = useRenameInternalChat(chat.id);
  const apagar = useDeleteInternalChat();
  const [nome, setNome] = useState(chat.name);
  const [adicionando, setAdicionando] = useState<string[]>([]);
  const noGrupo = new Set(chat.members.map((m) => m.id));
  const fora = (users.data ?? []).filter((u) => !noGrupo.has(u.id));

  async function salvarNome() {
    const n = nome.trim();
    if (!n || n === chat.name) return;
    try { await rename.mutateAsync(n); toast.ok('Grupo renomeado'); } catch (err) { setNome(chat.name); toast.err(err); }
  }
  async function adicionar() {
    try { await add.mutateAsync(adicionando); setAdicionando([]); toast.ok('Adicionado ao grupo'); } catch (err) { toast.err(err); }
  }
  async function tirar(id: string, nomeMembro: string) {
    const eu = id === meId;
    if (!confirm(eu ? 'Sair do grupo? Você deixa de ver as mensagens.' : `Remover ${nomeMembro} do grupo?`)) return;
    try { await remove.mutateAsync(id); if (eu) onLeave(); } catch (err) { toast.err(err); }
  }
  async function apagarGrupo() {
    if (!confirm(`Apagar o grupo "${chat.name}"? Ele some para todos os membros. O histórico continua disponível na auditoria.`)) return;
    try { await apagar.mutateAsync(chat.id); toast.ok('Grupo apagado'); onLeave(); } catch (err) { toast.err(err); }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-accent border-b border-line hover:bg-field text-left"><ArrowLeft size={13} /> Voltar à conversa</button>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-4">
        {gerencia && (
          <form onSubmit={(e) => { e.preventDefault(); void salvarNome(); }} className="space-y-1">
            <label className="text-[11.5px] font-semibold text-muted" htmlFor="ic-nome">Nome do grupo</label>
            <div className="flex gap-2">
              <input id="ic-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} className="flex-1 min-w-0 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
              <button type="submit" disabled={!nome.trim() || nome.trim() === chat.name || rename.isPending} className="rounded-lg bg-accent px-3 text-xs font-semibold text-white disabled:opacity-50">Salvar</button>
            </div>
          </form>
        )}

        <div>
          <p className="text-[11.5px] font-semibold text-muted mb-1">Membros ({chat.members.length})</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {chat.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="w-7 h-7 rounded-full bg-field text-muted grid place-items-center text-[10.5px] font-bold shrink-0">{iniciais(m.name)}</span>
                <span className="flex-1 min-w-0 truncate text-sm text-ink">
                  {m.id === meId ? 'Você' : m.name}
                  {m.id === chat.createdById && <span className="ml-1 text-[10.5px] text-faint">· criou o grupo</span>}
                  {!m.active && <span className="ml-1 text-[10.5px] text-faint">· inativo</span>}
                </span>
                {gerencia && m.id !== meId && (
                  <button type="button" disabled={remove.isPending} onClick={() => void tirar(m.id, m.name)} className="p-1 rounded text-muted hover:text-danger hover:bg-field" title="Remover do grupo" aria-label={`Remover ${m.name}`}><UserMinus size={14} /></button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {gerencia && (
          <div>
            <p className="text-[11.5px] font-semibold text-muted mb-1">Adicionar pessoas</p>
            {users.isLoading ? <p className="text-[12px] text-faint">Carregando…</p> : !fora.length ? (
              <p className="text-[12px] text-faint">Toda a equipe já está no grupo.</p>
            ) : (
              <>
                <ul className="divide-y divide-line rounded-lg border border-line max-h-40 overflow-y-auto">
                  {fora.map((u) => {
                    const on = adicionando.includes(u.id);
                    return (
                      <li key={u.id}>
                        <button type="button" onClick={() => setAdicionando((a) => (on ? a.filter((x) => x !== u.id) : [...a, u.id]))} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-field">
                          <span className="flex-1 min-w-0 truncate text-sm text-ink">{u.name}</span>
                          <span className={cn('w-4 h-4 rounded border grid place-items-center', on ? 'bg-accent border-accent text-white' : 'border-line')}>{on && <Check size={11} />}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" disabled={!adicionando.length || add.isPending} onClick={() => void adicionar()} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  <UserPlus size={13} /> Adicionar{adicionando.length ? ` (${adicionando.length})` : ''}
                </button>
              </>
            )}
          </div>
        )}

        <div className="space-y-1.5 border-t border-line pt-3">
          {chat.members.length > 1 && (
            <button type="button" disabled={remove.isPending} onClick={() => void tirar(meId, '')} className="w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink hover:bg-field"><LogOut size={14} /> Sair do grupo</button>
          )}
          {gerencia && (
            <button type="button" disabled={apagar.isPending} onClick={() => void apagarGrupo()} className="w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-danger hover:bg-danger-soft"><Trash2 size={14} /> Apagar grupo</button>
          )}
          {!gerencia && <p className="text-[11.5px] text-faint">Só quem criou o grupo muda nome e membros.</p>}
        </div>
      </div>
    </div>
  );
}
