'use client';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useRouter } from 'next/navigation';
import { Phone, PhoneMissed, Video, X, Copy } from 'lucide-react';
import { useUI } from '@/lib/store';
import { playTransferAlarm } from '@/lib/message-sound';
import { formatPhoneBR } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

/**
 * Ligação no WhatsApp (evento `call` do socket, docs/ligacoes.md). Vários eventos por ligação,
 * todos com o mesmo `callId`: `offer`/`ringing` = chamando agora; `accept` = atendida no celular;
 * `reject`/`timeout`/`terminate` sem atender = perdida.
 */
export interface CallEvent {
  callId: string;
  status: 'offer' | 'ringing' | 'accept' | 'reject' | 'timeout' | 'terminate';
  isVideo: boolean;
  at: string;
  numberId: string;
  numberLabel: string;
  numberPhone: string;
  contactName: string | null;
  phone: string | null;
  conversationId: string | null;
}

type Fase = 'tocando' | 'perdida';
interface Item extends CallEvent { fase: Fase; desde: number }
interface State { items: Item[]; apply: (e: CallEvent) => void; remove: (callId: string) => void }

/** Toca por no máximo 1 min: o WhatsApp desiste antes disso, e evento de fim pode não chegar. */
const TOQUE_MAX_MS = 60_000;

export const useCallAlerts = create<State>((set) => ({
  items: [],
  apply: (e) => set((s): Partial<State> => {
    const atual = s.items.find((i) => i.callId === e.callId);
    const resto = s.items.filter((i) => i.callId !== e.callId);
    // atendida no celular: o aviso some (alguém já está falando com o cliente)
    if (e.status === 'accept') return { items: resto };
    if (e.status === 'offer' || e.status === 'ringing') {
      if (atual) return s; // "ringing" depois do "offer": mesma ligação, nada muda
      const novo: Item = { ...e, fase: 'tocando', desde: Date.now() };
      return { items: [...resto, novo].slice(-4) };
    }
    // terminou sem atender. Se o aviso já tinha sido dispensado, não volta (só se nunca apareceu)
    // evento de fim sem telefone/nome não apaga o que o aviso já mostrava
    const perdida: Item = atual
      ? { ...atual, ...e, contactName: e.contactName ?? atual.contactName, phone: e.phone ?? atual.phone, conversationId: e.conversationId ?? atual.conversationId, fase: 'perdida' }
      : { ...e, fase: 'perdida', desde: Date.now() };
    return { items: [...resto, perdida].slice(-4) };
  }),
  remove: (callId) => set((s) => ({ items: s.items.filter((i) => i.callId !== callId) })),
}));

type Me = { role?: string; numberIds?: string[] } | undefined;

/** Só para quem opera o número (lista vazia = todos, igual à API: number-scope.ts). */
export function receiveCall(e: CallEvent, me: Me) {
  const restrito = me && me.role !== 'super_admin' && (me.numberIds?.length ?? 0) > 0;
  if (restrito && !me!.numberIds!.includes(e.numberId)) return;
  const novo = (e.status === 'offer' || e.status === 'ringing') && !useCallAlerts.getState().items.some((i) => i.callId === e.callId);
  useCallAlerts.getState().apply(e);
  if (novo && !useUI.getState().soundMuted) playTransferAlarm();
}

const fone = (p: string) => (p.startsWith('55') ? formatPhoneBR(p) : `+${p}`);

/** Aviso fixo no topo até abrir ou dispensar — igual ao de transferência. */
export function CallAlerts() {
  const { items, remove, apply } = useCallAlerts();
  const setConversation = useUI((s) => s.setConversation);
  const router = useRouter();

  // enquanto toca: alarme de novo a cada 5 s; passado 1 min sem evento de fim, vira "perdida"
  const tocando = items.some((i) => i.fase === 'tocando');
  useEffect(() => {
    if (!tocando) return;
    const t = setInterval(() => {
      const agora = Date.now();
      for (const i of useCallAlerts.getState().items) {
        if (i.fase === 'tocando' && agora - i.desde > TOQUE_MAX_MS) apply({ ...i, status: 'timeout' });
      }
      if (useCallAlerts.getState().items.some((i) => i.fase === 'tocando') && !useUI.getState().soundMuted) playTransferAlarm();
    }, 5_000);
    return () => clearInterval(t);
  }, [tocando, apply]);

  if (!items.length) return null;
  return (
    <div className="fixed top-4 right-4 z-[71] space-y-2 w-[24rem] max-w-[calc(100vw-2rem)]" role="alert" aria-live="assertive">
      {items.map((c) => {
        const perdida = c.fase === 'perdida';
        const quem = c.contactName || (c.phone ? fone(c.phone) : 'Número oculto');
        const hora = new Date(c.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return (
          <div key={c.callId} className={`flex items-start gap-3 rounded-2xl border-2 bg-panel px-4 py-3 shadow-2xl ${perdida ? 'border-danger' : 'border-ok ring-4 ring-ok/20 animate-pulse'}`}>
            <span className={`mt-0.5 grid place-items-center w-9 h-9 rounded-full text-white shrink-0 ${perdida ? 'bg-danger' : 'bg-ok'}`}>
              {perdida ? <PhoneMissed size={17} /> : c.isVideo ? <Video size={17} /> : <Phone size={17} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-ink">
                {perdida ? `Ligação ${c.isVideo ? 'de vídeo ' : ''}perdida` : `${c.isVideo ? 'Chamada de vídeo' : 'Ligação'} no WhatsApp`}
                <span className="ml-1.5 text-xs font-normal text-muted">{hora}</span>
              </div>
              <div className="text-sm text-ink truncate"><b>{quem}</b>{c.contactName && c.phone ? <span className="text-muted"> · {fone(c.phone)}</span> : null}</div>
              <div className="text-xs text-muted truncate">para <b className="text-ink">{c.numberLabel}</b> · {fone(c.numberPhone)}</div>
              {!perdida && <div className="text-xs text-muted mt-0.5">Atenda pelo celular deste número.</div>}
              <div className="mt-2 flex gap-2">
                {c.conversationId ? (
                  <button
                    type="button"
                    onClick={() => { setConversation(c.conversationId!); remove(c.callId); router.push('/conversas'); }}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    Abrir conversa
                  </button>
                ) : c.phone ? (
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard?.writeText(c.phone!).then(() => toast.ok('Número copiado'), () => undefined); }}
                    className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-black/5"
                  >
                    <Copy size={12} /> Copiar número
                  </button>
                ) : null}
              </div>
            </div>
            <button type="button" onClick={() => remove(c.callId)} className="text-muted hover:text-ink" aria-label="Dispensar"><X size={16} /></button>
          </div>
        );
      })}
    </div>
  );
}
