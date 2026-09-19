'use client';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useProfessionals, useServices, useAvailability, useCreateAppointment, useUpdateAppointment, type Appointment, type Conversation } from '@/lib/hooks';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Marcar / remarcar. Contato pode vir pré-preenchido (botão no chat) ou ser buscado por nome/telefone.
 * Só oferece horários realmente livres (mesma regra do robô).
 */
export function AppointmentModal({ open, onClose, contact, conversationId, editing }: { open: boolean; onClose: () => void; contact?: { id: string; name: string | null; phone: string } | null; conversationId?: string; editing?: Appointment | null }) {
  const pros = useProfessionals();
  const services = useServices();
  const create = useCreateAppointment();
  const update = useUpdateAppointment();
  const [contactSel, setContactSel] = useState<{ id: string; name: string | null; phone: string } | null>(contact ?? editing?.contact ?? null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [professionalId, setProfessionalId] = useState(editing?.professionalId ?? '');
  const [serviceId, setServiceId] = useState(editing?.serviceId ?? '');
  const [day, setDay] = useState(ymd(new Date()));
  const [startAt, setStartAt] = useState<string | null>(null);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const avail = useAvailability(professionalId || null, serviceId || null, `${day}T00:00:00Z`);

  useEffect(() => { setContactSel(contact ?? editing?.contact ?? null); setProfessionalId(editing?.professionalId ?? pros.data?.[0]?.id ?? ''); setServiceId(editing?.serviceId ?? ''); setStartAt(null); setNotes(editing?.notes ?? ''); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!professionalId && pros.data?.length) setProfessionalId(pros.data[0].id); }, [pros.data, professionalId]);

  // busca de contato (por nome/telefone nas conversas)
  useEffect(() => {
    if (contactSel || search.trim().length < 2) return;
    const t = setTimeout(async () => {
      try {
        const convs = await api<Conversation[]>(`/conversations?search=${encodeURIComponent(search)}`);
        const seen = new Set<string>();
        setResults(convs.map((c) => c.contact).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, 8));
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, contactSel]);

  const slotsByDay = useMemo(() => { const m = new Map<string, typeof avail.data>(); (avail.data ?? []).forEach((s) => { const k = s.startAt.slice(0, 10); m.set(k, [...(m.get(k) ?? []), s]); }); return m; }, [avail.data]);
  const days = [...slotsByDay.keys()].slice(0, 7);

  async function submit() {
    if (!contactSel || !professionalId || !serviceId || !startAt) return;
    try {
      if (editing) await update.mutateAsync({ id: editing.id, professionalId, serviceId, startAt, notes: notes || undefined });
      else await create.mutateAsync({ contactId: contactSel.id, professionalId, serviceId, startAt, conversationId, notes: notes || undefined });
      toast.ok(editing ? 'Remarcado' : 'Agendado');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Remarcar' : 'Novo agendamento'} width="max-w-2xl">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Field label="Cliente">
            {contactSel ? (
              <div className="flex items-center justify-between rounded-lg bg-field px-3 py-2 text-sm"><span className="text-ink">{contactSel.name ?? '—'} <span className="text-muted">+{contactSel.phone}</span></span>{!contact && !editing && <button className="text-xs text-accent-ink" onClick={() => { setContactSel(null); setSearch(''); }}>trocar</button>}</div>
            ) : (
              <div className="relative">
                <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone" autoFocus />
                {results.length > 0 && <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-line bg-panel shadow-lg py-1 max-h-48 overflow-y-auto">{results.map((r) => <button key={r.id} onClick={() => { setContactSel(r); setResults([]); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-field"><span className="text-ink">{r.name ?? '—'}</span> <span className="text-muted">+{r.phone}</span></button>)}</div>}
                <p className="text-[11px] text-faint mt-1">Só contatos que já conversaram. Cliente novo: peça para mandar um "oi" no WhatsApp.</p>
              </div>
            )}
          </Field>
          <Field label="Serviço"><select className={inputCls} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setStartAt(null); }}><option value="">Escolha…</option>{services.data?.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min{Number(s.price) ? ` · R$ ${Number(s.price).toFixed(0)}` : ''}</option>)}</select></Field>
          <Field label="Profissional"><select className={inputCls} value={professionalId} onChange={(e) => { setProfessionalId(e.target.value); setStartAt(null); }}>{pros.data?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="A partir de"><input type="date" className={inputCls} value={day} onChange={(e) => { setDay(e.target.value); setStartAt(null); }} /></Field>
          <Field label="Observações"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex.: degradê baixo" /></Field>
        </div>
        <div>
          <div className="text-sm font-medium text-ink mb-1">Horários livres</div>
          {!serviceId && <p className="text-xs text-muted">Escolha o serviço para ver os horários.</p>}
          {serviceId && avail.isLoading && <p className="text-xs text-muted">Calculando…</p>}
          {serviceId && avail.data?.length === 0 && <p className="text-xs text-muted">Nenhum horário livre nos próximos 14 dias.</p>}
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {days.map((d) => (
              <div key={d}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{slotsByDay.get(d)![0].label.split(' ').slice(0, 2).join(' ')}</div>
                <div className="flex flex-wrap gap-1">
                  {slotsByDay.get(d)!.map((s) => <button key={s.startAt} onClick={() => setStartAt(s.startAt)} className={cn('text-xs tnum rounded-md px-2 py-1 border', startAt === s.startAt ? 'border-accent bg-accent text-white' : 'border-line hover:bg-field text-ink')}>{s.label.slice(-5)}</button>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={submit} disabled={!contactSel || !serviceId || !professionalId || !startAt} loading={create.isPending || update.isPending} loadingText="Salvando…">{editing ? 'Remarcar' : 'Agendar'}</Button></div>
    </Modal>
  );
}
