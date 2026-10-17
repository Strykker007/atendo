'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Pencil, Trash2, Scissors, UserRound, Bell, FileCheck2 } from 'lucide-react';
import { TemplateFields, useTemplateChoice, type TemplateChoice } from '@/components/chat/TemplateFields';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { PhoneInput, formatPhone } from '@/components/ui/PhoneInput';
import { toast } from '@/components/ui/Toast';
import { useProfessionals, useServices, useSaveProfessional, useDeleteProfessional, useSaveService, useDeleteService, useSchedulingSettings, useUpdateSchedulingSettings, useSchedulingUsage, useNumbers, type Professional, type ServiceItem, type WorkingHour } from '@/lib/hooks';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PALETTE = ['#2f5bea', '#d9730d', '#158f6e', '#7c5cff', '#b5872a', '#c2357f'];
/** Antecedências oferecidas para os lembretes (minutos antes do horário). */
const REMINDER_PRESETS = [15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080];
const PRO_PRESETS = [0, 5, 10, 15, 30, 60, 120];

/** 1440 → "1 dia antes", 120 → "2 horas antes", 90 → "1h30 antes". */
function reminderLabel(min: number) {
  if (min <= 0) return 'Não avisar';
  if (min % 10080 === 0) return `${min / 10080} semana${min / 10080 > 1 ? 's' : ''} antes`;
  if (min % 1440 === 0) return `${min / 1440} dia${min / 1440 > 1 ? 's' : ''} antes`;
  if (min % 60 === 0) return `${min / 60} hora${min / 60 > 1 ? 's' : ''} antes`;
  if (min > 60) return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')} antes`;
  return `${min} min antes`;
}

const DEFAULT_HOURS: WorkingHour[] = [1, 2, 3, 4, 5].flatMap((w) => [{ weekday: w, start: '09:00', end: '12:00' }, { weekday: w, start: '13:00', end: '18:00' }]).concat([{ weekday: 6, start: '09:00', end: '14:00' }]);

