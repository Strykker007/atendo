'use client';
import { useState } from 'react';
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { EscalasTabs } from '@/components/escalas/EscalasTabs';
import {
  WEEKDAYS, WORK_SCHEDULE_TYPES, useAgents, useAssignSchedule, useCan, useDeleteWorkSchedule, useSaveWorkSchedule, useWorkSchedules,
  type WorkSchedule, type WorkScheduleInput, type WorkScheduleType,
} from '@/lib/hooks';

const hoje = () => new Date().toLocaleDateString('sv-SE');

/** Valores iniciais de cada tipo: 12x36 das 07h às 19h; comercial 44h de seg. a sex. (8h48 por dia). */
const PRESET: Record<WorkScheduleType, Omit<WorkScheduleInput, 'name' | 'type'>> = {
  FIXED_12X36: { startTime: '07:00', endTime: '19:00', workDays: [], restHours: 36, anchorDate: hoje(), toleranceMinutes: 15 },
  COMMERCIAL_44H: { startTime: '08:00', endTime: '17:48', workDays: [1, 2, 3, 4, 5], restHours: 0, anchorDate: null, toleranceMinutes: 15 },
  CUSTOM: { startTime: '09:00', endTime: '18:00', workDays: [1, 2, 3, 4, 5], restHours: 0, anchorDate: null, toleranceMinutes: 15 },
};

/** "seg., ter., qua." ou "a cada 48h (desde 19/10)" — resumo da escala no card. */
function resumo(s: Pick<WorkSchedule, 'type' | 'workDays' | 'restHours' | 'anchorDate' | 'startTime' | 'endTime'>) {
  const ciclo = s.type === 'FIXED_12X36' || (s.type === 'CUSTOM' && s.restHours > 0);
  const faixa = `${s.startTime}–${s.endTime}`;
  if (ciclo) return `${faixa} · trabalha e descansa ${s.restHours}h${s.anchorDate ? ` (referência ${s.anchorDate.split('-').reverse().join('/')})` : ''}`;
  return `${faixa} · ${s.workDays.map((d) => WEEKDAYS[d]).join(', ')}`;
}

/**
 * Escalas de trabalho (docs/escalas.md). Colaborador com escala só entra no sistema dentro do
 * turno; fora dele, só com liberação de plantão do gestor (Escalas → Aprovações).
 */
