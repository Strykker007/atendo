'use client';
import { useMemo, useState } from 'react';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { EscalasTabs } from '@/components/escalas/EscalasTabs';
import {
  useCan, useCreateShiftException, useMoveShift, useRemoveShiftException, useScheduleCalendar,
  type CalendarShift, type ScheduleCalendar,
} from '@/lib/hooks';

// ---------- datas em "AAAA-MM-DD" (dia local do cliente; a API devolve no fuso da empresa) ----------
const toDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => ymdOf(new Date(toDate(ymd).getTime() + n * 86_400_000));
/** segunda-feira da semana do dia */
const mondayOf = (ymd: string) => addDays(ymd, -((toDate(ymd).getUTCDay() + 6) % 7));
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dm = (ymd: string) => ymd.slice(8, 10) + '/' + ymd.slice(5, 7);
const diaSemana = (ymd: string) => DIAS[toDate(ymd).getUTCDay()];
const hojeLocal = () => new Date().toLocaleDateString('sv-SE');

/** Cor fixa por pessoa (na ordem da equipe), legível no claro e no escuro. */
const corDe = (i: number) => {
  const h = (i * 67) % 360;
  return { background: `hsl(${h} 70% 50% / 0.14)`, borderColor: `hsl(${h} 60% 45% / 0.55)` };
};

type Turno = CalendarShift & { nome: string; cor: number; editavel: boolean };
type Mover = { turno: Turno; toDate: string };

/**
 * Calendário da escala (docs/escalas.md#calendário): os turnos de cada dia, calculados da escala
 * de cada pessoa, com folgas e turnos extras. Semana em quadro (arrastar para outro dia remaneja
 * ou passa para outra pessoa) e mês em grade.
 */
