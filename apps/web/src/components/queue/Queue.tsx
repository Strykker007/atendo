'use client';
import { useEffect, useRef, useState } from 'react';
import { Coffee, Inbox, Loader2, Play, Users } from 'lucide-react';
import { AGENT_PAUSE_MINUTES, AGENT_PAUSE_REASONS, type AgentPause, type AgentPauseReason, type QueueAgent } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useMe, usePause, useQueueStatus, useResume, useResumeAgent } from '@/lib/hooks';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const duracao = (m: number | null) => (m === null ? 'Até eu voltar' : m < 60 ? `${m} min` : `${m / 60} h`);
const textoPausa = (p: AgentPause) => `${AGENT_PAUSE_REASONS[p.reason]}${p.until ? ` · volta ${hora(p.until)}` : ''}`;

/** Pausa é de quem atende numa empresa: o dono "entrando como" e o parceiro não têm. */
function usePodePausar() {
  const me = useMe();
  const d = me.data;
  return !!d && !!d.tenantId && !d.impersonatorId && d.role !== 'super_admin' && d.role !== 'partner';
}

/** Fecha o menu ao clicar fora. */
function useFora<T extends HTMLElement>(aberto: boolean, fechar: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!aberto) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) fechar(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [aberto, fechar]);
  return ref;
}

/**
 * Botão "Disponível / Em pausa" no rodapé do menu (docs/fila-de-atendimento.md#pausa). Em pausa a
 * pessoa não recebe atendimento da fila, do Distribuidor nem da redistribuição — continua com os
 * que já tem e pode responder normalmente.
 */
