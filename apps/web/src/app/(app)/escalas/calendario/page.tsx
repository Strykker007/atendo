'use client';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Undo2, Unlock } from 'lucide-react';
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
const fimDeSemana = (ymd: string) => [0, 6].includes(toDate(ymd).getUTCDay());
const hojeLocal = () => new Date().toLocaleDateString('sv-SE');
const diaMes = (ymd: string) => `${Number(ymd.slice(8, 10))} de ${MESES[Number(ymd.slice(5, 7)) - 1]}`;
/** "10 a 16 de novembro" / "27 de outubro a 2 de novembro" */
const tituloSemana = (f: string, t: string) => f.slice(5, 7) === t.slice(5, 7) ? `${Number(f.slice(8, 10))} a ${diaMes(t)}` : `${diaMes(f)} a ${diaMes(t)}`;
/** 480 → "8h", 510 → "8h30" */
const duracao = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

/**
 * Cor fixa por pessoa (na ordem da equipe), usada com parcimônia: só a bolinha e a faixa fina à
 * esquerda do cartão — o cartão em si é neutro. Matizes escolhidos para ficarem distintos.
 */
const MATIZES = [217, 158, 330, 28, 262, 188, 352, 95, 45, 290, 135, 8];
const corDe = (i: number) => `hsl(${MATIZES[i % MATIZES.length]} 55% ${i >= MATIZES.length ? 38 : 50}%)`;

/** Tela estreita (celular): o mês vira bolinhas e cada dia abre a semana. */
const QUERY_ESTREITA = '(max-width: 639px)';
function useEstreita() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(QUERY_ESTREITA); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(QUERY_ESTREITA).matches,
    () => false,
  );
}

type Turno = CalendarShift & { nome: string; cor: number; editavel: boolean };
type Mover = { turno: Turno; toDate: string };

/**
 * Calendário da escala (docs/escalas.md#calendário): os turnos de cada dia, calculados da escala
 * de cada pessoa, com folgas e turnos extras. Semana em quadro (arrastar para outro dia remaneja
 * ou passa para outra pessoa) e mês em grade.
 */
