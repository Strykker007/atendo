'use client';
import { Suspense, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, History, Search, UserRound, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { inputCls } from '@/components/ui/Modal';
import { EscalasTabs } from '@/components/escalas/EscalasTabs';
import { WEEKDAYS, useAccessCalendar, useAccessDay, useAccessPeople, useCan, type AccessPerson, type AccessSession } from '@/lib/hooks';

const ROLE: Record<string, string> = { tenant_admin: 'Admin', manager: 'Gerente', agent: 'Atendente', super_admin: 'Dono' };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const FIM: Record<string, string> = { logout: 'Saiu', shift_end: 'Turno acabou', expired: 'Acesso temporário venceu', revoked: 'Senha trocada' };
const BARRADO: Record<string, string> = { out_of_schedule: 'fora da escala', account_expired: 'acesso temporário vencido' };

const pad = (n: number) => String(n).padStart(2, '0');
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const addMonths = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const weekday = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
/** Data AAAA-MM-DD do instante no fuso do cliente. */
const ymdIn = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const hora = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
/** Hora; com a data junto quando o instante cai em outro dia que o de referência (virada de meia-noite). */
const quando = (iso: string, tz: string, ref: string) => {
  const d = ymdIn(iso, tz);
  return d === ref ? hora(iso, tz) : `${d.slice(8)}/${d.slice(5, 7)} ${hora(iso, tz)}`;
};
const duracao = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${pad(min % 60)}`);
const diaExtenso = (ymd: string) => `${WEEKDAYS[weekday(ymd)].toLowerCase()}., ${Number(ymd.slice(8))} de ${MESES[Number(ymd.slice(5, 7)) - 1]} de ${ymd.slice(0, 4)}`;
const minutosEntre = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

export default function AcessosPage() {
  return <Suspense><AcessosInner /></Suspense>;
}

/**
 * Registro de acessos (docs/registro-de-acessos.md): auditoria de quem esteve logado. Duas
 * visões — **por dia** (todo mundo que entrou naquele dia) e **por pessoa** (calendário do mês
 * com o tempo online de cada dia e a lista de logins). Filtros ficam na URL para poder mandar o link.
 */
function AcessosInner() {
  const pode = useCan('team.manage');
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const pessoaId = params.get('pessoa');
  const dia = params.get('dia') ?? hojeLocal();
  const mes = params.get('mes') ?? (params.get('dia') ?? hojeLocal()).slice(0, 7);
  const modo: 'dia' | 'pessoa' = pessoaId || params.get('modo') === 'pessoa' ? 'pessoa' : 'dia';

  const ir = (mudar: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(mudar)) { if (v === null) p.delete(k); else p.set(k, v); }
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  };

  if (!pode) return <PageShell width="max-w-3xl"><Empty icon={<History size={28} />} title="Sem permissão" text="Seu perfil de acesso não inclui gerenciar a equipe." /></PageShell>;

  return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Registro de acessos" subtitle="Quem esteve logado em cada dia, a que horas entrou e saiu, e as tentativas barradas pela escala." />
      <EscalasTabs />

      <div className="flex gap-1 rounded-xl border border-line bg-panel p-1 w-full sm:w-fit">
        {([['dia', 'Por dia', <CalendarDays key="d" size={14} />], ['pessoa', 'Por pessoa', <UserRound key="p" size={14} />]] as const).map(([id, label, icon]) => (
          <button key={id} type="button" onClick={() => ir(id === 'dia' ? { modo: null, pessoa: null } : { modo: 'pessoa' })}
            className={cn('flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors', modo === id ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink hover:bg-field')}>
            {icon}{label}
          </button>
        ))}
      </div>

      {modo === 'dia'
        ? <PorDia dia={dia} onDia={(d) => ir({ dia: d })} onPessoa={(id, d) => ir({ pessoa: id, modo: 'pessoa', mes: d.slice(0, 7), dia: d })} />
        : <PorPessoa pessoaId={pessoaId} mes={mes} diaInicial={params.get('dia')} onPessoa={(id) => ir({ pessoa: id })} onMes={(m) => ir({ mes: m, dia: null })} />}
    </PageShell>
  );
}

function PorDia({ dia, onDia, onPessoa }: { dia: string; onDia: (d: string) => void; onPessoa: (id: string, dia: string) => void }) {
  const hoje = hojeLocal();
  const q = useAccessDay(dia, dia === hoje);
  const [aberto, setAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const pessoas = (q.data?.people ?? []).filter((p) => !busca.trim() || p.user.name.toLowerCase().includes(busca.trim().toLowerCase()));
  const online = (q.data?.people ?? []).filter((p) => p.online).length;

  return (
    <section className="rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
        <Button size="icon" variant="ghost" onClick={() => onDia(addDays(dia, -1))} title="Dia anterior" icon={<ChevronLeft size={16} />} />
        <input type="date" value={dia} max={hoje} onChange={(e) => e.target.value && onDia(e.target.value)} className={cn(inputCls, 'w-auto')} aria-label="Dia" />
        <Button size="icon" variant="ghost" onClick={() => onDia(addDays(dia, 1))} disabled={dia >= hoje} title="Próximo dia" icon={<ChevronRight size={16} />} />
        {dia !== hoje && <Button size="sm" variant="ghost" onClick={() => onDia(hoje)}>Hoje</Button>}
        <div className="relative w-full sm:w-56 sm:ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar por nome" className={cn(inputCls, 'pl-8')} />
        </div>
      </div>
      <p className="px-4 pt-3 text-[13px] text-muted">
        {diaExtenso(dia)}{q.data && <> — <b className="text-ink">{q.data.people.filter((p) => p.logins).length}</b> pessoa(s) entraram{dia === hoje && <>, <b className="text-ok">{online}</b> online agora</>}</>}
      </p>

      {q.isLoading ? <div className="p-4"><SkeletonRows rows={4} /></div> : !pessoas.length ? (
        <div className="p-8"><Empty icon={<Users size={28} />} title="Ninguém neste dia" text={busca ? 'Nenhuma pessoa com esse nome entrou neste dia.' : 'Nenhum login registrado neste dia.'} /></div>
      ) : (
        <ul className="divide-y divide-line">
          {pessoas.map((p) => (
            <li key={p.user.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button type="button" onClick={() => setAberto(aberto === p.user.id ? null : p.user.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  <span className="relative w-9 h-9 rounded-full bg-field text-ink grid place-items-center text-sm font-semibold shrink-0">
                    {p.user.name.slice(0, 1).toUpperCase()}
                    {p.online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-ok border-2 border-panel" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink truncate">{p.user.name}</span>
                      <span className="text-[11px] text-faint">{ROLE[p.user.role] ?? p.user.role}{p.user.isTemporary && ' · temporário'}</span>
                      {p.online && <span className="text-[11px] rounded-full bg-ok/15 text-ok px-2 py-0.5">online agora</span>}
                    </span>
                    <span className="block text-[12.5px] text-muted">
                      {p.firstAt && q.data ? <>Entrou {quando(p.firstAt, q.data.timezone, dia)}{p.lastAt && <> · {p.online ? 'ativo até agora' : `saiu ${quando(p.lastAt, q.data.timezone, dia)}`}</>} · <b className="text-ink">{duracao(p.onlineMinutes)}</b> online{p.logins > 1 && ` · ${p.logins} logins`}</> : 'Não chegou a entrar'}
                    </span>
                  </span>
                </button>
                {p.denied > 0 && <span className="inline-flex items-center gap-1 text-[11.5px] rounded-full bg-danger/10 text-danger px-2 py-0.5"><AlertTriangle size={12} /> {p.denied} tentativa(s) barrada(s)</span>}
                <Button size="sm" variant="ghost" icon={<CalendarDays size={13} />} onClick={() => onPessoa(p.user.id, dia)}>Calendário</Button>
              </div>
              {aberto === p.user.id && q.data && <Sessoes sessoes={p.sessions} tz={q.data.timezone} dia={dia} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PorPessoa({ pessoaId, mes, diaInicial, onPessoa, onMes }: { pessoaId: string | null; mes: string; diaInicial: string | null; onPessoa: (id: string) => void; onMes: (m: string) => void }) {
  const hoje = hojeLocal();
  const cal = useAccessCalendar(pessoaId, mes);
  const [escolhido, setEscolhido] = useState<string | null>(diaInicial);
  const diaSel = escolhido && escolhido.startsWith(mes) ? escolhido : null;

  const tz = cal.data?.timezone ?? 'America/Sao_Paulo';
  const doDia = useMemo(() => (cal.data && diaSel ? cal.data.sessions.filter((s) => ymdIn(s.startedAt, tz) <= diaSel && ymdIn(s.endAt, tz) >= diaSel) : []), [cal.data, diaSel, tz]);
  const totalMes = cal.data?.days.reduce((a, d) => a + d.onlineMinutes, 0) ?? 0;
  const diasComAcesso = cal.data?.days.filter((d) => d.onlineMinutes > 0 || d.logins > 0).length ?? 0;
  const maior = Math.max(1, ...(cal.data?.days.map((d) => d.onlineMinutes) ?? [1]));

  return (
    <section className="rounded-2xl border border-line bg-panel">
      <div className="p-3 border-b border-line"><BuscaPessoa selecionada={pessoaId} onEscolher={onPessoa} /></div>
      {!pessoaId ? (
        <div className="p-8"><Empty icon={<UserRound size={28} />} title="Escolha uma pessoa" text="Procure pelo nome para ver os dias e horários em que ela esteve logada." /></div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="icon" variant="ghost" onClick={() => onMes(addMonths(mes, -1))} title="Mês anterior" icon={<ChevronLeft size={16} />} />
            <p className="min-w-36 text-center font-medium text-ink capitalize">{MESES[Number(mes.slice(5)) - 1]} {mes.slice(0, 4)}</p>
            <Button size="icon" variant="ghost" onClick={() => onMes(addMonths(mes, 1))} disabled={mes >= hoje.slice(0, 7)} title="Próximo mês" icon={<ChevronRight size={16} />} />
            {cal.data && <p className="text-[12.5px] text-muted sm:ml-auto"><b className="text-ink">{diasComAcesso}</b> dia(s) com acesso · <b className="text-ink">{duracao(totalMes)}</b> online no mês</p>}
          </div>

          {cal.isLoading ? <SkeletonRows rows={5} /> : cal.data && (
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {WEEKDAYS.map((w) => <p key={w} className="text-center text-[11px] text-faint pb-1">{w}</p>)}
              {Array.from({ length: weekday(`${mes}-01`) }, (_, i) => <span key={`v${i}`} />)}
              {cal.data.days.map((d) => {
                const futuro = d.date > hoje;
                const nivel = d.onlineMinutes / maior;
                return (
                  <button key={d.date} type="button" disabled={futuro} onClick={() => setEscolhido(d.date === diaSel ? null : d.date)}
                    className={cn('relative h-14 sm:h-16 rounded-lg border text-left px-1.5 py-1 transition-colors disabled:opacity-40',
                      d.date === diaSel ? 'border-accent ring-2 ring-accent/40' : d.date === hoje ? 'border-accent/60' : 'border-line',
                      d.onlineMinutes ? (nivel > 0.6 ? 'bg-accent text-white' : nivel > 0.25 ? 'bg-accent/60 text-white' : 'bg-accent-soft text-accent-ink') : 'hover:bg-field text-ink')}>
                    <span className="block text-[12px] font-medium">{Number(d.date.slice(8))}</span>
                    {d.onlineMinutes > 0 && <span className="block text-[10.5px] sm:text-[11px] font-semibold tnum leading-tight">{duracao(d.onlineMinutes)}</span>}
                    {d.denied > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-danger" title={`${d.denied} tentativa(s) barrada(s)`} />}
                  </button>
                );
              })}
            </div>
          )}

          {cal.data && (diaSel ? (
            <div className="rounded-xl border border-line">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                <p className="text-[13px] font-medium text-ink">{diaExtenso(diaSel)}</p>
                <button type="button" onClick={() => setEscolhido(null)} className="ml-auto text-faint hover:text-ink p-1" title="Fechar"><X size={14} /></button>
              </div>
              {doDia.length ? <div className="px-3 pb-2"><Sessoes sessoes={doDia} tz={tz} dia={diaSel} /></div> : <p className="px-3 py-4 text-[13px] text-muted">Nenhum acesso neste dia.</p>}
            </div>
          ) : (
            <p className="text-[12.5px] text-faint">Clique num dia para ver os logins. Ponto vermelho = tentativa de entrar barrada (fora da escala ou acesso vencido).</p>
          ))}
        </div>
      )}
    </section>
  );
}

function BuscaPessoa({ selecionada, onEscolher }: { selecionada: string | null; onEscolher: (id: string) => void }) {
  const pessoas = useAccessPeople();
  const [texto, setTexto] = useState('');
  const [aberta, setAberta] = useState(false);
  const atual = pessoas.data?.find((p) => p.id === selecionada);
  const termo = texto.trim().toLowerCase();
  const lista = (pessoas.data ?? []).filter((p) => !termo || p.name.toLowerCase().includes(termo) || p.email?.toLowerCase().includes(termo)).slice(0, 8);
  const escolher = (p: AccessPerson) => { onEscolher(p.id); setTexto(''); setAberta(false); };

  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input value={aberta ? texto : atual?.name ?? texto} onFocus={() => setAberta(true)} onBlur={() => setTimeout(() => setAberta(false), 150)}
        onChange={(e) => { setTexto(e.target.value); setAberta(true); }} onKeyDown={(e) => { if (e.key === 'Enter' && lista[0]) escolher(lista[0]); }}
        placeholder="Procurar pessoa pelo nome ou e-mail" className={cn(inputCls, 'pl-8')} aria-label="Pessoa" />
      {aberta && (
        <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-line bg-panel shadow-xl py-1">
          {!lista.length ? <li className="px-3 py-2 text-[13px] text-muted">Ninguém com esse nome.</li> : lista.map((p) => (
            <li key={p.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(p)} className={cn('w-full text-left px-3 py-2 hover:bg-field flex items-center gap-2', p.id === selecionada && 'bg-accent-soft')}>
                <span className="text-sm text-ink truncate">{p.name}</span>
                <span className="text-[11px] text-faint shrink-0">{ROLE[p.role] ?? p.role}{p.isTemporary && ' · temporário'}{p.isActive === false && ' · inativo'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lista de logins: entrada → saída, duração, como terminou, aparelho e IP. Tentativa barrada em vermelho. */
function Sessoes({ sessoes, tz, dia }: { sessoes: AccessSession[]; tz: string; dia: string }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {sessoes.map((s) => (
        <li key={s.id} className={cn('rounded-lg px-3 py-2 text-[12.5px]', s.outcome === 'ok' ? 'bg-field' : 'bg-danger/10')}>
          {s.outcome === 'ok' ? (
            <p className="flex flex-wrap items-center gap-x-2 text-ink">
              <b className="tnum">{quando(s.startedAt, tz, dia)} → {s.online ? 'agora' : quando(s.endAt, tz, dia)}</b>
              <span className="text-muted">{duracao(minutosEntre(s.startedAt, s.endAt))}</span>
              <span className={cn('text-[11px] rounded-full px-2 py-0.5', s.online ? 'bg-ok/15 text-ok' : 'bg-panel text-muted')}>
                {s.online ? 'online agora' : s.endReason ? FIM[s.endReason] : 'Sem atividade (fechou o painel)'}
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-danger"><AlertTriangle size={13} /> Tentou entrar às <b className="tnum">{quando(s.startedAt, tz, dia)}</b> — barrado: {BARRADO[s.outcome] ?? s.outcome}</p>
          )}
          {(s.device || s.ip) && <p className="text-[11.5px] text-faint mt-0.5">{[s.device, s.ip].filter(Boolean).join(' · ')}</p>}
        </li>
      ))}
    </ul>
  );
}