export default function ConfigurarAgendaPage() {
  const pros = useProfessionals();
  const services = useServices();
  const settings = useSchedulingSettings();
  const numbers = useNumbers();
  const saveSettings = useUpdateSchedulingSettings();
  const savePro = useSaveProfessional(); const delPro = useDeleteProfessional();
  const saveSvc = useSaveService(); const delSvc = useDeleteService();
  const [proModal, setProModal] = useState<Partial<Professional> | null>(null);
  const [svcModal, setSvcModal] = useState<Partial<ServiceItem> | null>(null);
  const [confirm, setConfirm] = useState<DeleteTarget | null>(null);
  // número que manda os lembretes (o escolhido ou o primeiro conectado, como no servidor): se for
  // a API oficial, quem não escreveu nas últimas 24h só recebe por template
  const envia = numbers.data?.find((n) => n.id === settings.data?.numberId) ?? numbers.data?.find((n) => n.isActive && n.status === 'connected');
  const lembreteMeta = envia?.provider === 'meta' ? envia : null;

  return (
    <PageShell width="max-w-5xl">
      <PageHeader title="Profissionais e serviços" subtitle="Quem atende, o que oferece, e quando os lembretes disparam." action={<Link href="/agenda"><Button variant="ghost" icon={<ArrowLeft size={15} />}>Voltar à agenda</Button></Link>} />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Profissionais */}
        <section className="rounded-2xl bg-panel border border-line">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2"><UserRound size={16} className="text-muted" /><span className="font-display font-semibold text-ink flex-1">Profissionais</span><Button size="sm" icon={<Plus size={13} />} onClick={() => setProModal({ color: PALETTE[(pros.data?.length ?? 0) % PALETTE.length], hours: DEFAULT_HOURS })}>Novo</Button></div>
          <ul className="divide-y divide-line">
            {pros.data?.map((p) => (
              <li key={p.id} className={cn('px-4 py-3 flex items-center gap-3', !p.isActive && 'opacity-50')}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color }} />
                <div className="min-w-0 flex-1"><div className="text-sm font-medium text-ink">{p.name}{!p.isActive && <span className="text-xs text-muted"> · inativo</span>}</div><div className="text-xs text-muted">{p.phone ? `WhatsApp ${formatPhone(p.phone)}` : <span className="text-warn">sem WhatsApp — não recebe o aviso do próximo cliente</span>} · {new Set(p.hours.map((h) => h.weekday)).size} dias/semana</div></div>
                <button onClick={() => setProModal(p)} className="text-faint hover:text-ink p-1"><Pencil size={15} /></button>
                <button title="Excluir" onClick={() => setConfirm({ kind: 'pro', id: p.id, name: p.name, isActive: p.isActive })} className="text-faint hover:text-danger p-1"><Trash2 size={15} /></button>
              </li>
            ))}
            {pros.data?.length === 0 && <li className="px-4 py-6 text-sm text-muted text-center">Nenhum profissional ainda.</li>}
          </ul>
        </section>

        {/* Serviços */}
        <section className="rounded-2xl bg-panel border border-line">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2"><Scissors size={16} className="text-muted" /><span className="font-display font-semibold text-ink flex-1">Serviços</span><Button size="sm" icon={<Plus size={13} />} onClick={() => setSvcModal({ durationMin: 30 })}>Novo</Button></div>
          <ul className="divide-y divide-line">
            {services.data?.map((s) => (
              <li key={s.id} className={cn('px-4 py-3 flex items-center gap-3', !s.isActive && 'opacity-50')}>
                <div className="min-w-0 flex-1"><div className="text-sm font-medium text-ink">{s.name}{!s.isActive && <span className="text-xs text-muted"> · inativo</span>}</div><div className="text-xs text-muted tnum">{s.durationMin} min{Number(s.price) ? ` · R$ ${Number(s.price).toFixed(2)}` : ''}</div></div>
                <button onClick={() => setSvcModal(s)} className="text-faint hover:text-ink p-1"><Pencil size={15} /></button>
                <button title="Excluir" onClick={() => setConfirm({ kind: 'svc', id: s.id, name: s.name, isActive: s.isActive })} className="text-faint hover:text-danger p-1"><Trash2 size={15} /></button>
              </li>
            ))}
            {services.data?.length === 0 && <li className="px-4 py-6 text-sm text-muted text-center">Nenhum serviço ainda.</li>}
          </ul>
        </section>
      </div>

      {/* Lembretes */}
      {settings.data && (
        <section className="rounded-2xl bg-panel border border-line p-4 space-y-3">
          <div className="flex items-center gap-2"><Bell size={16} className="text-muted" /><span className="font-display font-semibold text-ink">Lembretes e horários</span></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Aviso ao profissional" hint="quando avisar quem vai atender"><select className={inputCls} value={settings.data.proReminderMinutes} onChange={(e) => saveSettings.mutateAsync({ proReminderMinutes: Number(e.target.value) }).then(() => toast.ok('Salvo')).catch(toast.err)}>{[...new Set([...PRO_PRESETS, settings.data.proReminderMinutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{reminderLabel(m)}</option>)}</select></Field>
            
            <Field label="Intervalo dos horários" hint="minutos"><input type="number" min={5} step={5} className={inputCls} defaultValue={settings.data.slotMinutes} onBlur={(e) => saveSettings.mutateAsync({ slotMinutes: Number(e.target.value) }).then(() => toast.ok('Salvo')).catch(toast.err)} /></Field>
            <Field label="Número que envia" hint="lembretes e avisos"><select className={inputCls} value={settings.data.numberId ?? ''} onChange={(e) => saveSettings.mutateAsync({ numberId: e.target.value || undefined }).then(() => toast.ok('Salvo')).catch(toast.err)}><option value="">Primeiro conectado</option>{numbers.data?.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
          </div>
          <ReminderPicker value={settings.data.clientReminderMinutes} pending={saveSettings.isPending} onChange={(clientReminderMinutes) => saveSettings.mutateAsync({ clientReminderMinutes }).then(() => toast.ok('Salvo')).catch(toast.err)} />
          {lembreteMeta && <ReminderTemplate key={lembreteMeta.id} numberId={lembreteMeta.id} saved={settings.data.reminderTemplate ?? null} />}
        </section>
      )}

      <ProfessionalModal value={proModal} onClose={() => setProModal(null)} onSave={(p) => savePro.mutateAsync({ id: p.id, name: p.name, phone: p.phone ?? undefined, color: p.color, isActive: p.isActive, hours: p.hours.map((h) => ({ weekday: h.weekday, start: h.start, end: h.end })) }).then(() => { toast.ok('Profissional salvo'); setProModal(null); }).catch(toast.err)} pending={savePro.isPending} />
      <ServiceModal value={svcModal} onClose={() => setSvcModal(null)} onSave={(s) => saveSvc.mutateAsync({ id: s.id, name: s.name, durationMin: s.durationMin, price: s.price, isActive: s.isActive }).then(() => { toast.ok('Serviço salvo'); setSvcModal(null); }).catch(toast.err)} pending={saveSvc.isPending} />
      <DeleteDialog target={confirm} onClose={() => setConfirm(null)} onDelete={(withHistory) => (confirm!.kind === 'pro' ? delPro : delSvc).mutateAsync({ id: confirm!.id, withHistory }).then(() => { toast.ok('Excluído'); setConfirm(null); }).catch(toast.err)} onDeactivate={() => (confirm!.kind === 'pro' ? savePro.mutateAsync({ id: confirm!.id, isActive: false }) : saveSvc.mutateAsync({ id: confirm!.id, isActive: false })).then(() => { toast.ok('Desativado'); setConfirm(null); }).catch(toast.err)} />
    </PageShell>
  );
}