export default function CalendarioEscalaPage() {
  const pode = useCan('team.manage');
  const estreita = useEstreita();
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
  // horas de cada pessoa no período mostrado (no mês, só os dias do mês — a grade tem sobras)
  const horas = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data?.shifts ?? []) {
      if (visao === 'mes' && s.date.slice(0, 7) !== ref.slice(0, 7)) continue;
      m.set(s.userId, (m.get(s.userId) ?? 0) + s.minutes);
    }
    return m;
  }, [data, visao, ref]);
  const titulo = visao === 'semana' ? tituloSemana(from, to) : `${MESES[toDate(ref).getUTCMonth()]} de ${toDate(ref).getUTCFullYear()}`;
  const passo = (n: number) => setRef(visao === 'semana' ? addDays(ref, 7 * n) : ymdOf(new Date(Date.UTC(toDate(ref).getUTCFullYear(), toDate(ref).getUTCMonth() + n, 1, 12))));
  const abrirSemana = (d: string) => { setRef(d); setVisao('semana'); };

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
  const navBtn = 'h-8 grid place-items-center text-muted hover:text-ink hover:bg-field transition-colors';

  return (
    <PageShell width="max-w-7xl">
      <PageHeader
        title="Calendário da escala"
        subtitle="Os turnos de cada dia. Arraste um turno para outro dia para remanejar ou passar para outra pessoa; clique para dar folga."
        action={<Button onClick={() => setNovo({ date: data?.today ?? hojeLocal(), userId: pessoa || undefined })}><Plus size={14} /> Turno extra</Button>}
      />
      <EscalasTabs />

      {/* barra: navegação + período à esquerda, Semana/Mês à direita */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center overflow-hidden rounded-xl border border-line bg-panel">
          <button type="button" className={cn(navBtn, 'w-8')} aria-label="Anterior" onClick={() => passo(-1)}><ChevronLeft size={16} /></button>
          <button type="button" className={cn(navBtn, 'px-3 border-x border-line text-[13px] font-medium')} onClick={() => setRef(data?.today ?? hojeLocal())}>Hoje</button>
          <button type="button" className={cn(navBtn, 'w-8')} aria-label="Próximo" onClick={() => passo(1)}><ChevronRight size={16} /></button>
        </div>
        <h2 className="font-display text-lg font-semibold text-ink first-letter:uppercase">{titulo}</h2>
        <div className="ml-auto flex rounded-xl border border-line bg-panel p-0.5">
          {(['semana', 'mes'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVisao(v)} aria-pressed={visao === v}
              className={cn('rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors', visao === v ? 'bg-field text-ink' : 'text-muted hover:text-ink')}>
              {v === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>
      </div>

      {/* legenda da equipe: bolinha da cor, escala e horas no período; clicar filtra */}
      {!!pessoas.length && (
        <section className="rounded-2xl border border-line bg-panel p-3" aria-label="Equipe">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Equipe</p>
            <p className="text-[11px] text-faint">{pessoa ? 'mostrando uma pessoa' : 'clique em alguém para ver só os turnos dela'}</p>
            {pessoa && <button type="button" className="ml-auto text-[12px] font-medium text-accent-ink hover:underline" onClick={() => setPessoa('')}>Mostrar todos</button>}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {pessoas.map((p, i) => {
              const ativo = pessoa === p.id;
              const h = horas.get(p.id) ?? 0;
              return (
                <li key={p.id}>
                  <button type="button" aria-pressed={ativo} onClick={() => setPessoa(ativo ? '' : p.id)}
                    className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1 text-left transition',
                      ativo ? 'border-line-strong bg-field' : 'border-line hover:bg-field',
                      pessoa && !ativo && 'opacity-50 hover:opacity-100')}>
                    <Ponto i={i} />
                    <span className="text-[12.5px] font-medium text-ink">{p.name}</span>
                    <span className="text-[11px] text-muted">
                      {p.scheduleName ?? <span className="text-faint">sem escala</span>}
                      {h > 0 && <> · <span className="tabular-nums">{duracao(h)}</span></>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!!semEscala.length && (
            <p className="mt-2 border-t border-line pt-2 text-[11.5px] text-faint">
              Sem escala, ninguém é travado por horário: o turno extra de {semEscala.map((p) => p.name).join(', ')} aparece aqui só para organizar.
            </p>
          )}
        </section>
      )}

      {cal.isLoading ? <SkeletonRows /> : !pessoas.length ? (
        <Empty icon={<CalendarClock size={28} />} title="Ninguém na equipe" text="Atendentes e gerentes ativos aparecem aqui. Administradores não têm escala." />
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          {visao === 'semana' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
              {dias.map((d) => (
                <Coluna key={d} date={d} hoje={d === data?.today} passado={!!data && d < data.today} grupo={porDia.get(d)} onAbrir={setAberto} onNovo={() => setNovo({ date: d, userId: pessoa || undefined })}
                  onDesfazerFolga={(id) => removeExc.mutate(id, { onSuccess: () => toast.ok('Folga desfeita.'), onError: (e) => toast.err(e) })} />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              <div className="grid grid-cols-7 border-b border-line bg-field/60">
                {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d, i) => (
                  <p key={d} className={cn('px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide sm:text-left', i >= 5 ? 'text-faint' : 'text-muted')}>{d}</p>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {dias.map((d) => (
                  <CelulaMes key={d} date={d} hoje={d === data?.today} foraDoMes={d.slice(0, 7) !== ref.slice(0, 7)} grupo={porDia.get(d)} estreita={estreita}
                    onAbrir={setAberto} onSemana={() => abrirSemana(d)} onNovo={() => setNovo({ date: d, userId: pessoa || undefined })} />
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

/** Bolinha com a cor da pessoa — o único ponto de cor por pessoa na tela. */
function Ponto({ i, apagado }: { i: number; apagado?: boolean }) {
  return <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', apagado && 'opacity-40')} style={{ background: corDe(i) }} />;
}

function CartaoTurno({ t, index, compacto, onAbrir }: { t: Turno; index: number; compacto?: boolean; onAbrir: (t: Turno) => void }) {
  return (
    <Draggable draggableId={`${t.userId}|${t.date}`} index={index} isDragDisabled={!t.editavel}>
      {(p, s) => (
        <button
          type="button"
          ref={p.innerRef}
          {...p.draggableProps}
          {...p.dragHandleProps}
          onClick={() => onAbrir(t)}
          style={{ borderLeftColor: corDe(t.cor), ...p.draggableProps.style }}
          className={cn('w-full rounded-md border border-l-[3px] border-line bg-panel text-left transition-colors hover:bg-field',
            compacto ? 'mb-1 px-1.5 py-0.5 text-[11px]' : 'mb-1.5 px-2 py-1.5',
            s.isDragging && 'shadow-lg')}
          title={`${t.nome} · ${t.start}–${t.end}${t.source === 'extra' ? ' · turno extra' : ''}`}
        >
          {compacto ? (
            <span className="block truncate text-ink"><span className="tabular-nums text-muted">{t.start}</span> {t.nome.split(' ')[0]}{t.source === 'extra' && <span className="text-warn-ink"> +</span>}</span>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{t.nome}</span>
                {t.source === 'extra' && <span className="shrink-0 rounded bg-warn-soft px-1 text-[10px] font-medium text-warn-ink">extra</span>}
              </span>
              <span className="block text-[11px] tabular-nums text-muted">{t.start}–{t.end} · {duracao(t.minutes)}</span>
            </>
          )}
        </button>
      )}
    </Draggable>
  );
}

function Coluna({ date, hoje, passado, grupo, onAbrir, onNovo, onDesfazerFolga }: { date: string; hoje: boolean; passado: boolean; grupo?: Grupo; onAbrir: (t: Turno) => void; onNovo: () => void; onDesfazerFolga: (id: string) => void }) {
  const turnos = grupo?.turnos ?? [];
  const folgas = grupo?.folgas ?? [];
  const liberados = grupo?.liberados ?? [];
  return (
    <div className={cn('flex min-h-40 flex-col rounded-2xl border lg:min-h-80',
      hoje ? 'border-accent' : 'border-line',
      fimDeSemana(date) ? 'bg-field/40' : 'bg-panel', passado && !hoje && 'opacity-70')}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <span className={cn('grid h-8 w-8 place-items-center rounded-full font-display text-[14px] font-semibold', hoje ? 'bg-accent text-white' : 'text-ink')}>{Number(date.slice(8, 10))}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className={cn('block text-[11px] font-semibold uppercase tracking-wide', hoje ? 'text-accent-ink' : 'text-muted')}>{diaSemana(date)}{hoje && ' · hoje'}</span>
          <span className="block text-[11px] text-faint">{turnos.length ? `${turnos.length} no turno` : 'ninguém escalado'}</span>
        </span>
        <button type="button" className="rounded-md p-1 text-faint hover:bg-field hover:text-ink" aria-label={`Turno extra em ${dm(date)}`} title="Turno extra neste dia" onClick={onNovo}><Plus size={14} /></button>
      </div>
      <Droppable droppableId={date}>
        {(p, s) => (
          <div ref={p.innerRef} {...p.droppableProps} className={cn('flex-1 rounded-b-2xl p-2 transition-colors', s.isDraggingOver && 'bg-accent-soft/60')}>
            {turnos.map((t, i) => <CartaoTurno key={`${t.userId}|${t.date}`} t={t} index={i} onAbrir={onAbrir} />)}
            {p.placeholder}
            {!turnos.length && !s.isDraggingOver && <p className="py-3 text-center text-[11.5px] text-faint">Sem turnos</p>}
            {!!folgas.length && (
              <>
                <p className="mb-1 mt-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Folga</p>
                {folgas.map((f) => (
                  <div key={f.id} className="mb-1 flex items-center gap-1.5 rounded-md border border-dashed border-line px-1.5 py-1 text-[12px] text-muted" title={f.reason ?? undefined}>
                    <Ponto i={f.cor} apagado />
                    <span className="min-w-0 flex-1 truncate">{f.nome}</span>
                    <button type="button" className="rounded p-0.5 text-faint hover:bg-field hover:text-ink" aria-label={`Desfazer folga de ${f.nome}`} title="Desfazer folga" onClick={() => onDesfazerFolga(f.id)}><Undo2 size={12} /></button>
                  </div>
                ))}
              </>
            )}
            {liberados.map((l, i) => (
              <p key={i} className="mb-1 flex items-center gap-1.5 truncate rounded-md bg-field px-1.5 py-0.5 text-[11px] text-muted">
                <Unlock size={11} className="shrink-0" /> {l.nome} · plantão liberado
              </p>
            ))}
          </div>
        )}
      </Droppable>
    </div>
  );
}

/** No mês cabem 3 turnos por dia; o resto vira "+N", que abre a semana daquele dia. */
const MAX_NO_MES = 3;

function CelulaMes({ date, hoje, foraDoMes, grupo, estreita, onAbrir, onSemana, onNovo }: { date: string; hoje: boolean; foraDoMes: boolean; grupo?: Grupo; estreita: boolean; onAbrir: (t: Turno) => void; onSemana: () => void; onNovo: () => void }) {
  const turnos = grupo?.turnos ?? [];
  const folgas = grupo?.folgas.length ?? 0;
  const fundo = cn('group flex min-h-16 flex-col border-b border-r border-line sm:min-h-32 [&:nth-child(7n)]:border-r-0',
    foraDoMes ? 'bg-field/50' : fimDeSemana(date) ? 'bg-field/25' : '');
  const numero = (
    <span className={cn('grid h-6 w-6 place-items-center rounded-full text-[12px] font-medium', hoje ? 'bg-accent text-white' : foraDoMes ? 'text-faint' : 'text-ink')}>{Number(date.slice(8, 10))}</span>
  );

  // celular: sem espaço para nome — bolinhas; tocar abre a semana
  if (estreita) {
    return (
      <button type="button" className={cn(fundo, 'items-center gap-1 pt-1')} onClick={onSemana} aria-label={`${dm(date)}: ${turnos.length} no turno`}>
        {numero}
        <span className="flex flex-wrap justify-center gap-0.5 px-0.5">
          {turnos.slice(0, 6).map((t) => <span key={t.userId} className="h-1.5 w-1.5 rounded-full" style={{ background: corDe(t.cor) }} />)}
        </span>
        {turnos.length > 6 && <span className="text-[9px] text-faint">+{turnos.length - 6}</span>}
      </button>
    );
  }

  const visiveis = turnos.slice(0, MAX_NO_MES);
  const resto = turnos.length - visiveis.length;
  return (
    <div className={fundo}>
      <div className="flex items-center gap-1 px-1.5 pt-1.5">
        {numero}
        {!!folgas && <span className="rounded-full bg-field px-1.5 text-[10px] text-muted" title={grupo!.folgas.map((f) => f.nome).join(', ')}>{folgas} folga{folgas > 1 ? 's' : ''}</span>}
        <button type="button" className="ml-auto rounded p-0.5 text-faint opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100" aria-label={`Turno extra em ${dm(date)}`} onClick={onNovo}><Plus size={12} /></button>
      </div>
      <Droppable droppableId={date}>
        {(p, s) => (
          <div ref={p.innerRef} {...p.droppableProps} className={cn('flex-1 px-1 pb-1 pt-1 transition-colors', s.isDraggingOver && 'bg-accent-soft/60')}>
            {visiveis.map((t, i) => <CartaoTurno key={`${t.userId}|${t.date}`} t={t} index={i} compacto onAbrir={onAbrir} />)}
            {p.placeholder}
            {resto > 0 && (
              <button type="button" className="w-full rounded px-1.5 text-left text-[11px] font-medium text-muted hover:bg-field hover:text-ink" onClick={onSemana}>+{resto} {resto > 1 ? 'outros' : 'outro'}</button>
            )}
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
