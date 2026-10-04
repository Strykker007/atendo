'use client';
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Copy, FlaskConical, Plus, Power, PowerOff, Star, Trash2, X } from 'lucide-react';
import {
  BAND_BEHAVIOR_LABEL,
  CLOSED_BAND_ID,
  CLOSED_BAND_NAME,
  WEEKDAY_NAMES,
  bandById,
  closedBand,
  describeNextOpen,
  minutesToHm,
  nextOpenLocal,
  resolveSchedule,
  validateSchedule,
  type BandBehavior,
  type ScheduleBand,
  type ScheduleConfig,
  type ScheduleException,
  type ScheduleInterval,
  type ScheduleIssue,
} from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Field, Modal, inputCls } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { ContentPreview } from '@/components/flows/nodes';
import {
  useCreateSchedule,
  useDeleteSchedule,
  useFlows,
  useNumbers,
  useSchedules,
  useSetDefaultSchedule,
  useSetNumberSchedule,
  useTenantSettings,
  useUpdateSchedule,
  useUpdateTenantSettings,
  type BusinessSchedule,
} from '@/lib/hooks';
import { AutoContentEditor } from './AutoContent';

const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Rio_Branco', 'America/Noronha'];
const tzLabel = (tz: string) => tz.replace('America/', '').replace('_', ' ');
const COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#dc2626'];
const shortId = () => crypto.randomUUID().slice(0, 8);
const todayYmd = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (ymd: string) => ymd.split('-').reverse().join('/');

/**
 * Horários de atendimento (docs/horarios.md): quadros com faixas nomeadas, grade semanal,
 * exceções por data, resposta de cada faixa (mensagem ou fluxo) e simulação.
 */
export function ScheduleSection() {
  const settings = useTenantSettings();
  const schedules = useSchedules();
  const update = useUpdateTenantSettings();
  const create = useCreateSchedule();
  const [selected, setSelected] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);

  const list = schedules.data ?? [];
  const current = list.find((s) => s.id === selected) ?? list.find((s) => s.isDefault) ?? list[0];
  const s = settings.data;
  if (!s || !schedules.data) return null;

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold text-ink flex items-center gap-2"><CalendarClock size={16} /> Horários de atendimento</h3>
          <p className="text-sm text-muted mt-0.5">Faixas de horário com mensagem própria (ou um fluxo). Usado na entrada das mensagens, nas condições e atrasos dos fluxos e nos disparos.</p>
        </div>
        <span className={cn('shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1', s.isOpenNow ? 'bg-ok-soft text-ok' : 'bg-field text-muted')} title="Quadro padrão, agora">
          Agora: {s.currentBand}
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
          {s.attendanceActive ? 'Fecha tudo de uma vez, sem mexer nos horários (feriado, férias): vale a faixa Fechado em todos os quadros.' : 'Atendimento desativado: vale a faixa Fechado, independente do horário.'}
        </span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-4 text-sm text-muted space-y-2">
          <p>Nenhum quadro de horários: o atendimento é considerado <b>sempre aberto</b> e nenhuma mensagem de fechado é enviada.</p>
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setNovoAberto(true)}>Criar quadro (seg–sex, 8h–18h)</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {list.map((q) => (
              <button key={q.id} onClick={() => setSelected(q.id)} className={cn('rounded-full border px-3 py-1 text-[12px] inline-flex items-center gap-1', q.id === current?.id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>
                {q.isDefault && <Star size={11} />} {q.name}
              </button>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setNovoAberto(true)}>Novo quadro</Button>
          </div>
          {current && <ScheduleEditor key={current.id} schedule={current} attendanceActive={s.attendanceActive} canDelete={!current.isDefault} />}
          <NumberSchedules schedules={list} />
        </>
      )}

      <label className="block space-y-1 border-t border-line pt-3">
        <span className="text-[12px] text-muted">Fuso da empresa</span>
        <select className={`${inputCls} max-w-xs`} value={s.timezone} onChange={(e) => update.mutateAsync({ timezone: e.target.value }).then(() => toast.ok('Fuso atualizado')).catch(toast.err)}>
          {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tzLabel(tz)}</option>)}
        </select>
        <span className="block text-[11px] text-faint">Agenda, relatórios e “data/hora atual” nos fluxos. Cada quadro de horários tem o seu fuso.</span>
      </label>

      <NewScheduleModal
        open={novoAberto}
        first={list.length === 0}
        copyFrom={current}
        pending={create.isPending}
        onClose={() => setNovoAberto(false)}
        onCreate={(name, copyFromId) => create.mutateAsync({ name, copyFromId }).then((c) => { setSelected(c.id); setNovoAberto(false); toast.ok('Quadro criado'); }).catch(toast.err)}
      />
    </section>
  );
}