/** Lembretes ao cliente: marca as antecedências em vez de digitar minutos. */
function ReminderPicker({ value, onChange, pending }: { value: number[]; onChange: (v: number[]) => void; pending: boolean }) {
  // valor antigo fora das opções (digitado na versão anterior) continua aparecendo e pode ser desmarcado
  const options = [...new Set([...REMINDER_PRESETS, ...value])].sort((a, b) => b - a);
  const toggle = (m: number) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-ink">Lembretes ao cliente</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((m) => {
          const on = value.includes(m);
          return <button key={m} type="button" disabled={pending} onClick={() => toggle(m)} aria-pressed={on} className={cn('rounded-full border px-3 py-1 text-xs transition', on ? 'border-accent bg-accent-soft text-accent-ink font-medium' : 'border-line text-muted hover:text-ink hover:border-ink/30')}>{reminderLabel(m)}</button>;
        })}
      </div>
      <p className="text-xs text-muted">{value.length ? `O cliente recebe ${value.length} lembrete${value.length > 1 ? 's' : ''}.` : 'Nenhum lembrete: o cliente não é avisado antes do horário.'}</p>
    </div>
  );
}

type DeleteTarget = { kind: 'pro' | 'svc'; id: string; name: string; isActive: boolean };

/**
 * Exclusão definitiva (docs/13-agendamento.md#excluir): com agendamento futuro não deixa; com só
 * histórico avisa que ele some junto e oferece desativar, que preserva tudo.
 */