export function PauseControl({ collapsed }: { collapsed: boolean }) {
  const pode = usePodePausar();
  const q = useQueueStatus(pode);
  const pausar = usePause();
  const voltar = useResume();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState<AgentPauseReason>('lunch');
  const ref = useFora<HTMLDivElement>(aberto, () => setAberto(false));
  if (!pode || !q.data) return null;
  const pausa = q.data.me.pause;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => (pausa ? voltar.mutate(undefined, { onSuccess: () => toast.ok('Você voltou a receber atendimentos'), onError: toast.err }) : setAberto((v) => !v))}
        title={pausa ? `Em pausa: ${textoPausa(pausa)}. Clique para voltar.` : 'Disponível: clique para pausar'}
        className={cn('w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] hover:bg-white/5', pausa ? 'text-warn' : 'text-side-ink hover:text-white', collapsed && 'justify-center px-0')}>
        {voltar.isPending ? <Loader2 size={15} className="animate-spin" /> : <span className={cn('w-2.5 h-2.5 rounded-full shrink-0 ring-[3px]', pausa ? 'bg-warn ring-warn/25' : 'bg-ok ring-ok/25')} />}
        {!collapsed && (
          <span className="flex-1 min-w-0 text-left truncate">
            {pausa ? <>Em pausa <span className="text-side-ink/70">· {textoPausa(pausa)}</span></> : 'Disponível'}
          </span>
        )}
        {!collapsed && pausa && <span className="text-[11px] font-semibold text-white">Voltar</span>}
      </button>

      {aberto && (
        <div className="absolute bottom-full left-0 mb-1 w-64 rounded-xl border border-line bg-panel text-ink shadow-xl p-3 space-y-2.5 z-50">
          <p className="text-[13px] font-semibold flex items-center gap-1.5"><Coffee size={14} className="text-warn" /> Pausar atendimentos</p>
          <p className="text-[11.5px] text-muted">Você não recebe atendimento novo. Os que já estão com você continuam.</p>
          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(AGENT_PAUSE_REASONS) as AgentPauseReason[]).map((r) => (
              <button key={r} type="button" onClick={() => setMotivo(r)}
                className={cn('rounded-lg border px-2 py-1.5 text-[12px]', motivo === r ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>
                {AGENT_PAUSE_REASONS[r]}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] font-medium text-muted">Por quanto tempo?</p>
          <div className="grid grid-cols-2 gap-1">
            {AGENT_PAUSE_MINUTES.map((m) => (
              <button key={String(m)} type="button" disabled={pausar.isPending}
                onClick={() => pausar.mutate({ reason: motivo, minutes: m }, { onSuccess: () => { setAberto(false); toast.ok(m ? `Pausa de ${duracao(m)}: você volta a receber sozinho` : 'Em pausa até você voltar'); }, onError: toast.err })}
                className="rounded-lg bg-field px-2 py-1.5 text-[12px] font-semibold hover:bg-accent-soft hover:text-accent-ink disabled:opacity-60">
                {duracao(m)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Faixa no topo enquanto a pessoa está em pausa: impossível esquecer ligada. */
export function PauseBanner() {
  const pode = usePodePausar();
  const q = useQueueStatus(pode);
  const voltar = useResume();
  const pausa = pode ? q.data?.me.pause : null;
  if (!pausa) return null;
  return (
    <div role="status" className="flex items-center gap-2 px-4 py-1.5 text-[13px] bg-warn-soft text-warn-ink border-b border-warn">
      <Coffee size={15} className="shrink-0" />
      <span className="flex-1">Você está em pausa ({AGENT_PAUSE_REASONS[pausa.reason].toLowerCase()}) e não recebe atendimentos novos.{pausa.until ? ` Volta sozinho às ${hora(pausa.until)}.` : ''}</span>
      <button type="button" disabled={voltar.isPending} onClick={() => voltar.mutate(undefined, { onSuccess: () => toast.ok('Você voltou a receber atendimentos'), onError: toast.err })} className="inline-flex items-center gap-1 underline font-medium whitespace-nowrap">
        <Play size={12} /> Voltar a atender
      </button>
    </div>
  );
}

const ESTADO: Record<QueueAgent['state'], { label: string; cls: string }> = {
  available: { label: 'recebendo', cls: 'bg-ok' },
  full: { label: 'no limite', cls: 'bg-accent' },
  paused: { label: 'em pausa', cls: 'bg-warn' },
  offline: { label: 'fora', cls: 'bg-faint' },
};

/**
 * Faixa da fila no topo da lista de conversas (só com a distribuição ligada): quantos esperam e
 * quantos atendimentos estão comigo. Quem acompanha a equipe abre e vê cada pessoa.
 */
export function QueueBar() {
  const q = useQueueStatus();
  const tirar = useResumeAgent();
  const [aberto, setAberto] = useState(false);
  const ref = useFora<HTMLDivElement>(aberto, () => setAberto(false));
  const d = q.data;
  if (!d?.enabled) return null;
  const team = d.team;
  const recebendo = team?.filter((a) => a.state === 'available').length;

  return (
    <div ref={ref} className="relative px-2.5 pt-2">
      <button type="button" onClick={() => team && setAberto((v) => !v)} disabled={!team}
        className={cn('w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-left', d.waiting ? 'bg-wait/15 text-ink' : 'bg-field text-muted', team && 'hover:bg-field/80 cursor-pointer')}>
        <Inbox size={14} className={d.waiting ? 'text-wait' : 'text-faint'} />
        <span className="flex-1 min-w-0 truncate">
          {d.waiting ? <><b className="tnum">{d.waiting}</b> na fila de espera</> : 'Fila vazia'}
          {team && <span className="text-muted"> · {recebendo} recebendo</span>}
        </span>
        <span className="tnum text-muted" title={`Atendimentos abertos com você (limite ${d.maxPerAgent})`}>você {d.me.open}/{d.maxPerAgent}</span>
        {team && <Users size={13} className="text-faint" />}
      </button>

      {aberto && team && (
        <div className="absolute left-2.5 right-2.5 top-full mt-1 rounded-xl border border-line bg-panel shadow-xl p-2 z-40 max-h-80 overflow-y-auto">
          <p className="px-1.5 pb-1.5 text-[11.5px] text-muted">Distribuição automática · até {d.maxPerAgent} por pessoa{d.lockClaim ? ' · atendentes não puxam da fila' : ''}</p>
          <ul className="space-y-0.5">
            {team.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] hover:bg-field">
                <span className={cn('w-2 h-2 rounded-full shrink-0', ESTADO[a.state].cls)} />
                <span className="flex-1 min-w-0 truncate">{a.name}</span>
                <span className="text-[11px] text-muted">{a.state === 'paused' && a.pause ? textoPausa(a.pause) : ESTADO[a.state].label}</span>
                <span className="tnum text-[11px] text-faint w-8 text-right">{a.open}/{d.maxPerAgent}</span>
                {a.state === 'paused' && (
                  <button type="button" title="Tirar da pausa" disabled={tirar.isPending} onClick={() => tirar.mutate(a.id, { onSuccess: () => toast.ok(`${a.name} voltou a receber`), onError: toast.err })} className="p-0.5 text-muted hover:text-ok">
                    <Play size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