/** Criar quadro: nome e, se já houver quadros, começar como cópia do selecionado ou do zero (seg–sex 8h–18h). */
function NewScheduleModal({ open, first, copyFrom, pending, onClose, onCreate }: { open: boolean; first: boolean; copyFrom?: BusinessSchedule; pending: boolean; onClose: () => void; onCreate: (name: string, copyFromId?: string) => void }) {
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(true);
  useEffect(() => { if (open) { setName(first ? 'Horário padrão' : ''); setCopy(true); } }, [open, first]);
  return (
    <Modal open={open} onClose={onClose} title="Novo quadro de horários">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), !first && copy ? copyFrom?.id : undefined); }}>
        <Field label="Nome" hint={first ? 'O primeiro quadro vira o padrão da empresa.' : 'Ex.: "Loja do centro". Depois escolha em "Quadro por número" quais números usam este quadro.'}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required />
        </Field>
        {!first && copyFrom && (
          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={copy} onChange={() => setCopy(true)} /> Começar como cópia de “{copyFrom.name}”</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!copy} onChange={() => setCopy(false)} /> Começar do zero (seg–sex, 8h–18h)</label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={pending} disabled={!name.trim()}>Criar quadro</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Editor de um quadro: rascunho local, salva tudo de uma vez. */
function ScheduleEditor({ schedule, attendanceActive, canDelete }: { schedule: BusinessSchedule; attendanceActive: boolean; canDelete: boolean }) {
  const save = useUpdateSchedule();
  const del = useDeleteSchedule();
  const setDefault = useSetDefaultSchedule();
  const [draft, setDraft] = useState<{ name: string; timezone: string; config: ScheduleConfig }>({ name: schedule.name, timezone: schedule.timezone, config: schedule.config });
  const [dirty, setDirty] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { setDraft({ name: schedule.name, timezone: schedule.timezone, config: schedule.config }); setDirty(false); }, [schedule]);

  const cfg = draft.config;
  const issues = useMemo(() => validateSchedule(cfg), [cfg]);
  const issuesAt = (path: string) => issues.filter((i) => i.path === path);
  const setCfg = (patch: Partial<ScheduleConfig>) => { setDraft((d) => ({ ...d, config: { ...d.config, ...patch } })); setDirty(true); };

  const onSave = () => {
    if (issues.length) return toast.err(new Error(issues[0].message));
    save.mutateAsync({ id: schedule.id, ...draft }).then((r) => { setDirty(false); toast.ok(r.renamedConditions ? `Horários salvos — ${r.renamedConditions} condição(ões) de fluxo atualizada(s) com o novo nome da faixa` : 'Horários salvos'); }).catch(toast.err);
  };

  return (
    <div className="space-y-4 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 flex-1 min-w-40">
          <span className="text-[12px] text-muted">Nome do quadro</span>
          <input className={inputCls} value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }} />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-muted">Fuso do quadro</span>
          <select className={`${inputCls} w-40`} value={draft.timezone} onChange={(e) => { setDraft({ ...draft, timezone: e.target.value }); setDirty(true); }}>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tzLabel(tz)}</option>)}
          </select>
        </label>
        {schedule.isDefault ? (
          <span className="text-[11px] font-semibold rounded-full bg-accent-soft text-accent-ink px-2.5 py-1 inline-flex items-center gap-1 mb-1.5"><Star size={11} /> Padrão da empresa</span>
        ) : (
          <Button size="sm" variant="ghost" icon={<Star size={13} />} loading={setDefault.isPending} onClick={() => setDefault.mutateAsync(schedule.id).then(() => toast.ok('Quadro padrão alterado')).catch(toast.err)}>Tornar padrão</Button>
        )}
        {canDelete && <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirmDel(true)}>Excluir</Button>}
      </div>

      <BandsEditor cfg={cfg} setCfg={setCfg} issues={[...issuesAt('bands'), ...issuesAt('closed')]} />

      <div className="space-y-1.5">
        <h4 className="text-[13px] font-semibold text-ink">Grade semanal</h4>
        <p className="text-[11px] text-faint">Fora de qualquer intervalo vale <b>Fechado</b>. Intervalo com fim menor que o início atravessa a meia-noite (22:00–02:00); 00:00–00:00 é o dia inteiro.</p>
        {WEEKDAY_NAMES.map((nome, d) => (
          <DayRow
            key={d}
            label={nome}
            intervals={cfg.week[d] ?? []}
            bands={cfg.bands}
            issues={issuesAt(`week.${d}`)}
            onChange={(list) => setCfg({ week: cfg.week.map((w, i) => (i === d ? list : w)) })}
            onCopy={(days) => setCfg({ week: cfg.week.map((w, i) => (days.includes(i) ? (cfg.week[d] ?? []).map((x) => ({ ...x, id: shortId() })) : w)) })}
            weekday={d}
          />
        ))}
      </div>

      <ExceptionsEditor cfg={cfg} setCfg={setCfg} issuesAt={issuesAt} />

      <Simulator cfg={cfg} attendanceActive={attendanceActive} />

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button loading={save.isPending} disabled={!dirty} onClick={onSave}>Salvar horários</Button>
        {dirty && <span className="text-[12px] text-warn-ink">alterações não salvas</span>}
        {issues.length > 0 && <span className="text-[12px] text-danger">{issues.length} problema(s) para corrigir antes de salvar</span>}
      </div>

      <ConfirmDialog
        open={confirmDel}
        danger
        title="Excluir quadro de horários"
        text={`Excluir "${schedule.name}"? Os números que usam este quadro voltam para o quadro padrão.`}
        confirmLabel="Excluir"
        onClose={() => setConfirmDel(false)}
        onConfirm={() => del.mutateAsync(schedule.id).then(() => toast.ok('Quadro excluído')).catch(toast.err)}
      />
    </div>
  );
}

