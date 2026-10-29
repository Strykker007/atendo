'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** "AAAA-MM-DD" → "DD/MM/AAAA" */
const paraBR = (ymd: string) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '');
/** "DD/MM/AAAA" completo e válido → "AAAA-MM-DD"; senão null */
function deBR(t: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate() || y < 1900) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
/** máscara dd/mm/aaaa enquanto digita */
function mascara(t: string) {
  const d = t.replace(/\D/g, '').slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/**
 * Popover preso ao campo, no `body`: dentro do Modal o corpo tem rolagem e cortaria o calendário.
 * Abre embaixo, ou em cima quando não cabe; fecha no clique fora, Esc, rolagem e redimensionar.
 */
function Popover({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 320;
    const w = ref.current?.offsetWidth ?? 280;
    const top = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6;
    setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
  }, [anchor]);
  useEffect(() => {
    const fora = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    // Esc fecha só o calendário, não o Modal por trás (captura antes dele)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const rolou = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }} className="fixed z-[60] rounded-xl border border-line bg-panel shadow-xl p-3 text-sm">
      {children}
    </div>,
    document.body,
  );
}

const navBtn = 'w-7 h-7 rounded-lg grid place-items-center text-muted hover:bg-field hover:text-ink disabled:opacity-30 disabled:pointer-events-none';

type DateProps = {
  /** "AAAA-MM-DD" ou "" */
  value: string;
  onChange: (ymd: string) => void;
  min?: string;
  max?: string;
  /** permite apagar (vira "") */
  clearable?: boolean;
  className?: string;
  'aria-label'?: string;
};

/**
 * Data no formato brasileiro: digita "15112026" e vira 15/11/2026, ou escolhe no calendário (ícone).
 * Substitui o `type="date"` do navegador, que muda de cara a cada navegador e no Chrome em inglês
 * mostra mm/dd. Trabalha com "AAAA-MM-DD", igual ao input nativo.
 */
export function DateInput({ value, onChange, min, max, clearable, className, ...rest }: DateProps) {
  const [texto, setTexto] = useState(paraBR(value));
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => { if (deBR(texto) !== value) setTexto(paraBR(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const fora = (ymd: string) => (!!min && ymd < min) || (!!max && ymd > max);
  return (
    <div ref={caixa} className={cn('relative', className)}>
      <input
        {...rest}
        className={cn(inputCls, 'pr-9 tnum')}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        value={texto}
        onChange={(e) => {
          const t = mascara(e.target.value);
          setTexto(t);
          const ymd = deBR(t);
          if (ymd && !fora(ymd)) onChange(ymd);
          else if (!t && clearable) onChange('');
        }}
        // data incompleta ou fora do limite: volta para a última válida
        onBlur={() => setTexto(paraBR(value))}
        onKeyDown={(e) => e.key === 'ArrowDown' && setAberto(true)}
      />
      <button type="button" tabIndex={-1} title="Abrir calendário" aria-label="Abrir calendário" onClick={(e) => { e.preventDefault(); setAberto((v) => !v); }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md grid place-items-center text-faint hover:text-ink hover:bg-field">
        <CalendarDays size={15} />
      </button>
      {aberto && caixa.current && (
        <Popover anchor={caixa.current} onClose={() => setAberto(false)}>
          <Calendario value={value} fora={fora} onPick={(ymd) => { onChange(ymd); setAberto(false); }} />
          {clearable && value && (
            <button type="button" className="mt-2 w-full text-xs text-muted hover:text-danger" onClick={() => { onChange(''); setAberto(false); }}>Limpar data</button>
          )}
        </Popover>
      )}
    </div>
  );
}

function Calendario({ value, fora, onPick }: { value: string; fora: (ymd: string) => boolean; onPick: (ymd: string) => void }) {
  const hoje = hojeSP();
  const base = value || hoje;
  const [ano, setAno] = useState(Number(base.slice(0, 4)));
  const [mes, setMes] = useState(Number(base.slice(5, 7)) - 1);
  const andar = (n: number) => {
    const d = new Date(ano, mes + n, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth());
  };
  const primeiro = new Date(ano, mes, 1).getDay();
  const dias = new Date(ano, mes + 1, 0).getDate();
  const celulas = [...Array(primeiro).fill(null), ...Array.from({ length: dias }, (_, i) => i + 1)];
  return (
    <div className="w-64">
      <div className="flex items-center justify-between mb-2">
        <button type="button" className={navBtn} onClick={() => andar(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
        <b className="text-ink">{MESES[mes]} {ano}</b>
        <button type="button" className={navBtn} onClick={() => andar(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {SEMANA.map((s, i) => <span key={i} className="text-[10px] font-semibold text-faint py-1">{s}</span>)}
        {celulas.map((d, i) => {
          if (!d) return <span key={i} />;
          const ymd = `${ano}-${pad(mes + 1)}-${pad(d)}`;
          return (
            <button key={i} type="button" disabled={fora(ymd)} onClick={() => onPick(ymd)}
              className={cn('h-8 rounded-lg tnum text-[13px] disabled:opacity-25 disabled:pointer-events-none',
                ymd === value ? 'bg-accent text-white font-semibold' : ymd === hoje ? 'ring-1 ring-accent text-accent-ink font-semibold hover:bg-accent-soft' : 'text-ink hover:bg-field')}>
              {d}
            </button>
          );
        })}
      </div>
      {!fora(hoje) && hoje !== value && (
        <button type="button" className="mt-2 w-full text-xs font-semibold text-accent-ink hover:underline" onClick={() => onPick(hoje)}>Hoje</button>
      )}
    </div>
  );
}

/**
 * Mês ("AAAA-MM") com setas para o anterior/próximo e, no nome, uma grade dos 12 meses do ano.
 * Substitui o `type="month"`, que o Firefox e o Safari nem mostram como seletor.
 */
export function MonthPicker({ value, onChange, max, min, block }: { value: string; onChange: (p: string) => void; max?: string; min?: string; /** largura toda (dentro de formulário, alinhado aos outros campos) */ block?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [ano, setAno] = useState(Number(value.slice(0, 4)));
  const btn = useRef<HTMLButtonElement>(null);
  const mover = (n: number) => {
    const d = new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  const fora = (p: string) => (!!min && p < min) || (!!max && p > max);
  const nome = `${MESES[Number(value.slice(5, 7)) - 1]} de ${value.slice(0, 4)}`;
  return (
    // mesma altura do `inputCls` (38px), para alinhar com os campos ao lado
    <div className={cn('items-center rounded-lg border border-line bg-panel h-[38px] px-1', block ? 'flex w-full' : 'inline-flex')}>
      <button type="button" className={navBtn} disabled={fora(mover(-1))} onClick={() => onChange(mover(-1))} aria-label="Mês anterior" title="Mês anterior"><ChevronLeft size={16} /></button>
      <button ref={btn} type="button" onClick={() => { setAno(Number(value.slice(0, 4))); setAberto((v) => !v); }}
        className={cn('h-7 px-2 text-sm font-semibold text-ink hover:bg-field rounded-md inline-flex items-center justify-center gap-1.5', block ? 'flex-1 min-w-0' : 'min-w-[10.5rem]')}>
        <CalendarDays size={14} className="text-faint" /> {nome}
      </button>
      <button type="button" className={navBtn} disabled={fora(mover(1))} onClick={() => onChange(mover(1))} aria-label="Próximo mês" title="Próximo mês"><ChevronRight size={16} /></button>
      {aberto && btn.current && (
        <Popover anchor={btn.current} onClose={() => setAberto(false)}>
          <div className="w-60">
            <div className="flex items-center justify-between mb-2">
              <button type="button" className={navBtn} disabled={!!min && `${ano - 1}-12` < min} onClick={() => setAno(ano - 1)} aria-label="Ano anterior"><ChevronLeft size={16} /></button>
              <b className="text-ink tnum">{ano}</b>
              <button type="button" className={navBtn} disabled={!!max && `${ano + 1}-01` > max} onClick={() => setAno(ano + 1)} aria-label="Próximo ano"><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {MESES.map((m, i) => {
                const p = `${ano}-${pad(i + 1)}`;
                return (
                  <button key={m} type="button" disabled={fora(p)} onClick={() => { onChange(p); setAberto(false); }}
                    className={cn('h-9 rounded-lg text-[13px] disabled:opacity-25 disabled:pointer-events-none', p === value ? 'bg-accent text-white font-semibold' : 'text-ink hover:bg-field')}>
                    {m.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
