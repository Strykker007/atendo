'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Lock, Check, X, UserX, RotateCcw, MessageSquare, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { AppointmentModal } from '@/components/scheduling/AppointmentModal';
import { useAppointments, useProfessionals, useUpdateAppointment, useHasFeature, useMe, type Appointment, type AppointmentStatus , useCan} from '@/lib/hooks';
import { useUI } from '@/lib/store';

const STATUS: Record<AppointmentStatus, { label: string; cls: string }> = {
  scheduled: { label: 'Marcado', cls: 'bg-accent-soft text-accent-ink' },
  confirmed: { label: 'Confirmado', cls: 'bg-ok-soft text-ok' },
  done: { label: 'Atendido', cls: 'bg-field text-muted' },
  no_show: { label: 'Faltou', cls: 'bg-danger-soft text-danger-ink' },
  canceled: { label: 'Cancelado', cls: 'bg-field text-faint line-through' },
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Agenda do dia por profissional. Semana com contadores; clique no card para agir. */
export default function AgendaPage() {
  const me = useMe();
  // esconder na tela é conveniência; quem autoriza é a API
  const isAdmin = useCan('agenda.manage');
  const feature = useHasFeature('scheduling');
  const [day, setDay] = useState(() => ymd(new Date()));
  const [proFilter, setProFilter] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const pros = useProfessionals();
  const update = useUpdateAppointment();
  const setConversation = useUI((s) => s.setConversation);
  const dayStart = new Date(`${day}T00:00:00`);
  const from = dayStart.toISOString(); const to = new Date(dayStart.getTime() + 86_400_000).toISOString();
  const appts = useAppointments(from, to, proFilter);
  // contadores da semana (7 dias a partir de hoje-1)
  const weekFrom = new Date(dayStart.getTime() - 86_400_000 * dayStart.getDay());
  const week = useAppointments(weekFrom.toISOString(), new Date(weekFrom.getTime() + 7 * 86_400_000).toISOString(), proFilter);
  const byPro = useMemo(() => {
    const list = pros.data?.filter((p) => p.isActive && (!proFilter || p.id === proFilter)) ?? [];
    return list.map((p) => ({ pro: p, items: (appts.data ?? []).filter((a) => a.professionalId === p.id) }));
  }, [pros.data, appts.data, proFilter]);

  if (!feature.loading && !feature.has) return (
    <PageShell width="max-w-3xl"><PageHeader title="Agenda" /><div className="rounded-2xl border border-line bg-panel p-8 text-center space-y-3"><div className="mx-auto w-12 h-12 rounded-2xl bg-accent-soft text-accent-ink grid place-items-center"><Lock size={22} /></div><p className="font-display font-semibold text-ink">Agendamento está nos planos Pro e Business</p><p className="text-sm text-muted max-w-md mx-auto">Agenda por profissional, marcação pelo WhatsApp com o robô, lembretes ao cliente e aviso ao profissional antes de cada horário.</p>{isAdmin && <Link href="/plano"><Button>Ver planos</Button></Link>}</div></PageShell>
  );

  const shift = (n: number) => setDay(ymd(new Date(dayStart.getTime() + n * 86_400_000)));
  const act = (a: Appointment, status: AppointmentStatus, msg: string) => update.mutateAsync({ id: a.id, status }).then(() => toast.ok(msg)).catch(toast.err);

  return (
    <PageShell width="max-w-6xl">
      <PageHeader title="Agenda" subtitle="Horários do dia por profissional. O robô agenda pelo WhatsApp; você marca por aqui ou pelo chat." action={
        <div className="flex items-center gap-2">
          {isAdmin && <Link href="/agenda/configurar"><Button variant="ghost" icon={<Settings2 size={15} />}>Profissionais e serviços</Button></Link>}
          <Button icon={<Plus size={16} />} onClick={() => setCreating(true)} disabled={!pros.data?.length}>Agendar</Button>
        </div>
      } />

      {/* navegação de dia + semana */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => shift(-1)} className="p-1.5 rounded-lg border border-line text-muted hover:bg-field"><ChevronLeft size={16} /></button>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="rounded-lg border border-line bg-panel text-ink px-3 py-1.5 text-sm" />
        <button onClick={() => shift(1)} className="p-1.5 rounded-lg border border-line text-muted hover:bg-field"><ChevronRight size={16} /></button>
        <button onClick={() => setDay(ymd(new Date()))} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:bg-field">Hoje</button>
        <div className="flex gap-1 ml-auto">
          {Array.from({ length: 7 }, (_, i) => { const d = new Date(weekFrom.getTime() + i * 86_400_000); const k = ymd(d); const n = (week.data ?? []).filter((a) => ymd(new Date(a.startAt)) === k && a.status !== 'canceled').length; return <button key={k} onClick={() => setDay(k)} className={cn('w-11 rounded-lg border py-1 text-center', k === day ? 'border-accent bg-accent-soft' : 'border-line hover:bg-field')}><div className="text-[10px] text-muted">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][i]}</div><div className="text-sm font-semibold text-ink tnum">{d.getDate()}</div><div className="text-[10px] text-accent-ink tnum">{n || ''}</div></button>; })}
        </div>
        <select value={proFilter ?? ''} onChange={(e) => setProFilter(e.target.value || null)} className="rounded-lg border border-line bg-panel text-ink px-3 py-1.5 text-sm"><option value="">Todos os profissionais</option>{pros.data?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>

      {pros.isLoading && <SkeletonRows rows={3} />}
      {pros.data?.length === 0 && <div className="rounded-2xl border border-dashed border-line bg-panel p-10 text-center text-muted"><CalendarDays size={32} className="mx-auto mb-2 text-faint" /><p className="font-medium text-ink">Cadastre o primeiro profissional</p><p className="text-sm">Em <Link href="/agenda/configurar" className="text-accent-ink underline">Profissionais e serviços</Link>: nome, WhatsApp e horários de trabalho.</p></div>}

      <div className={cn('grid gap-4', byPro.length > 1 && 'md:grid-cols-2 xl:grid-cols-3')}>
        {byPro.map(({ pro, items }) => (
          <section key={pro.id} className="rounded-2xl bg-panel border border-line overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: pro.color }} /><span className="font-display font-semibold text-sm text-ink flex-1">{pro.name}</span><span className="text-xs text-muted tnum">{items.filter((a) => a.status !== 'canceled').length} hoje</span></div>
            {items.length === 0 && <p className="px-4 py-6 text-sm text-muted text-center">Sem horários marcados.</p>}
            <ul className="divide-y divide-line">
              {items.map((a) => {
                const st = STATUS[a.status];
                const past = new Date(a.endAt) < new Date();
                return (
                  <li key={a.id} className={cn('px-4 py-2.5 flex items-start gap-3', a.status === 'canceled' && 'opacity-60')}>
                    <div className="tnum font-mono text-sm text-ink w-24 shrink-0 pt-0.5">{hm(a.startAt)}–{hm(a.endAt)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="text-sm font-medium text-ink truncate">{a.contact.name ?? `+${a.contact.phone}`}</span><span className={cn('text-[10px] font-semibold rounded-full px-1.5 py-0.5', st.cls)}>{st.label}</span>{a.rescheduleRequested && <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-warn-soft text-warn-ink">pediu remarcação</span>}</div>
                      <div className="text-xs text-muted truncate">{a.service.name} · {a.service.durationMin} min{a.notes ? ` · ${a.notes}` : ''}{a.source === 'flow' ? ' · 🤖 pelo WhatsApp' : ''}</div>
                      {(a.status === 'scheduled' || a.status === 'confirmed') && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {past && <Button size="sm" variant="ghost" icon={<Check size={12} />} onClick={() => act(a, 'done', 'Marcado como atendido')}>Atendido</Button>}
                          {past && <Button size="sm" variant="subtle" icon={<UserX size={12} />} onClick={() => act(a, 'no_show', 'Marcado como falta')}>Faltou</Button>}
                          <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => setEditing(a)}>Remarcar</Button>
                          <Button size="sm" variant="subtle" icon={<X size={12} />} onClick={() => act(a, 'canceled', 'Cancelado')}>Cancelar</Button>
                          {a.conversationId && <Link href="/conversas" onClick={() => setConversation(a.conversationId)}><Button size="sm" variant="ghost" icon={<MessageSquare size={12} />}>Conversa</Button></Link>}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <AppointmentModal open={creating} onClose={() => setCreating(false)} />
      <AppointmentModal open={!!editing} onClose={() => setEditing(null)} editing={editing} />
    </PageShell>
  );
}