// ---------- faixas ----------

function BandsEditor({ cfg, setCfg, issues }: { cfg: ScheduleConfig; setCfg: (p: Partial<ScheduleConfig>) => void; issues: ScheduleIssue[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const upd = (id: string, patch: Partial<ScheduleBand>) => setCfg({ bands: cfg.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const used = (id: string) => cfg.week.some((d) => d.some((i) => i.bandId === id)) || cfg.exceptions.some((e) => e.intervals.some((i) => i.bandId === id));
  const add = () => {
    const id = shortId();
    setCfg({ bands: [...cfg.bands, { id, name: '', color: COLORS[cfg.bands.length % COLORS.length], open: true, behavior: 'notify_continue', reply: 'message', items: [] }] });
    setOpen(id);
  };
  const closed = closedBand(cfg);
  return (
    <div className="space-y-1.5">
      <h4 className="text-[13px] font-semibold text-ink">Faixas</h4>
      {cfg.bands.map((b) => (
        <div key={b.id} className="rounded-lg border border-line">
          <div className="flex flex-wrap items-center gap-2 p-2">
            <input type="color" className="w-7 h-7 rounded border border-line bg-panel" value={b.color ?? '#16a34a'} onChange={(e) => upd(b.id, { color: e.target.value })} title="Cor" />
            <input className={`${inputCls} flex-1 min-w-32 py-1`} placeholder='Nome da faixa (ex.: "Aberto", "Entrega encerrada")' value={b.name} onChange={(e) => upd(b.id, { name: e.target.value })} />
            <span className="text-[11px] text-muted">{BAND_BEHAVIOR_LABEL[b.behavior]}</span>
            <Button size="sm" variant="ghost" onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Fechar' : 'Configurar'}</Button>
            <button
              className="text-faint hover:text-danger p-1 disabled:opacity-40"
              disabled={used(b.id)}
              title={used(b.id) ? 'Em uso na grade: remova os intervalos desta faixa antes' : 'Excluir faixa'}
              onClick={() => setCfg({ bands: cfg.bands.filter((x) => x.id !== b.id) })}
            ><X size={14} /></button>
          </div>
          {open === b.id && (
            <div className="border-t border-line p-3 space-y-3">
              <label className="flex items-start gap-2 text-[12px] text-ink">
                <input type="checkbox" className="mt-0.5" checked={b.open} onChange={(e) => upd(b.id, { open: e.target.checked })} />
                <span>Conta como horário de atendimento <span className="block text-[11px] text-muted">Condição “dentro do horário de atendimento”, Atraso “até o próximo horário” e tempo limite “só no horário”. Desmarque em faixas como “Almoço”.</span></span>
              </label>
              <ReplyEditor value={b} onChange={(p) => upd(b.id, p)} />
            </div>
          )}
        </div>
      ))}
      <div className="rounded-lg border border-line bg-field/40">
        <div className="flex flex-wrap items-center gap-2 p-2">
          <span className="w-7 h-7 rounded border border-line" style={{ background: closed.color }} />
          <span className="flex-1 text-[13px] font-medium text-ink">{CLOSED_BAND_NAME} <span className="text-[11px] font-normal text-muted">— fora de qualquer intervalo</span></span>
          <span className="text-[11px] text-muted">{BAND_BEHAVIOR_LABEL[closed.behavior]}</span>
          <Button size="sm" variant="ghost" onClick={() => setOpen(open === CLOSED_BAND_ID ? null : CLOSED_BAND_ID)}>{open === CLOSED_BAND_ID ? 'Fechar' : 'Configurar'}</Button>
        </div>
        {open === CLOSED_BAND_ID && (
          <div className="border-t border-line p-3">
            <ReplyEditor value={closed} onChange={(p) => setCfg({ closed: { ...cfg.closed, ...p } })} />
          </div>
        )}
      </div>
      <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={add}>Nova faixa</Button>
      {issues.map((i, k) => <p key={k} className="text-[12px] text-danger">{i.message}</p>)}
    </div>
  );
}

/** Comportamento + resposta (mensagens no formato do Conteúdo ou um fluxo). */
function ReplyEditor({ value, onChange }: { value: Pick<ScheduleBand, 'behavior' | 'reply' | 'items' | 'flowId'>; onChange: (p: Partial<ScheduleBand>) => void }) {
  const flows = useFlows();
  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="text-[12px] text-muted">Quando chegar mensagem nesta faixa</span>
        <select className={inputCls} value={value.behavior} onChange={(e) => onChange({ behavior: e.target.value as BandBehavior })}>
          {(Object.keys(BAND_BEHAVIOR_LABEL) as BandBehavior[]).map((k) => <option key={k} value={k}>{BAND_BEHAVIOR_LABEL[k]}</option>)}
        </select>
        <span className="block text-[11px] text-faint">
          {value.behavior === 'normal' && 'Nada é enviado pela faixa: fluxos e gatilhos funcionam normalmente.'}
          {value.behavior === 'notify_continue' && 'Envia a resposta (uma vez por conversa em cada período da faixa) e o atendimento segue normal. Boas-vindas saem antes.'}
          {value.behavior === 'notify_stop' && 'Envia a resposta (uma vez por período) e mais nada: nenhum fluxo inicia nem recebe a mensagem, e boas-vindas não saem.'}
          {value.behavior === 'notify_fallback' && 'O atendimento segue normal; a resposta só sai se nenhum fluxo (gatilho ou fluxo padrão) responder. Era o antigo "aviso de fora do expediente".'}
        </span>
      </label>
      {value.behavior !== 'normal' && (
        <>
          <div className="flex gap-3 text-[12px]">
            <label className="inline-flex items-center gap-1.5"><input type="radio" checked={value.reply === 'message'} onChange={() => onChange({ reply: 'message' })} /> Enviar mensagem</label>
            <label className="inline-flex items-center gap-1.5"><input type="radio" checked={value.reply === 'flow'} onChange={() => onChange({ reply: 'flow' })} /> Iniciar um fluxo</label>
          </div>
          {value.reply === 'message' ? (
            <AutoContentEditor items={value.items ?? []} onChange={(items) => onChange({ items })} />
          ) : (
            <label className="block space-y-1">
              <select className={inputCls} value={value.flowId ?? ''} onChange={(e) => onChange({ flowId: e.target.value || null })}>
                <option value="">Escolha o fluxo…</option>
                {(flows.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}{f.isActive ? '' : ' (desativado)'}</option>)}
              </select>
              <span className="block text-[11px] text-faint">O fluxo inicia uma vez por período. Com o robô pausado na conversa, fluxo não inicia (só mensagem sai).</span>
            </label>
          )}
        </>
      )}
    </div>
  );
}

// ---------- grade ----------

function IntervalsEditor({ intervals, bands, onChange }: { intervals: ScheduleInterval[]; bands: ScheduleBand[]; onChange: (l: ScheduleInterval[]) => void }) {
  const upd = (id: string, patch: Partial<ScheduleInterval>) => onChange(intervals.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <div className="flex flex-wrap items-center gap-1.5 flex-1">
      {intervals.map((h) => (
        <span key={h.id} className="inline-flex items-center gap-1 rounded-lg border border-line px-1 py-0.5" style={{ borderLeft: `4px solid ${bands.find((b) => b.id === h.bandId)?.color ?? '#94a3b8'}` }}>
          <input type="time" className={`${inputCls} w-[6.5rem] py-1`} value={h.start} onChange={(e) => upd(h.id, { start: e.target.value })} />
          <span className="text-faint text-xs">às</span>
          <input type="time" className={`${inputCls} w-[6.5rem] py-1`} value={h.end} onChange={(e) => upd(h.id, { end: e.target.value })} />
          <select className={`${inputCls} w-auto py-1`} value={h.bandId} onChange={(e) => upd(h.id, { bandId: e.target.value })}>
            {!bands.some((b) => b.id === h.bandId) && <option value={h.bandId}>— faixa —</option>}
            {bands.map((b) => <option key={b.id} value={b.id}>{b.name || '(sem nome)'}</option>)}
          </select>
          <button onClick={() => onChange(intervals.filter((i) => i.id !== h.id))} className="text-faint hover:text-danger p-1" title="Remover intervalo"><X size={13} /></button>
        </span>
      ))}
    </div>
  );
}

/** Próximo intervalo sugerido: começa onde o último termina. */
const nextInterval = (list: ScheduleInterval[], bands: ScheduleBand[]): ScheduleInterval => {
  const last = list[list.length - 1];
  return last ? { id: shortId(), start: last.end, end: last.end < '23:00' ? `${String(Number(last.end.slice(0, 2)) + 1).padStart(2, '0')}${last.end.slice(2)}` : '23:59', bandId: last.bandId } : { id: shortId(), start: '08:00', end: '18:00', bandId: bands[0]?.id ?? '' };
};

function DayRow({ label, weekday, intervals, bands, issues, onChange, onCopy }: { label: string; weekday: number; intervals: ScheduleInterval[]; bands: ScheduleBand[]; issues: ScheduleIssue[]; onChange: (l: ScheduleInterval[]) => void; onCopy: (days: number[]) => void }) {
  const [copying, setCopying] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  return (
    <div className={cn('py-1.5 border-b border-line last:border-0', issues.length && 'bg-danger/5')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 text-[13px] text-ink">{label}</span>
        {intervals.length === 0 && <span className="text-[12px] text-faint flex-1">Fechado o dia todo</span>}
        {intervals.length > 0 && <IntervalsEditor intervals={intervals} bands={bands} onChange={onChange} />}
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} disabled={!bands.length} onClick={() => onChange([...intervals, nextInterval(intervals, bands)])} title="Adicionar intervalo">Intervalo</Button>
        <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => { setDays(WEEKDAY_NAMES.map((_, i) => i).filter((i) => i !== weekday)); setCopying(!copying); }} title="Copiar para os outros dias">Copiar</Button>
      </div>
      {copying && (
        <div className="mt-1.5 ml-28 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted">Copiar {label.toLowerCase()} para:</span>
          {WEEKDAY_NAMES.map((n, i) => i !== weekday && (
            <label key={i} className="inline-flex items-center gap-1"><input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((x) => x !== i))} /> {n.slice(0, 3)}</label>
          ))}
          <Button size="sm" onClick={() => { onCopy(days); setCopying(false); toast.ok('Copiado — lembre de salvar'); }} disabled={!days.length}>Copiar</Button>
        </div>
      )}
      {issues.map((i, k) => <p key={k} className="ml-28 text-[12px] text-danger">{i.message}</p>)}
    </div>
  );
}

