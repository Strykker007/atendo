'use client';
import Link from 'next/link';
import { Inbox, Lock, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Department, NumberItem } from '@/lib/hooks';

/** Estado editável do acesso: o mesmo na tela de Acesso da pessoa e no acesso padrão do perfil. */
export interface AccessState {
  todos: boolean;
  ve: string[];
  padrao: string[];
  recebe: string[];
  deptos: string[];
}

const alternar = (xs: string[], id: string) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);

/**
 * Números (Vê / Abre filtrado / Recebe auto.) e departamentos. Usado na tela de Acesso
 * (docs/18-perfis-de-acesso.md#tela-de-acesso) e no acesso padrão do perfil
 * (docs/18-perfis-de-acesso.md#acesso-padrão-do-perfil) — mesma tabela, para não divergir.
 */
export function AccessGrid({ numbers, departments, value, onChange, admin = false, canReceive, viewAll, showDepartments = true }: {
  numbers: NumberItem[];
  departments: Department[];
  value: AccessState;
  onChange: (v: AccessState) => void;
  /** admin da conta: vê tudo, só escolhe onde abre filtrado */
  admin?: boolean;
  /** quem está editando pode definir "Recebe auto." (só o admin da conta) */
  canReceive: boolean;
  /** o perfil vê todas as conversas (gestor): muda o texto da hierarquia */
  viewAll: boolean;
  showDepartments?: boolean;
}) {
  const { todos, ve, padrao, recebe, deptos } = value;
  const set = (p: Partial<AccessState>) => onChange({ ...value, ...p });
  const vendo = (n: NumberItem) => (todos ? admin || !n.reserved : ve.includes(n.id));
  const temReservado = numbers.some((n) => n.reserved);

  return (
    <>
      <section className="space-y-2">
        {!admin && (
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={todos} onChange={() => set({ todos: true })} /> Todos os números{temReservado ? ' (menos os reservados)' : ''}</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={!todos} onChange={() => set({ todos: false, ve: ve.length ? ve : numbers.filter((n) => !n.reserved).map((n) => n.id) })} /> Só os marcados</label>
          </div>
        )}
        <div className="rounded-lg border border-line divide-y divide-line">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span>Número</span><span className="w-12 text-center">Vê</span><span className="w-20 text-center">Abre filtrado</span><span className="w-20 text-center" title="Fila, Distribuidor e redistribuição entregam para ela">Recebe auto.</span>
          </div>
          {numbers.map((n) => {
            const v = vendo(n);
            return (
              <div key={n.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: n.color }} />{n.label} <span className="text-muted">· {n.phone.slice(-4)}</span>
                  {n.reserved && <Lock size={11} className="inline ml-1 text-faint" aria-label="Reservado" />}
                </span>
                <span className="w-12 text-center"><input type="checkbox" checked={v} disabled={admin || todos} onChange={() => set({ ve: alternar(ve, n.id) })} aria-label={`Vê ${n.label}`} /></span>
                <span className="w-20 text-center">
                  <button type="button" disabled={!v} onClick={() => set({ padrao: alternar(padrao, n.id) })} aria-label={`Abre filtrado em ${n.label}`} className={cn('disabled:opacity-25', padrao.includes(n.id) && v ? 'text-accent' : 'text-faint hover:text-ink')}>
                    <Star size={15} className={cn(padrao.includes(n.id) && v && 'fill-current')} />
                  </button>
                </span>
                <span className="w-20 text-center">
                  <input type="checkbox" checked={v && recebe.includes(n.id)} disabled={!v || !canReceive || admin} onChange={() => set({ recebe: alternar(recebe, n.id) })} aria-label={`Recebe automaticamente de ${n.label}`}
                    title={!canReceive ? 'Só o administrador da conta define quem recebe' : undefined} />
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[12px] text-muted">
          <b>Vê</b>: conversas que aparecem para ela. <Star size={10} className="inline fill-current text-accent" /> <b>Abre filtrado</b>: a tela de conversas já entra nesses números. <Inbox size={10} className="inline" /> <b>Recebe auto.</b>: a fila e a redistribuição podem entregar conversas deste número para ela — sem marcar, ela ainda vê e assume na mão (ex.: gerente). <Lock size={10} className="inline" /> = número reservado.
        </p>
      </section>

      {showDepartments && !admin && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Departamentos</h3>
          {departments.length === 0 ? (
            <p className="text-[12.5px] text-muted">Nenhum departamento cadastrado. Crie em <Link href="/configuracoes" className="underline">Configurações → Departamentos</Link>.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {departments.map((d) => (
                <label key={d.id} className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] cursor-pointer', deptos.includes(d.id) ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink', !d.isActive && 'opacity-50')}>
                  <input type="checkbox" className="sr-only" checked={deptos.includes(d.id)} onChange={() => set({ deptos: alternar(deptos, d.id) })} />
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.color }} />{d.name}
                </label>
              ))}
            </div>
          )}
          <p className="text-[12px] text-muted">
            No setor: recebe sozinha as conversas dele e{viewAll ? ' (como gestor) enxerga também os setores abaixo dele, nunca os de cima' : ' só enxerga as conversas do setor e as sem setor'}. Os números de outros setores somem da lista dela. Sem departamento: vê todos os setores.
          </p>
        </section>
      )}
    </>
  );
}