export default function CalendarioEscalaPage() {
  const pode = useCan('team.manage');
  const [visao, setVisao] = useState<'semana' | 'mes'>('semana');
  const [ref, setRef] = useState(hojeLocal);
  const [pessoa, setPessoa] = useState('');
  const [aberto, setAberto] = useState<Turno | null>(null);
  const [mover, setMover] = useState<Mover | null>(null);
  const [novo, setNovo] = useState<{ date: string; userId?: string } | null>(null);
  const removeExc = useRemoveShiftException();

  // período: a semana (seg→dom) ou a grade do mês (da segunda antes do dia 1 ao domingo depois do último)
  const { from, to, dias } = useMemo(() => {
    if (visao === 'semana') {
      const f = mondayOf(ref);
      return { from: f, to: addDays(f, 6), dias: Array.from({ length: 7 }, (_, i) => addDays(f, i)) };
    }
    const primeiro = ref.slice(0, 8) + '01';
    const ultimo = addDays(ymdOf(new Date(Date.UTC(toDate(ref).getUTCFullYear(), toDate(ref).getUTCMonth() + 1, 1, 12))), -1);
    const f = mondayOf(primeiro);
    const t = addDays(mondayOf(ultimo), 6);
    const n = Math.round((toDate(t).getTime() - toDate(f).getTime()) / 86_400_000) + 1;
    return { from: f, to: t, dias: Array.from({ length: n }, (_, i) => addDays(f, i)) };
  }, [visao, ref]);

  const cal = useScheduleCalendar(from, to);
  const move = useMoveShift();
  const data = cal.data;

  const porDia = useMemo(() => agrupar(data, pessoa), [data, pessoa]);
  const titulo = visao === 'semana'
    ? `${dm(from)} a ${dm(to)}`
    : `${MESES[toDate(ref).getUTCMonth()]} de ${toDate(ref).getUTCFullYear()}`;
  const passo = (n: number) => setRef(visao === 'semana' ? addDays(ref, 7 * n) : ymdOf(new Date(Date.UTC(toDate(ref).getUTCFullYear(), toDate(ref).getUTCMonth() + n, 1, 12))));

  function onDragEnd(r: DropResult) {
    if (!r.destination || !data) return;
    const toDate_ = r.destination.droppableId;
    const [userId, date] = r.draggableId.split('|');
    if (toDate_ === date) return;
    const turno = porDia.get(date)?.turnos.find((t) => t.userId === userId);
    if (turno) setMover({ turno, toDate: toDate_ });
  }

  if (!pode) return <PageShell width="max-w-3xl"><Empty icon={<CalendarClock size={28} />} title="Sem permissão" text="Seu perfil de acesso não inclui gerenciar a equipe." /></PageShell>;

  const pessoas = data?.users ?? [];
  const semEscala = pessoas.filter((p) => !p.scheduleId);

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Calendário da escala"
        subtitle="Os turnos de cada dia. Arraste um turno para outro dia para remanejar ou passar para outra pessoa; clique para dar folga."
        action={<Button onClick={() => setNovo({ date: data?.today ?? hojeLocal() })}><Plus size={14} /> Turno extra</Button>}
      />
      <EscalasTabs />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-panel p-0.5">
          {(['semana', 'mes'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVisao(v)} aria-pressed={visao === v}
              className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium', visao === v ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink')}>
              {v === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-field" aria-label="Anterior" onClick={() => passo(-1)}><ChevronLeft size={16} /></button>
          <button type="button" className="rounded-md px-2 py-1 text-[13px] text-muted hover:text-ink hover:bg-field" onClick={() => setRef(data?.today ?? hojeLocal())}>Hoje</button>
          <button type="button" className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-field" aria-label="Próximo" onClick={() => passo(1)}><ChevronRight size={16} /></button>
        </div>
        <p className="font-display font-semibold text-ink capitalize">{titulo}</p>
        <select className={cn(inputCls, 'w-48 ml-auto')} aria-label="Filtrar por pessoa" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
          <option value="">Toda a equipe</option>
          {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!!pessoas.length && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Legenda">
          {pessoas.map((p, i) => (
            <li key={p.id} className="rounded-full border px-2 py-0.5 text-[11.5px] text-ink" style={corDe(i)}>
              {p.name}{p.scheduleName ? <span className="text-muted"> · {p.scheduleName}</span> : <span className="text-faint"> · sem escala</span>}
            </li>
          ))}
        </ul>
      )}
      {!!semEscala.length && (
        <p className="text-[12px] text-faint">
          Sem escala, ninguém é travado por horário: o turno extra de {semEscala.map((p) => p.name).join(', ')} aparece aqui só para organizar.
        </p>
      )}

      {cal.isLoading ? <SkeletonRows /> : !pessoas.length ? (
        <Empty icon={<CalendarClock size={28} />} title="Ninguém na equipe" text="Atendentes e gerentes ativos aparecem aqui. Administradores não têm escala." />
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          {visao === 'semana' ? (
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="grid grid-cols-7 gap-2 min-w-[980px]">
                {dias.map((d) => (
                  <Coluna key={d} date={d} hoje={d === data?.today} grupo={porDia.get(d)} onAbrir={setAberto} onNovo={() => setNovo({ date: d, userId: pessoa || undefined })}
                    onDesfazerFolga={(id) => removeExc.mutate(id, { onSuccess: () => toast.ok('Folga desfeita.'), onError: (e) => toast.err(e) })} />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-panel overflow-hidden">
              <div className="grid grid-cols-7 border-b border-line bg-field/60">
                {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => <p key={d} className="px-2 py-1.5 text-[11.5px] font-medium text-muted uppercase">{d}</p>)}
              </div>
              <div className="grid grid-cols-7">
                {dias.map((d) => (
                  <CelulaMes key={d} date={d} hoje={d === data?.today} foraDoMes={d.slice(0, 7) !== ref.slice(0, 7)} grupo={porDia.get(d)} onAbrir={setAberto}
                    onNovo={() => setNovo({ date: d, userId: pessoa || undefined })} />
                ))}
              </div>
            </div>
          )}
        </DragDropContext>
      )}

      {aberto && data && (
        <TurnoModal turno={aberto} data={data} onClose={() => setAberto(null)} onMover={() => { setMover({ turno: aberto, toDate: aberto.date }); setAberto(null); }} />
      )}
      {mover && data && <MoverModal mover={mover} data={data} pending={move.isPending} onClose={() => setMover(null)}
        onConfirm={(toUserId, toDate_, reason) => move.mutate({ userId: mover.turno.userId, date: mover.turno.date, toUserId, toDate: toDate_, reason }, {
          onSuccess: () => { toast.ok('Turno remanejado.'); setMover(null); },
          onError: (e) => toast.err(e),
        })} />}
      {novo && data && <ExtraModal inicial={novo} data={data} onClose={() => setNovo(null)} />}
    </PageShell>
  );
}

type Grupo = { turnos: Turno[]; folgas: { id: string; userId: string; nome: string; cor: number; reason: string | null }[]; liberados: { nome: string; cor: number }[] };

/** Turnos, folgas e liberações de cada dia, já com nome e cor da pessoa. */
function agrupar(data: ScheduleCalendar | undefined, pessoa: string) {
  const map = new Map<string, Grupo>();
  if (!data) return map;
  const idx = new Map(data.users.map((u, i) => [u.id, i]));
  const user = new Map(data.users.map((u) => [u.id, u]));
  const g = (d: string) => map.get(d) ?? (map.set(d, { turnos: [], folgas: [], liberados: [] }), map.get(d)!);
  for (const s of data.shifts) {
    if (pessoa && s.userId !== pessoa) continue;
    const u = user.get(s.userId);
    if (u) g(s.date).turnos.push({ ...s, nome: u.name, cor: idx.get(s.userId)!, editavel: u.editable });
  }
  for (const o of data.offs) {
    if (pessoa && o.userId !== pessoa) continue;
    const u = user.get(o.userId);
    if (u) g(o.date).folgas.push({ id: o.id, userId: o.userId, nome: u.name, cor: idx.get(o.userId)!, reason: o.reason });
  }
  for (const o of data.overrides) {
    if (pessoa && o.userId !== pessoa) continue;
    const u = user.get(o.userId);
    if (!u) continue;
    // liberação aparece em cada dia que ela toca (dia local do navegador; serve para visualizar)
    for (let d = new Date(o.validFrom).toLocaleDateString('sv-SE'); d <= new Date(o.validUntil).toLocaleDateString('sv-SE'); d = addDays(d, 1)) {
      g(d).liberados.push({ nome: u.name, cor: idx.get(o.userId)! });
    }
  }
  for (const v of map.values()) v.turnos.sort((a, b) => a.start.localeCompare(b.start) || a.nome.localeCompare(b.nome));
  return map;
}

function CartaoTurno({ t, index, compacto, onAbrir }: { t: Turno; index: number; compacto?: boolean; onAbrir: (t: Turno) => void }) {
  return (
    <Draggable draggableId={`${t.userId}|${t.date}`} index={index} isDragDisabled={!t.editavel}>
      {(p) => (
        <button
          type="button"
          ref={p.innerRef}
          {...p.draggableProps}
          {...p.dragHandleProps}
          onClick={() => onAbrir(t)}
          style={{ ...corDe(t.cor), ...p.draggableProps.style }}
          className={cn('w-full text-left rounded-lg border', compacto ? 'px-1.5 py-0.5 text-[11px] mb-1' : 'px-2 py-1.5 mb-1.5')}
          title={`${t.nome} · ${t.start}–${t.end}${t.source === 'extra' ? ' · turno extra' : ''}`}
        >
          {compacto ? (
            <span className="block truncate text-ink"><span className="text-muted">{t.start}</span> {t.nome}</span>
          ) : (
            <>
              <span className="block truncate text-[13px] font-medium text-ink">{t.nome}</span>
              <span className="block text-[11.5px] text-muted">
                {t.start}–{t.end}{t.source === 'extra' && <span className="ml-1 rounded bg-warn-soft text-warn-ink px-1">extra</span>}
              </span>
            </>
          )}
        </button>
      )}
    </Draggable>
  );
}

function Coluna({ date, hoje, grupo, onAbrir, onNovo, onDesfazerFolga }: { date: string; hoje: boolean; grupo?: Grupo; onAbrir: (t: Turno) => void; onNovo: () => void; onDesfazerFolga: (id: string) => void }) {
  return (
    <div className={cn('rounded-2xl border bg-panel flex flex-col min-h-64', hoje ? 'border-accent' : 'border-line')}>
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5">
        <p className={cn('flex-1 text-[12.5px] font-medium', hoje ? 'text-accent-ink' : 'text-ink')}>
          <span className="capitalize">{diaSemana(date)}</span> <span className="text-muted">{dm(date)}</span>
        </p>
        <span className="text-[11px] text-faint">{grupo?.turnos.length ?? 0}</span>
        <button type="button" className="p-1 rounded text-muted hover:text-ink hover:bg-field" aria-label={`Turno extra em ${dm(date)}`} onClick={onNovo}><Plus size={13} /></button>
      </div>
      <Droppable droppableId={date}>
        {(p, s) => (
          <div ref={p.innerRef} {...p.droppableProps} className={cn('flex-1 px-2 pb-2 rounded-b-2xl', s.isDraggingOver && 'bg-accent-soft/50')}>
            {(grupo?.turnos ?? []).map((t, i) => <CartaoTurno key={`${t.userId}|${t.date}`} t={t} index={i} onAbrir={onAbrir} />)}
            {p.placeholder}
            {(grupo?.folgas ?? []).map((f) => (
              <div key={f.id} className="mb-1.5 flex items-center gap-1 rounded-lg border border-dashed border-line px-2 py-1 text-[12px] text-faint">
                <span className="flex-1 truncate line-through" title={f.reason ?? undefined}>{f.nome}</span>
                <span>folga</span>
                <button type="button" className="p-0.5 rounded hover:text-ink" aria-label={`Desfazer folga de ${f.nome}`} onClick={() => onDesfazerFolga(f.id)}><Undo2 size={12} /></button>
              </div>
            ))}
            {(grupo?.liberados ?? []).map((l, i) => (
              <p key={i} className="mb-1 truncate rounded-md px-2 py-0.5 text-[11px] text-muted" style={corDe(l.cor)}>🔓 {l.nome} · plantão liberado</p>
            ))}
          </div>
        )}
      </Droppable>
    </div>
  );
}

function CelulaMes({ date, hoje, foraDoMes, grupo, onAbrir, onNovo }: { date: string; hoje: boolean; foraDoMes: boolean; grupo?: Grupo; onAbrir: (t: Turno) => void; onNovo: () => void }) {
  return (
    <div className={cn('group border-b border-r border-line min-h-28 flex flex-col', foraDoMes && 'bg-field/40')}>
      <div className="flex items-center px-1.5 pt-1">
        <span className={cn('text-[12px] rounded-full w-6 h-6 grid place-items-center', hoje ? 'bg-accent text-white' : foraDoMes ? 'text-faint' : 'text-ink')}>{Number(date.slice(8, 10))}</span>
        {!!grupo?.folgas.length && <span className="ml-1 text-[10.5px] text-faint" title={grupo.folgas.map((f) => f.nome).join(', ')}>{grupo.folgas.length} folga{grupo.folgas.length > 1 ? 's' : ''}</span>}
        <button type="button" className="ml-auto p-0.5 rounded text-faint opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ink" aria-label={`Turno extra em ${dm(date)}`} onClick={onNovo}><Plus size={12} /></button>
      </div>
      <Droppable droppableId={date}>
        {(p, s) => (
          <div ref={p.innerRef} {...p.droppableProps} className={cn('flex-1 px-1 pb-1 max-h-36 overflow-y-auto', s.isDraggingOver && 'bg-accent-soft/50')}>
            {(grupo?.turnos ?? []).map((t, i) => <CartaoTurno key={`${t.userId}|${t.date}`} t={t} index={i} compacto onAbrir={onAbrir} />)}
            {p.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}

function TurnoModal({ turno, data, onClose, onMover }: { turno: Turno; data: ScheduleCalendar; onClose: () => void; onMover: () => void }) {
  const criar = useCreateShiftException();
  const remover = useRemoveShiftException();
  const [motivo, setMotivo] = useState('');
  const u = data.users.find((x) => x.id === turno.userId);
  const ok = (msg: string) => () => { toast.ok(msg); onClose(); };

  return (
    <Modal open onClose={onClose} title={`${turno.nome} · ${diaSemana(turno.date)} ${dm(turno.date)}`}>
      <div className="space-y-4">
        <div className="rounded-xl border border-line p-3 text-sm">
          <p className="text-ink">{turno.start}–{turno.end} <span className="text-muted">({Math.floor(turno.minutes / 60)}h{turno.minutes % 60 ? String(turno.minutes % 60).padStart(2, '0') : ''})</span></p>
          <p className="text-[12.5px] text-muted">
            {turno.source === 'extra' ? `Turno extra${turno.reason ? ` · ${turno.reason}` : ''}` : `Da escala ${u?.scheduleName ?? ''}`}
          </p>
        </div>
        {!turno.editavel ? (
          <p className="text-[13px] text-muted">Seu perfil só pode mexer nos turnos dos atendentes.</p>
        ) : (
          <>
            <Field label="Motivo (opcional)"><input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ex.: consulta médica, troca combinada" /></Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={onMover}>Passar para outro dia ou pessoa</Button>
              {turno.source === 'extra' ? (
                <Button variant="danger" loading={remover.isPending} onClick={() => remover.mutate(turno.exceptionId!, { onSuccess: ok('Turno extra removido.'), onError: (e) => toast.err(e) })}>Remover turno extra</Button>
              ) : (
                <Button loading={criar.isPending} onClick={() => criar.mutate({ userId: turno.userId, date: turno.date, kind: 'off', reason: motivo || undefined }, { onSuccess: ok('Folga lançada.'), onError: (e) => toast.err(e) })}>Dar folga neste dia</Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function MoverModal({ mover, data, pending, onClose, onConfirm }: { mover: Mover; data: ScheduleCalendar; pending: boolean; onClose: () => void; onConfirm: (toUserId: string, toDate: string, reason?: string) => void }) {
  const { turno } = mover;
  const [toUserId, setToUserId] = useState(turno.userId);
  const [toDate_, setToDate] = useState(mover.toDate);
  const [motivo, setMotivo] = useState('');
  const editaveis = data.users.filter((u) => u.editable);
  const mesmo = toUserId === turno.userId && toDate_ === turno.date;
  return (
    <Modal open onClose={onClose} title="Remanejar turno">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!mesmo) onConfirm(toUserId, toDate_, motivo || undefined); }}>
        <p className="text-sm text-muted">
          Turno de <b className="text-ink">{turno.nome}</b> em {diaSemana(turno.date)} {dm(turno.date)}, das {turno.start} às {turno.end}.
          No dia de origem fica uma folga; no destino, um turno extra com o mesmo horário.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quem faz o turno">
            <select className={inputCls} value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
              {editaveis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Em que dia"><input type="date" className={inputCls} value={toDate_} onChange={(e) => setToDate(e.target.value)} required /></Field>
        </div>
        <Field label="Motivo (opcional)"><input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ex.: troca combinada entre os dois" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={pending} disabled={mesmo}>Confirmar</Button>
        </div>
      </form>
    </Modal>
  );
}

function ExtraModal({ inicial, data, onClose }: { inicial: { date: string; userId?: string }; data: ScheduleCalendar; onClose: () => void }) {
  const criar = useCreateShiftException();
  const editaveis = data.users.filter((u) => u.editable);
  const [userId, setUserId] = useState(inicial.userId ?? editaveis[0]?.id ?? '');
  const escala = (id: string) => data.schedules.find((s) => s.id === data.users.find((u) => u.id === id)?.scheduleId);
  const [date, setDate] = useState(inicial.date);
  const [start, setStart] = useState(escala(userId)?.startTime ?? '08:00');
  const [end, setEnd] = useState(escala(userId)?.endTime ?? '17:00');
  const [motivo, setMotivo] = useState('');
  return (
    <Modal open onClose={onClose} title="Turno extra">
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        criar.mutate({ userId, date, kind: 'extra', startTime: start, endTime: end, reason: motivo || undefined }, { onSuccess: () => { toast.ok('Turno extra lançado.'); onClose(); }, onError: (err) => toast.err(err) });
      }}>
        <Field label="Quem">
          <select className={inputCls} value={userId} onChange={(e) => { setUserId(e.target.value); const s = escala(e.target.value); if (s) { setStart(s.startTime); setEnd(s.endTime); } }} required>
            {editaveis.map((u) => <option key={u.id} value={u.id}>{u.name}{u.scheduleName ? ` · ${u.scheduleName}` : ' · sem escala'}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Dia"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Início"><input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
          <Field label="Fim" hint="Antes do início = vira a meia-noite."><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
        </div>
        <Field label="Motivo (opcional)"><input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ex.: reforço de sábado" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={criar.isPending} disabled={!userId}>Lançar</Button>
        </div>
      </form>
    </Modal>
  );
}