// ---------- exceções ----------

function ExceptionsEditor({ cfg, setCfg, issuesAt }: { cfg: ScheduleConfig; setCfg: (p: Partial<ScheduleConfig>) => void; issuesAt: (p: string) => ScheduleIssue[] }) {
  const upd = (id: string, patch: Partial<ScheduleException>) => setCfg({ exceptions: cfg.exceptions.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const sorted = [...cfg.exceptions].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="space-y-1.5">
      <h4 className="text-[13px] font-semibold text-ink">Exceções por data</h4>
      <p className="text-[11px] text-faint">Feriados e datas especiais: o dia fica fechado ou com intervalos próprios, no lugar da grade semanal.</p>
      {sorted.map((ex) => (
        <div key={ex.id} className={cn('py-1.5 border-b border-line', issuesAt(`exceptions.${ex.id}`).length && 'bg-danger/5')}>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className={`${inputCls} w-40 py-1`} value={ex.date} onChange={(e) => upd(ex.id, { date: e.target.value })} />
            <input className={`${inputCls} w-40 py-1`} placeholder="Descrição (ex.: Natal)" value={ex.label ?? ''} onChange={(e) => upd(ex.id, { label: e.target.value || undefined })} />
            <label className="inline-flex items-center gap-1 text-[12px]"><input type="checkbox" checked={ex.closed} onChange={(e) => upd(ex.id, { closed: e.target.checked })} /> Fechado o dia todo</label>
            {!ex.closed && <IntervalsEditor intervals={ex.intervals} bands={cfg.bands} onChange={(intervals) => upd(ex.id, { intervals })} />}
            {!ex.closed && <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => upd(ex.id, { intervals: [...ex.intervals, nextInterval(ex.intervals, cfg.bands)] })}>Intervalo</Button>}
            <button onClick={() => setCfg({ exceptions: cfg.exceptions.filter((e) => e.id !== ex.id) })} className="text-faint hover:text-danger p-1 ml-auto" title="Remover exceção"><Trash2 size={13} /></button>
          </div>
          {issuesAt(`exceptions.${ex.id}`).map((i, k) => <p key={k} className="text-[12px] text-danger">{i.message}</p>)}
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setCfg({ exceptions: [...cfg.exceptions, { id: shortId(), date: todayYmd(), closed: true, intervals: [] }] })}>Nova exceção</Button>
      {issuesAt('exceptions').map((i, k) => <p key={k} className="text-[12px] text-danger">{i.message}</p>)}
    </div>
  );
}

// ---------- simular ----------

/** Escolhe dia e hora e mostra a faixa e a resposta que valeriam — com o que está na tela, sem salvar. */
function Simulator({ cfg, attendanceActive }: { cfg: ScheduleConfig; attendanceActive: boolean }) {
  const flows = useFlows();
  const [ymd, setYmd] = useState(todayYmd());
  const [hm, setHm] = useState('09:00');
  const minute = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const t = { ymd, minute };
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(ymd) && !Number.isNaN(minute);
  const st = valid ? resolveSchedule(cfg, t, { attendanceActive }) : null;
  const band = st ? bandById(cfg, st.band.id) : null;
  const next = valid && attendanceActive ? nextOpenLocal(cfg, t) : null;
  const flowName = band?.reply === 'flow' ? flows.data?.find((f) => f.id === band.flowId)?.name : undefined;
  return (
    <div className="space-y-2 rounded-lg bg-field/60 p-3">
      <h4 className="text-[13px] font-semibold text-ink flex items-center gap-1.5"><FlaskConical size={14} /> Simular</h4>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className={`${inputCls} w-40 py-1`} value={ymd} onChange={(e) => setYmd(e.target.value)} />
        <input type="time" className={`${inputCls} w-28 py-1`} value={hm} onChange={(e) => setHm(e.target.value)} />
        {valid && <span className="text-[12px] text-muted">{['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(`${ymd}T12:00:00Z`).getUTCDay()]}</span>}
      </div>
      {st && band && (
        <div className="space-y-1.5 text-[12px]">
          <p>
            <span className="inline-block rounded-full px-2 py-0.5 text-white text-[11px] font-semibold mr-1.5" style={{ background: band.color ?? '#94a3b8' }}>{band.name}</span>
            {BAND_BEHAVIOR_LABEL[band.behavior]} · {st.open ? 'conta como horário de atendimento' : 'fora do horário de atendimento'}
            {!attendanceActive && ' · atendimento desativado'}
          </p>
          {st.periodStart && <p className="text-muted">Período desde {fmtDate(st.periodStart.ymd)} {minutesToHm(st.periodStart.minute)} — a resposta sai uma vez por conversa neste período.</p>}
          {!st.open && <p className="text-muted">Próxima abertura: {next ? describeNextOpen(t, next) : 'não abre nos próximos 14 dias'}</p>}
          {band.behavior !== 'normal' && band.reply === 'message' && (band.items.length ? (
            <div className="space-y-1 max-w-sm">{band.items.map((it) => <ContentPreview key={it.id} item={it} />)}</div>
          ) : <p className="text-warn-ink">Sem mensagem configurada: nada é enviado.</p>)}
          {band.behavior !== 'normal' && band.reply === 'flow' && <p>Inicia o fluxo <b>{flowName ?? '(não escolhido)'}</b>.</p>}
        </div>
      )}
    </div>
  );
}

// ---------- número → quadro ----------

function NumberSchedules({ schedules }: { schedules: BusinessSchedule[] }) {
  const numbers = useNumbers();
  const set = useSetNumberSchedule();
  if (!numbers.data?.length || schedules.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="text-[13px] font-semibold text-ink">Quadro por número</h4>
      <p className="text-[11px] text-faint">Cada número usa o quadro padrão, a menos que tenha um próprio.</p>
      {numbers.data.map((n) => (
        <div key={n.id} className="flex flex-wrap items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: n.color }} />
          <span className="w-48 text-[13px] text-ink truncate">{n.label} <span className="text-faint">{n.phone}</span></span>
          <select className={`${inputCls} w-56 py-1`} value={n.scheduleId ?? ''} onChange={(e) => set.mutateAsync({ numberId: n.id, scheduleId: e.target.value || null }).then(() => toast.ok('Quadro do número atualizado')).catch(toast.err)}>
            <option value="">Padrão da empresa</option>
            {schedules.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
