'use client';
import { useEffect, useState } from 'react';
import { Clock, Plus, X, PowerOff, Power } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useSetBusinessHours, useTenantSettings, useUpdateTenantSettings, type BusinessHour } from '@/lib/hooks';

const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

/** Expediente do cliente: usado pelos fluxos (condição "horário comercial") e pelos disparos. */
export function BusinessHoursSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  const save = useSetBusinessHours();
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings.data) setHours(settings.data.hours.map(({ weekday, start, end }) => ({ weekday, start, end })));
  }, [settings.data]);

  if (!settings.data) return null;
  const s = settings.data;
  const byDay = (d: number) => hours.filter((h) => h.weekday === d);

  const set = (next: BusinessHour[]) => { setHours(next); setDirty(true); };
  const addInterval = (weekday: number) => set([...hours, { weekday, start: '09:00', end: '18:00' }]);
  const removeInterval = (weekday: number, i: number) => {
    let n = -1;
    set(hours.filter((h) => (h.weekday === weekday ? ++n !== i : true)));
  };
  const change = (weekday: number, i: number, patch: Partial<BusinessHour>) => {
    let n = -1;
    set(hours.map((h) => (h.weekday === weekday && ++n === i ? { ...h, ...patch } : h)));
  };

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold text-ink flex items-center gap-2"><Clock size={16} /> Horário de funcionamento</h3>
          <p className="text-sm text-muted mt-0.5">Usado pela condição <b>horário comercial</b> nos fluxos e pelos disparos. Sem nenhum intervalo cadastrado, o sistema considera sempre aberto.</p>
        </div>
        <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1 ${s.isOpenNow ? 'bg-ok-soft text-ok' : 'bg-field text-muted'}`}>
          {s.isOpenNow ? 'Aberto agora' : 'Fechado agora'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-field/60 p-3">
        <Button
          size="sm"
          variant={s.attendanceActive ? 'ghost' : 'subtle'}
          icon={s.attendanceActive ? <PowerOff size={14} /> : <Power size={14} />}
          loading={update.isPending}
          onClick={() => update.mutateAsync({ attendanceActive: !s.attendanceActive }).then(() => toast.ok(s.attendanceActive ? 'Atendimento desativado' : 'Atendimento reativado')).catch(toast.err)}
        >
          {s.attendanceActive ? 'Desativar atendimento' : 'Reativar atendimento'}
        </Button>
        <span className="text-[12px] text-muted">
          {s.attendanceActive ? 'Fecha tudo de uma vez, sem mexer nos horários (feriado, férias).' : 'Atendimento desativado: o sistema está fechado independente do horário.'}
        </span>
      </div>

      <div className="space-y-1.5">
        {DIAS.map((nome, d) => {
          const intervalos = byDay(d);
          return (
            <div key={d} className="flex flex-wrap items-center gap-2 py-1.5 border-b border-line last:border-0">
              <span className="w-32 text-[13px] text-ink">{nome}</span>
              {intervalos.length === 0 && <span className="text-[12px] text-faint flex-1">Fechado</span>}
              <div className="flex flex-wrap items-center gap-1.5 flex-1">
                {intervalos.map((h, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <input type="time" className={`${inputCls} w-28`} value={h.start} onChange={(e) => change(d, i, { start: e.target.value })} />
                    <span className="text-faint text-xs">às</span>
                    <input type="time" className={`${inputCls} w-28`} value={h.end} onChange={(e) => change(d, i, { end: e.target.value })} />
                    <button onClick={() => removeInterval(d, i)} className="text-faint hover:text-danger p-1" title="Remover intervalo"><X size={13} /></button>
                  </span>
                ))}
              </div>
              <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => addInterval(d)} title="Adicionar intervalo">Intervalo</Button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutateAsync(hours).then(() => { setDirty(false); toast.ok('Horário salvo'); }).catch(toast.err)}
        >
          Salvar horário
        </Button>
        <Button variant="ghost" onClick={() => set(s.suggested)}>Usar comercial (seg–sex, 8h–18h)</Button>
        {dirty && <span className="text-[12px] text-warn-ink">alterações não salvas</span>}
      </div>

      <label className="block space-y-1">
        <span className="text-[12px] text-muted">Fuso horário</span>
        <select
          className={`${inputCls} max-w-xs`}
          value={s.timezone}
          onChange={(e) => update.mutateAsync({ timezone: e.target.value }).then(() => toast.ok('Fuso atualizado')).catch(toast.err)}
        >
          {['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Rio_Branco', 'America/Noronha'].map((tz) => (
            <option key={tz} value={tz}>{tz.replace('America/', '').replace('_', ' ')}</option>
          ))}
        </select>
        <span className="block text-[11px] text-faint">Vale para o expediente, a agenda e os relatórios.</span>
      </label>
    </section>
  );
}
