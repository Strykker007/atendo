'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, Clock, Hourglass, LogOut, MessageSquareReply, Moon, Users } from 'lucide-react';
import { api, refresh } from '@/lib/api';
import { useShiftSession } from '@/lib/shift-session';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { AccessRequestModal } from '@/components/auth/AccessRequestModal';
import { playMessageSound } from '@/lib/message-sound';

interface ShiftSummary {
  locked: boolean;
  shiftEndsAt: string | null;
  lockedUntil: string | null;
  since: string;
  stats: { claimed: number; closed: number; transferred: number };
  open: { id: string; name: string }[];
  requestToken: string | null;
}

const hora = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

async function sair(code?: string) {
  await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  location.href = code ? `/login?bloqueio=${code}` : '/login';
}

/**
 * Fim de turno (docs/escalas.md#fim-de-turno). Em vez de derrubar a sessão:
 *
 *  - **avisa antes** (15 e 5 min) para a pessoa ir fechando os atendimentos;
 *  - na hora, **trava a tela** (a API já recusa qualquer ação e o socket para de receber
 *    mensagens) e vira uma passagem de turno: resumo do que ela fez, **devolver os atendimentos
 *    abertos para a fila** (o cliente não fica preso com quem foi embora) e **pedir mais tempo**;
 *  - liberação aprovada destrava sozinha; sem resposta, a sessão encerra no fim da passagem.
 */
export function ShiftEndScreen() {
  const { locked, endsAt, lockedUntil } = useShiftSession();
  const qc = useQueryClient();
  const avisados = useRef(new Set<string>());
  const travadoDesde = useRef<number | null>(null);

  // avisos antes do fim e, na hora, renova: a API decide entre turno estendido (liberação) e passagem
  useEffect(() => {
    if (!endsAt || locked) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const min of [15, 5]) {
      const em = endsAt - min * 60_000 - Date.now();
      const chave = `${endsAt}:${min}`;
      if (em > -60_000 && !avisados.current.has(chave)) {
        timers.push(setTimeout(() => {
          avisados.current.add(chave);
          toast.warn(`Seu turno termina em ${min} minutos (${hora(endsAt)}). Vá concluindo ou devolva seus atendimentos para a fila.`);
          playMessageSound();
        }, Math.max(0, em)));
      }
    }
    timers.push(setTimeout(() => { void refresh().then((ok) => { if (!ok) useShiftSession.setState({ locked: true }); }); }, Math.max(0, endsAt - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [endsAt, locked]);

  // destravou (liberação aprovada / ainda no turno depois de um corte): recarrega tudo que falhou travado
  useEffect(() => {
    // corte que só reavaliou (gestor mexeu na escala e a pessoa segue no turno) destrava em
    // instantes: sem aviso para esse vaivém
    if (travadoDesde.current && !locked) {
      qc.invalidateQueries();
      if (Date.now() - travadoDesde.current > 5_000) toast.ok('Acesso liberado. Bom trabalho!');
    }
    travadoDesde.current = locked ? travadoDesde.current ?? Date.now() : null;
  }, [locked, qc]);

  if (!locked) return null;
  return <LockedScreen lockedUntil={lockedUntil} />;
}

function LockedScreen({ lockedUntil }: { lockedUntil: number | null }) {
  const [resumo, setResumo] = useState<ShiftSummary | null>(null);
  const [devolvendo, setDevolvendo] = useState(false);
  const [devolvidos, setDevolvidos] = useState<number | null>(null);
  const [pedir, setPedir] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const [fim, setFim] = useState<number | null>(lockedUntil);

  // Ao travar: renova uma vez (corte do gestor sem perder o turno destrava aqui mesmo; senão vem o
  // token de passagem, com o prazo). Refresh recusado = acabou a passagem: sai.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const ok = await refresh().catch(() => false);
      if (!vivo) return;
      if (!ok) { void sair('FOR_OUT_OF_SCHEDULE'); return; }
      if (!useShiftSession.getState().locked) return;
      try { const r = await api<ShiftSummary>('/me/shift'); if (vivo) { setResumo(r); if (r.lockedUntil) setFim(new Date(r.lockedUntil).getTime()); } } catch { /* a tela funciona sem o resumo */ }
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (fim && agora >= fim) void sair('FOR_OUT_OF_SCHEDULE'); }, [agora, fim]);

  async function devolver() {
    setDevolvendo(true);
    try {
      const r = await api<{ released: number }>('/me/shift/handoff', { method: 'POST' });
      setDevolvidos(r.released);
      setResumo((s) => (s ? { ...s, open: [] } : s));
    } catch (err) { toast.err(err); } finally { setDevolvendo(false); }
  }

  const abertos = resumo?.open ?? [];
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-canvas/80 backdrop-blur-md px-4" role="dialog" aria-modal="true" aria-label="Turno encerrado">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel shadow-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0"><Moon size={22} /></span>
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Seu turno terminou</h2>
            <p className="text-sm text-muted">O painel está pausado: nenhuma ação nova até o próximo turno. Antes de sair, deixe tudo em ordem.</p>
          </div>
        </div>

        {resumo && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { icon: <MessageSquareReply size={15} />, n: resumo.stats.claimed, label: 'assumidos' },
              { icon: <CheckCircle2 size={15} />, n: resumo.stats.closed, label: 'encerrados' },
              { icon: <ArrowRightLeft size={15} />, n: resumo.stats.transferred, label: 'transferidos' },
            ].map((c) => (
              <div key={c.label} className="rounded-xl bg-field px-2 py-2.5">
                <p className="flex items-center justify-center gap-1 text-muted text-[11px]">{c.icon}{c.label}</p>
                <p className="text-xl font-semibold text-ink tnum">{c.n}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-line p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink"><Users size={15} /> Atendimentos com você</p>
          {devolvidos !== null ? (
            <p className="text-[13px] text-ok">{devolvidos ? `${devolvidos} atendimento(s) devolvido(s) para a fila — a equipe continua de onde você parou.` : 'Nada pendente com você.'}</p>
          ) : !resumo ? (
            <p className="text-[13px] text-faint">Carregando…</p>
          ) : !abertos.length ? (
            <p className="text-[13px] text-muted">Nenhum atendimento aberto com você. Tudo certo.</p>
          ) : (
            <>
              <p className="text-[12.5px] text-muted truncate" title={abertos.map((a) => a.name).join(', ')}>{abertos.slice(0, 4).map((a) => a.name).join(', ')}{abertos.length > 4 ? ` e mais ${abertos.length - 4}` : ''}</p>
              <Button className="w-full" loading={devolvendo} onClick={() => void devolver()}><ArrowRightLeft size={14} /> Devolver {abertos.length} para a fila</Button>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="flex-1" disabled={!resumo?.requestToken} onClick={() => setPedir(true)}><Hourglass size={14} /> Preciso de mais tempo</Button>
          <Button variant="subtle" className="flex-1" onClick={() => void sair()}><LogOut size={14} /> Sair agora</Button>
        </div>
        {fim && (
          <p className="flex items-center justify-center gap-1 text-[12px] text-faint"><Clock size={12} /> A sessão encerra sozinha em {mmss(fim - agora)}</p>
        )}
      </div>
      {pedir && resumo?.requestToken && (
        <AccessRequestModal token={resumo.requestToken} skipIntro retryLabel="Continuar trabalhando" onClose={() => setPedir(false)} onRetry={() => { setPedir(false); void refresh(); }} />
      )}
    </div>
  );
}
