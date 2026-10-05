'use client';
import { useEffect, useRef, useState } from 'react';
import { BotOff, Play } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { botPaused, usePauseBot, useResumeBot, type Conversation } from '@/lib/hooks';

const DURACOES: { minutes: number | null; label: string }[] = [
  { minutes: 30, label: '30 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 240, label: '4 horas' },
  { minutes: null, label: 'Até retomar manualmente' },
];

/** "14:30", ou "05/10 14:30" se não for hoje. */
function quando(iso: string) {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hora : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

/**
 * Pausar o robô SÓ nesta conversa (fica abaixo do campo de mensagem).
 *
 * Pausado: o fluxo em andamento é interrompido e nada de automação responde aqui até o
 * horário escolhido ou até alguém retomar. Os outros contatos seguem com o robô normal.
 * O estado vem da conversa — o socket atualiza para toda a equipe.
 */
export function BotPauseBar({ conv }: { conv: Conversation }) {
  const pause = usePauseBot();
  const resume = useResumeBot();
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);
  // re-renderiza quando a pausa vence, mesmo que o aviso do servidor atrase
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!conv.botPausedUntil) return;
    const ms = new Date(conv.botPausedUntil).getTime() - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(() => setTick((x) => x + 1), ms + 500);
    return () => clearTimeout(t);
  }, [conv.botPausedUntil]);

  useEffect(() => {
    if (!aberto) return;
    const clique = (e: MouseEvent) => { if (!caixaRef.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', clique);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', clique); document.removeEventListener('keydown', tecla); };
  }, [aberto]);

  if (botPaused(conv)) {
    const quem = conv.botPausedBy?.name;
    const ate = conv.botPausedUntil ? `até ${quando(conv.botPausedUntil)}` : 'até retomar manualmente';
    return (
      <div className="flex items-center gap-2 rounded-lg bg-warn-soft text-warn-ink px-2.5 py-1 text-[12px]">
        <BotOff size={14} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate">Fluxo pausado{quem && <> por <b>{quem}</b></>} {ate}</span>
        <button
          type="button"
          disabled={resume.isPending}
          onClick={() => resume.mutateAsync(conv.id).then(() => toast.ok('Fluxo retomado nesta conversa')).catch(toast.err)}
          className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold hover:bg-warn/15 disabled:opacity-50"
        >
          <Play size={12} /> Retomar fluxo
        </button>
      </div>
    );
  }

  return (
    <div ref={caixaRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto((o) => !o)}
        disabled={pause.isPending}
        title="Pausar a automação só nesta conversa"
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-muted hover:text-ink hover:bg-field disabled:opacity-50"
      >
        <BotOff size={14} /> Pausar fluxo
      </button>
      {aberto && (
        <div className="absolute bottom-full left-0 mb-1 z-30 w-56 rounded-xl border border-line bg-panel shadow-lg overflow-hidden py-1">
          <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Pausar por</div>
          {DURACOES.map((d) => (
            <button
              key={d.label}
              type="button"
              onClick={() => {
                setAberto(false);
                pause.mutateAsync({ conversationId: conv.id, minutes: d.minutes }).then(() => toast.ok('Fluxo pausado nesta conversa')).catch(toast.err);
              }}
              className="w-full text-left px-3 py-1.5 text-[13px] text-ink hover:bg-field"
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