export default function EscalasPage() {
  const pode = useCan('team.manage');
  const escalas = useWorkSchedules();
  const agentes = useAgents();
  const assign = useAssignSchedule();
  const remove = useDeleteWorkSchedule();
  const [editando, setEditando] = useState<WorkSchedule | 'nova' | null>(null);
  const [apagar, setApagar] = useState<WorkSchedule | null>(null);

  // admin nunca é travado por horário: não aparece para receber escala
  const equipe = (agentes.data ?? []).filter((a) => a.isActive && (a.role === 'agent' || a.role === 'manager'));

  if (!pode) return <PageShell width="max-w-3xl"><Empty icon={<CalendarClock size={28} />} title="Sem permissão" text="Seu perfil de acesso não inclui gerenciar a equipe." /></PageShell>;

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Escalas de trabalho"
        subtitle="Quem tem escala só entra no sistema dentro do turno. Fora dele, o gestor libera um plantão excepcional."
        action={<Button onClick={() => setEditando('nova')}><Plus size={14} /> Nova escala</Button>}
      />
      <EscalasTabs />

      {escalas.isLoading ? <SkeletonRows /> : !escalas.data?.length ? (
        <Empty icon={<CalendarClock size={28} />} title="Nenhuma escala" text="Sem escala, ninguém é travado por horário." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {escalas.data.map((s) => (
            <li key={s.id} className="rounded-2xl border border-line bg-panel p-4 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink truncate">{s.name}</p>
                  <p className="text-[12px] text-muted">{WORK_SCHEDULE_TYPES.find((t) => t.id === s.type)?.label} · {resumo(s)}</p>
                </div>
                <button type="button" className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-field" aria-label="Editar" onClick={() => setEditando(s)}><Pencil size={14} /></button>
                <button type="button" className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-field" aria-label="Apagar" onClick={() => setApagar(s)}><Trash2 size={14} /></button>
              </div>
              <p className="text-[12px] text-faint">{s.users.length ? s.users.map((u) => u.name).join(', ') : 'Ninguém nesta escala ainda.'}</p>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl border border-line bg-panel">
        <h2 className="px-4 pt-4 font-display font-semibold text-ink text-sm">Colaboradores</h2>
        <p className="px-4 pb-2 text-[12.5px] text-muted">Associe cada pessoa a uma escala. Administradores não aparecem: nunca são travados por horário.</p>
        {agentes.isLoading ? <div className="p-4"><SkeletonRows /></div> : !equipe.length ? (
          <p className="px-4 pb-4 text-[13px] text-faint">Nenhum atendente ou gerente ativo.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {equipe.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-40">
                  <p className="text-sm text-ink truncate">{a.name}{a.isTemporary && <span className="ml-2 text-[11px] rounded bg-warn-soft text-warn-ink px-1.5 py-0.5">temporário</span>}</p>
                  <p className="text-[12px] text-faint truncate">{a.email}</p>
                </div>
                <select
                  className={cn(inputCls, 'w-56')}
                  aria-label={`Escala de ${a.name}`}
                  value={a.scheduleId ?? ''}
                  disabled={assign.isPending}
                  onChange={(e) => assign.mutate({ userId: a.id, scheduleId: e.target.value || null }, { onSuccess: () => toast.ok('Escala atualizada.'), onError: (err) => toast.err(err) })}
                >
                  <option value="">Sem escala (livre)</option>
                  {(escalas.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editando && <ScheduleForm escala={editando === 'nova' ? null : editando} onClose={() => setEditando(null)} />}
      <ConfirmDialog
        open={!!apagar}
        title="Apagar escala"
        text={`As pessoas da escala "${apagar?.name ?? ''}" ficam sem trava de horário.`}
        confirmLabel="Apagar"
        danger
        onClose={() => setApagar(null)}
        onConfirm={() => remove.mutateAsync(apagar!.id).then(() => toast.ok('Escala apagada.'), (err) => toast.err(err))}
      />
    </PageShell>
  );
}

function ScheduleForm({ escala, onClose }: { escala: WorkSchedule | null; onClose: () => void }) {
  const save = useSaveWorkSchedule();
  const [f, setF] = useState<WorkScheduleInput>(() => escala
    ? { name: escala.name, type: escala.type, startTime: escala.startTime, endTime: escala.endTime, workDays: escala.workDays, restHours: escala.restHours, anchorDate: escala.anchorDate, toleranceMinutes: escala.toleranceMinutes }
    : { name: '', type: 'COMMERCIAL_44H', ...PRESET.COMMERCIAL_44H });
  const set = (p: Partial<WorkScheduleInput>) => setF((cur) => ({ ...cur, ...p }));
  // CUSTOM escolhe entre dias da semana e ciclo; 12x36 é sempre ciclo
  const ciclo = f.type === 'FIXED_12X36' || (f.type === 'CUSTOM' && f.restHours > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({ ...f, id: escala?.id, anchorDate: ciclo ? f.anchorDate || hoje() : null });
      toast.ok(escala ? 'Escala salva.' : 'Escala criada.');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title={escala ? 'Editar escala' : 'Nova escala'}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Nome"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Plantão noturno A" maxLength={80} required /></Field>
        <div className="grid gap-2 sm:grid-cols-3">
          {WORK_SCHEDULE_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set({ type: t.id, ...(escala?.type === t.id ? {} : PRESET[t.id]) })}
              className={cn('rounded-xl border p-3 text-left', f.type === t.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-field')}
            >
              <p className="text-sm font-medium text-ink">{t.label}</p>
              <p className="text-[11.5px] text-muted">{t.desc}</p>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início do turno"><input type="time" className={inputCls} value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} required /></Field>
          <Field label="Fim do turno" hint="Antes do início = vira a meia-noite."><input type="time" className={inputCls} value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} required /></Field>
        </div>
        {f.type === 'CUSTOM' && (
          <div className="flex gap-2 text-sm">
            <button type="button" className={cn('rounded-lg border px-3 py-1.5', !ciclo ? 'border-accent bg-accent-soft' : 'border-line')} onClick={() => set({ restHours: 0 })}>Por dias da semana</button>
            <button type="button" className={cn('rounded-lg border px-3 py-1.5', ciclo ? 'border-accent bg-accent-soft' : 'border-line')} onClick={() => set({ restHours: f.restHours || 24, anchorDate: f.anchorDate || hoje() })}>Por ciclo (trabalho + descanso)</button>
          </div>
        )}
        {ciclo ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Horas de descanso" hint={f.type === 'FIXED_12X36' ? 'Padrão da 12x36: 36h.' : undefined}>
              <input type="number" min={1} max={168} className={inputCls} value={f.restHours} onChange={(e) => set({ restHours: Number(e.target.value) })} required />
            </Field>
            <Field label="Dia de referência" hint="Um dia em que o turno começa.">
              <input type="date" className={inputCls} value={f.anchorDate ?? ''} onChange={(e) => set({ anchorDate: e.target.value })} required />
            </Field>
          </div>
        ) : (
          <Field label="Dias de trabalho" hint="Dia em que o turno começa.">
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d, i) => {
                const on = f.workDays.includes(i);
                return (
                  <button key={d} type="button" onClick={() => set({ workDays: on ? f.workDays.filter((x) => x !== i) : [...f.workDays, i] })}
                    className={cn('w-11 rounded-lg border py-1.5 text-xs', on ? 'border-accent bg-accent text-white' : 'border-line text-ink hover:bg-field')}>{d}</button>
                );
              })}
            </div>
          </Field>
        )}
        <Field label="Tolerância (minutos)" hint="Quanto antes do início o login já é aceito.">
          <input type="number" min={0} max={120} className={inputCls} value={f.toleranceMinutes} onChange={(e) => set({ toleranceMinutes: Number(e.target.value) })} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