function DeleteDialog({ target, onClose, onDelete, onDeactivate }: { target: DeleteTarget | null; onClose: () => void; onDelete: (withHistory: boolean) => Promise<unknown>; onDeactivate: () => Promise<unknown> }) {
  const usage = useSchedulingUsage(target?.kind === 'pro' ? 'professionals' : 'services', target?.id ?? null);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>) => { setBusy(true); fn().finally(() => setBusy(false)); };
  const u = usage.data;
  const what = target?.kind === 'pro' ? 'profissional' : 'serviço';
  return (
    <Modal open={!!target} onClose={busy ? () => undefined : onClose} title={`Excluir ${what}`} width="max-w-sm">
      {!u ? <p className="text-sm text-muted">Conferindo os agendamentos…</p> : (
        <p className="text-sm text-muted">
          {u.future > 0
            ? <><b className="text-ink">"{target?.name}"</b> tem {u.future} agendamento{u.future > 1 ? 's' : ''} futuro{u.future > 1 ? 's' : ''}. Cancele ou remarque antes de excluir — ou desative para não receber novos.</>
            : u.past > 0
              ? <><b className="text-ink">"{target?.name}"</b> tem {u.past} agendamento{u.past > 1 ? 's' : ''} no histórico. Excluir apaga esse histórico junto (some também da ficha dos clientes). Para só tirar da agenda e guardar o histórico, desative.</>
              : <><b className="text-ink">"{target?.name}"</b> nunca foi usado em agendamentos e será excluído definitivamente.</>}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-5">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Voltar</Button>
        {u && (u.future > 0 || u.past > 0) && target?.isActive && <Button variant="ghost" loading={busy} onClick={() => run(onDeactivate)}>Desativar</Button>}
        {u && u.future === 0 && <Button variant="danger" loading={busy} onClick={() => run(() => onDelete(u.past > 0))}>{u.past > 0 ? 'Excluir com histórico' : 'Excluir'}</Button>}
      </div>
    </Modal>
  );
}

/**
 * Template do lembrete na API oficial. A Meta só deixa falar com quem não escreveu nas últimas
 * 24h por template aprovado; sem ele, o lembrete dessas pessoas não sai.
 */
function ReminderTemplate({ numberId, saved }: { numberId: string; saved: TemplateChoice | null }) {
  const choice = useTemplateChoice(numberId, true, saved);
  const save = useUpdateSchedulingSettings();
  return (
    <div className="border-t border-line pt-3 space-y-3">
      <div className="flex items-center gap-2"><FileCheck2 size={15} className="text-muted" /><span className="text-sm font-semibold text-ink">Template do lembrete (API oficial)</span></div>
      <p className="text-xs text-muted">Usado quando o cliente não escreveu nas últimas 24h — fora disso a Meta recusa mensagem livre. Para o cliente confirmar pelo próprio lembrete, crie os botões de resposta rápida <b>Confirmar</b> e <b>Remarcar</b> no template.{!saved && <b className="text-warn-ink"> Sem template, esses lembretes não são enviados.</b>}</p>
      <div className="max-w-xl space-y-3">
        <TemplateFields choice={choice} hint={<>Variáveis do agendamento: {'{{servico}}'}, {'{{profissional}}'}, {'{{data}}'}, {'{{hora}}'}, {'{{agendamento}}'} — e as do contato, como {'{{contact.first_name}}'}.</>} />
        <div className="flex gap-2">
          <Button size="sm" disabled={!choice.valid} loading={save.isPending} onClick={() => save.mutateAsync({ reminderTemplate: choice.value }).then(() => toast.ok('Template do lembrete salvo')).catch(toast.err)}>Salvar template</Button>
          {saved && <Button size="sm" variant="ghost" onClick={() => save.mutateAsync({ reminderTemplate: null }).then(() => { choice.reset(); toast.ok('Template removido'); }).catch(toast.err)}>Remover</Button>}
        </div>
      </div>
    </div>
  );
}

function ProfessionalModal({ value, onClose, onSave, pending }: { value: Partial<Professional> | null; onClose: () => void; onSave: (p: Partial<Professional> & { hours: WorkingHour[] }) => void; pending: boolean }) {
  const [f, setF] = useState<Partial<Professional> & { hours: WorkingHour[] }>({ hours: [], ...(value ?? {}) });
  // reinicia ao abrir
  const [last, setLast] = useState(value);
  if (value !== last) { setLast(value); setF({ hours: [], ...(value ?? {}) }); }
  const dayHours = (w: number) => f.hours.filter((h) => h.weekday === w);
  const setDay = (w: number, hs: WorkingHour[]) => setF({ ...f, hours: [...f.hours.filter((h) => h.weekday !== w), ...hs] });
  return (
    <Modal open={!!value} onClose={onClose} title={f.id ? 'Editar profissional' : 'Novo profissional'} width="max-w-lg">
      <form onSubmit={(e) => { e.preventDefault(); onSave(f); }} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome"><input className={inputCls} value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
          <Field label="WhatsApp" hint="recebe o aviso do próximo cliente"><PhoneInput value={f.phone ?? ''} onChange={(d) => setF({ ...f, phone: d })} /></Field>
        </div>
        <Field label="Cor na agenda"><div className="flex gap-2">{PALETTE.map((c) => <button type="button" key={c} onClick={() => setF({ ...f, color: c })} className="w-7 h-7 rounded-full" style={{ background: c, boxShadow: f.color === c ? `0 0 0 2px var(--panel), 0 0 0 4px ${c}` : undefined }} />)}</div></Field>
        <Field label="Horários de trabalho" hint="Marque os dias e ajuste os intervalos (o robô só oferece horários dentro deles)">
          <div className="space-y-1.5">
            {DAYS.map((d, w) => {
              const hs = dayHours(w);
              return (
                <div key={w} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1.5 w-14"><input type="checkbox" checked={hs.length > 0} onChange={(e) => setDay(w, e.target.checked ? [{ weekday: w, start: '09:00', end: '18:00' }] : [])} /> {d}</label>
                  {hs.sort((a, b) => a.start.localeCompare(b.start)).map((h, i) => (
                    <span key={i} className="flex items-center gap-1"><input type="time" className="rounded-md border border-line bg-panel text-ink px-1.5 py-0.5 text-xs" value={h.start} onChange={(e) => setDay(w, hs.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />–<input type="time" className="rounded-md border border-line bg-panel text-ink px-1.5 py-0.5 text-xs" value={h.end} onChange={(e) => setDay(w, hs.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />{hs.length > 1 && <button type="button" className="text-faint hover:text-danger" onClick={() => setDay(w, hs.filter((_, j) => j !== i))}>×</button>}</span>
                  ))}
                  {hs.length > 0 && hs.length < 3 && <button type="button" className="text-[11px] text-accent-ink" onClick={() => setDay(w, [...hs, { weekday: w, start: '13:00', end: '18:00' }])}>+ intervalo</button>}
                </div>
              );
            })}
          </div>
        </Field>
        {f.id && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.isActive ?? true} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo</label>}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={pending} loadingText="Salvando…">Salvar</Button></div>
      </form>
    </Modal>
  );
}

function ServiceModal({ value, onClose, onSave, pending }: { value: Partial<ServiceItem> | null; onClose: () => void; onSave: (s: Omit<Partial<ServiceItem>, 'price'> & { price?: number }) => void; pending: boolean }) {
  const [f, setF] = useState<Partial<ServiceItem>>(value ?? {});
  const [last, setLast] = useState(value);
  if (value !== last) { setLast(value); setF(value ?? {}); }
  return (
    <Modal open={!!value} onClose={onClose} title={f.id ? 'Editar serviço' : 'Novo serviço'} width="max-w-sm">
      <form onSubmit={(e) => { e.preventDefault(); const { price, ...rest } = f; onSave({ ...rest, price: Number(price ?? 0) }); }} className="space-y-4">
        <Field label="Nome"><input className={inputCls} value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="Corte + barba" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duração (min)"><input type="number" min={5} step={5} className={inputCls} value={f.durationMin ?? 30} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} required /></Field>
          <Field label="Preço (R$)"><input type="number" min={0} step={1} className={inputCls} value={f.price ?? ''} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        </div>
        {f.id && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.isActive ?? true} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo</label>}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={pending} loadingText="Salvando…">Salvar</Button></div>
      </form>
    </Modal>
  );
}
