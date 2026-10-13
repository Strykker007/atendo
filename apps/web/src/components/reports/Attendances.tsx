'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, MinusCircle, Search, ExternalLink, Lock, Paperclip, X } from 'lucide-react';
import { MESSAGE_TYPE_LABEL, type MessageType } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { inputCls, Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { fmtBRL } from '@/components/reports/ReportChart';
import { useAttendances, useAttendanceMessages, useTags, useCloseReasons, useOutcomeLabels, type AttendanceRow } from '@/lib/hooks';
import { useUI } from '@/lib/store';

const PAGE_SIZE = 25;

/** o que o clique num gráfico manda para a auditoria (ex.: barra "Achou caro" do "Não comprou, por tag") */
export interface AttendanceFocus { outcome?: 'won' | 'lost'; tagId?: string; closeReasonId?: string; reason?: string; label?: string; seq: number }

const RESULTADO = {
  won: { icon: <CheckCircle2 size={13} />, cls: 'text-ok' },
  lost: { icon: <XCircle size={13} />, cls: 'text-danger' },
  none: { icon: <MinusCircle size={13} />, cls: 'text-muted' },
} as const;
/** nome do resultado na empresa (Configurações → Encerramento) */
const rotuloDe = (o: AttendanceRow['outcome'], labels: { won: string; lost: string }) => (o === 'won' || o === 'lost' ? labels[o] : 'Sem resultado');

/**
 * Auditoria de atendimentos: cada encerramento do período, com resultado, quem encerrou e as tags
 * escolhidas NELE (não as que a conversa tem hoje). É a ponte entre o número do relatório
 * ("12 não compraram por Achou caro") e o que de fato aconteceu: clicar abre só aquele
 * atendimento — do encerramento anterior até este —, sem os outros dias do cliente misturados.
 * Período e atendente vêm do topo da tela; resultado, tag e busca ficam aqui.
 */
export function Attendances({ from, to, userId, focus }: { from: string; to: string; userId?: string; focus?: AttendanceFocus | null }) {
  const [outcome, setOutcome] = useState<'' | 'won' | 'lost'>('');
  const [tagId, setTagId] = useState('');
  const [closeReasonId, setCloseReasonId] = useState('');
  const motivos = useCloseReasons();
  const labels = useOutcomeLabels();
  const [reason, setReason] = useState<{ value: string } | null>(null);
  const [busca, setBusca] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [aberto, setAberto] = useState<AttendanceRow | null>(null);
  const tags = useTags();
  const ref = useRef<HTMLElement>(null);

  // clique no gráfico: aplica o filtro e rola até aqui
  useEffect(() => {
    if (!focus) return;
    setOutcome(focus.outcome ?? '');
    setTagId(focus.tagId ?? '');
    setCloseReasonId(focus.closeReasonId ?? '');
    setReason(focus.reason ? { value: focus.reason } : null);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => setSearch(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => setPage(1), [from, to, userId, outcome, tagId, closeReasonId, reason, search]);

  const q = useAttendances({ startDate: from, endDate: to, userId, outcome: outcome || undefined, tagIds: tagId || undefined, closeReasonId: closeReasonId || undefined, reason: reason?.value, search: search || undefined, page, pageSize: PAGE_SIZE });
  const d = q.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / PAGE_SIZE)) : 1;
  // tags que fazem sentido filtrar: as do resultado escolhido (ou as de qualquer encerramento)
  // tags do atendimento: qualquer tag (as transitórias ficam congeladas no encerramento)
  const tagsDoFiltro = tags.data ?? [];

  return (
    <section ref={ref} className="space-y-3 scroll-mt-4">
      <div>
        <h2 className="font-display font-semibold text-ink">Atendimentos encerrados</h2>
        <p className="text-[12.5px] text-muted">Cada encerramento do período. Clique para ver a conversa daquele atendimento e o que o atendente fez.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-[12.5px]">
          {([['', 'Todos'], ['won', labels.won], ['lost', labels.lost]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setOutcome(v)} aria-pressed={outcome === v} className={cn('rounded-md px-2.5 py-1 font-medium', outcome === v ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink')}>{l}</button>
          ))}
        </div>
        <select className={cn(inputCls, 'w-auto py-1.5 text-[12.5px]')} value={closeReasonId} onChange={(e) => { setCloseReasonId(e.target.value); setReason(null); }} aria-label="Motivo do encerramento">
          <option value="">Qualquer motivo</option>
          {(motivos.data ?? []).filter((r) => !r.ignoreInReports && (!outcome || r.outcome === outcome || r.outcome === 'both')).map((r) => <option key={r.id} value={r.id}>{r.name}{r.isActive ? '' : ' (desativado)'}</option>)}
        </select>
        <select className={cn(inputCls, 'w-auto py-1.5 text-[12.5px]')} value={tagId} onChange={(e) => { setTagId(e.target.value); setReason(null); }} aria-label="Tag do atendimento">
          <option value="">Qualquer tag</option>
          {tagsDoFiltro.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {reason && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-field px-2 py-0.5 text-[12px] text-ink">
            Motivo: {reason.value}
            <button type="button" onClick={() => setReason(null)} aria-label="Tirar o filtro de motivo" className="text-faint hover:text-ink"><X size={12} /></button>
          </span>
        )}
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className={cn(inputCls, 'pl-8 py-1.5 text-[12.5px]')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente ou número" aria-label="Buscar cliente ou número" />
        </div>
        {d && <span className="text-[12px] text-muted tnum">{d.summary.count} atendimento(s) · {d.summary.won} {labels.won.toLowerCase()} · {d.summary.lost} {labels.lost.toLowerCase()}</span>}
      </div>

      <div className={cn('rounded-2xl bg-panel border border-line overflow-hidden', q.isFetching && 'opacity-70')}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Encerrado em</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Atendente</th>
                <th className="px-4 py-2 font-medium">Resultado</th>
                <th className="px-4 py-2 font-medium">Motivo</th>
                <th className="px-4 py-2 font-medium">Etapa</th>
                <th className="px-4 py-2 font-medium">Tags</th>
                <th className="px-4 py-2 font-medium text-right">Mensagens</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">Carregando…</td></tr>}
              {d && d.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">Nenhum atendimento com esses filtros.</td></tr>}
              {d?.rows.map((a) => {
                const r = RESULTADO[a.outcome ?? 'none'];
                return (
                  <tr key={a.id} onClick={() => setAberto(a)} className="border-b border-line last:border-0 cursor-pointer hover:bg-field">
                    <td className="px-4 py-2.5 tnum whitespace-nowrap text-ink">{new Date(a.closedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-ink truncate max-w-[200px]">{a.contact.name || 'Sem nome'}</div>
                      <div className="text-[11px] text-muted tnum">{a.contact.phoneFormatted}</div>
                    </td>
                    <td className="px-4 py-2.5 text-ink truncate max-w-[150px]">{a.user?.name ?? <span className="text-muted">(automático)</span>}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={cn('inline-flex items-center gap-1 font-medium', r.cls)}>{r.icon}{rotuloDe(a.outcome, labels)}</span>
                      {a.value != null && <span className="ml-1.5 text-muted tnum">{fmtBRL(a.value)}</span>}
                    </td>
                    <td className="px-4 py-2.5"><Motivo a={a} /></td>
                    <td className="px-4 py-2.5">{a.stage ? <TagPill t={a.stage} /> : <span className="text-faint">—</span>}</td>
                    <td className="px-4 py-2.5"><Tags a={a} /></td>
                    <td className="px-4 py-2.5 text-right tnum text-muted">{a.messages}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {d && d.total > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-line text-[12px] text-muted">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md hover:bg-field disabled:opacity-40" aria-label="Página anterior"><ChevronLeft size={15} /></button>
            <span className="tnum">{page} / {paginas}</span>
            <button type="button" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md hover:bg-field disabled:opacity-40" aria-label="Próxima página"><ChevronRight size={15} /></button>
          </div>
        )}
      </div>

      {aberto && <AttendanceModal a={aberto} onClose={() => setAberto(null)} />}
    </section>
  );
}

function TagPill({ t }: { t: { id: string; name: string; color: string } }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap" style={{ color: t.color, borderColor: t.color, background: `color-mix(in srgb, ${t.color} 12%, transparent)` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />{t.name}
    </span>
  );
}

/** motivo cadastrado; encerramento antigo sem cadastro mostra o texto gravado */
function Motivo({ a }: { a: AttendanceRow }) {
  if (a.closeReason) return <TagPill t={a.closeReason} />;
  return a.reason ? <span className="text-[12px] text-muted">{a.reason}</span> : <span className="text-faint">—</span>;
}

function Tags({ a }: { a: AttendanceRow }) {
  if (!a.tags.length) return <span className="text-faint">—</span>;
  return <div className="flex flex-wrap gap-1">{a.tags.map((t) => <TagPill key={t.id} t={t} />)}</div>;
}

/**
 * Um atendimento: cabeçalho com o desfecho e as mensagens da janela dele, só leitura. "Abrir
 * conversa" leva ao chat (a conversa inteira, como está hoje).
 */
function AttendanceModal({ a, onClose }: { a: AttendanceRow; onClose: () => void }) {
  const msgs = useAttendanceMessages(a);
  const router = useRouter();
  const { setConversation } = useUI();
  const r = RESULTADO[a.outcome ?? 'none'];
  const labels = useOutcomeLabels();
  const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const lista = msgs.data ?? [];

  return (
    <Modal open onClose={onClose} title={a.contact.name || a.contact.phoneFormatted} width="max-w-2xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted">
          <span className={cn('inline-flex items-center gap-1 font-medium', r.cls)}>{r.icon}{rotuloDe(a.outcome, labels)}{a.value != null && <span className="tnum"> · {fmtBRL(a.value)}</span>}</span>
          <span>Atendente: <b className="text-ink font-medium">{a.user?.name ?? 'automático'}</b></span>
          <Motivo a={a} />
          {a.stage && <span className="inline-flex items-center gap-1">Etapa: <TagPill t={a.stage} /></span>}
          <span className="tnum">{a.startedAt ? `${fmt(a.startedAt)} → ` : 'Até '}{fmt(a.closedAt)}</span>
          <Tags a={a} />
        </div>

        <div className="rounded-xl border border-line bg-field/40 p-3 max-h-[55vh] overflow-y-auto space-y-1.5">
          {msgs.isLoading && <p className="py-8 text-center text-sm text-muted">Carregando mensagens…</p>}
          {msgs.isError && <p className="py-8 text-center text-sm text-muted">Não foi possível carregar — você pode não ter acesso a esta conversa.</p>}
          {msgs.data && lista.length === 0 && <p className="py-8 text-center text-sm text-muted">Nenhuma mensagem neste atendimento.</p>}
          {lista.map((m) => {
            const nota = !!m.internal;
            const sai = m.direction === 'out';
            const corpo = m.deletedAt ? <i className="text-muted">mensagem apagada</i> : m.text || (m.mediaName ? <span className="inline-flex items-center gap-1"><Paperclip size={12} />{m.mediaName}</span> : MESSAGE_TYPE_LABEL[m.type as MessageType] ?? m.type);
            return (
              <div key={m.id} className={cn('flex', sai ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[80%] rounded-xl px-3 py-1.5 text-[13px] shadow-sm', nota ? 'bg-warn-soft text-warn-ink' : sai ? 'bg-accent-soft text-ink' : 'bg-panel text-ink')}>
                  {(sai || nota) && (
                    <div className="text-[10.5px] font-semibold opacity-70 flex items-center gap-1">
                      {nota && <Lock size={10} />}{m.authorName ?? m.author?.name ?? (sai ? 'Automático' : '')}
                    </div>
                  )}
                  {m.mediaUrl && m.mediaMime?.startsWith('image/') && !m.deletedAt && <img src={m.mediaUrl} alt="" className="mt-1 max-h-40 rounded-lg" />}
                  <div className="whitespace-pre-wrap break-words">{corpo}</div>
                  <div className="text-[10px] text-faint text-right tnum">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            );
          })}
          {lista.length >= 1000 && <p className="text-center text-[11.5px] text-muted">Mostrando as primeiras 1000 mensagens deste atendimento.</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          <Button icon={<ExternalLink size={14} />} onClick={() => { setConversation(a.conversationId); router.push('/conversas'); }}>Abrir conversa</Button>
        </div>
      </div>
    </Modal>
  );
}
