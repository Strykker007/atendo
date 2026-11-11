'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock, QrCode, ShieldCheck, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { toast } from '@/components/ui/Toast';
import { useDepartments, useMe, useNumbers, useSaveMyDefaultNumbers, type NumberItem } from '@/lib/hooks';

const mesmos = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Aplica o filtro de números padrão da pessoa (docs/18-perfis-de-acesso.md#número-padrão) quando o
 * filtro guardado no navegador não é dela: login novo ou outra pessoa usando o mesmo computador
 * (portaria). Sem padrão, quem entra começa em "Todos os números". Quem veio da versão anterior
 * (`numbersFor` null) e não tem padrão mantém o filtro que tinha.
 */
export function useDefaultNumbers() {
  const me = useMe();
  const numbers = useNumbers();
  const { numberIds, numbersFor, setNumbers } = useUI();
  useEffect(() => {
    const eu = me.data;
    if (!eu || !numbers.data) return;
    const visiveis = new Set(numbers.data.map((n) => n.id));
    if (numbersFor !== eu.id) {
      const padrao = (eu.defaultNumberIds ?? []).filter((id) => visiveis.has(id));
      setNumbers(padrao.length || numbersFor !== null ? padrao : numberIds.filter((id) => visiveis.has(id)), eu.id);
      return;
    }
    // número que saiu do alcance (reservado, desmarcado, excluído): sai do filtro em vez de esvaziar a lista
    const validos = numberIds.filter((id) => visiveis.has(id));
    if (validos.length !== numberIds.length) setNumbers(validos);
  }, [me.data, numbers.data, numbersFor, numberIds, setNumbers]);
}

/**
 * Seletor de números da lista de conversas: um, vários ou todos. "Salvar como meu padrão" grava a
 * escolha para a tela já abrir assim no próximo login.
 */
export function NumberFilter({ options }: { options: NumberItem[] }) {
  const { numberIds, setNumbers } = useUI();
  const me = useMe();
  const salvar = useSaveMyDefaultNumbers();
  const departamentos = useDepartments();
  const nomeDepto = (id?: string | null) => (id ? departamentos.data?.find((d) => d.id === id)?.name : undefined);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const marcados = options.filter((n) => numberIds.includes(n.id));
  const um = marcados.length === 1 ? marcados[0] : null;
  const padrao = me.data?.defaultNumberIds ?? [];
  const ehPadrao = mesmos(numberIds, padrao);
  const rotulo = !marcados.length ? 'Todos os números' : um ? `${um.label} · ${um.phone.slice(-4)}` : `${marcados.length} números`;
  const alternar = (id: string) => setNumbers(numberIds.includes(id) ? numberIds.filter((x) => x !== id) : [...numberIds, id]);
  const conectado = marcados.length > 0 && marcados.every((n) => n.status === 'connected');

  return (
    <div ref={caixa} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        title={marcados.length > 1 ? marcados.map((n) => n.label).join(', ') : undefined}
        className="w-full flex items-center gap-2 rounded-lg bg-field text-ink pl-3 pr-2 py-1.5 text-[12.5px] font-display font-semibold text-left focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        <span className={cn('shrink-0 w-2.5 h-2.5 rounded-full ring-[3px]', marcados.length ? (conectado ? 'bg-ok ring-ok/25' : 'bg-warn ring-warn/25') : 'bg-faint ring-line')} />
        <span className="min-w-0 flex-1 truncate">{rotulo}</span>
        {um && (
          <span className={cn('shrink-0 inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5', um.provider === 'meta' ? 'bg-meta-soft text-meta-ink' : 'bg-evo-soft text-evo-ink')}>
            {um.provider === 'meta' ? <ShieldCheck size={10} /> : <QrCode size={10} />}
            {um.provider === 'meta' ? 'Meta' : 'QR'}
          </span>
        )}
        {ehPadrao && padrao.length > 0 && <Star size={12} className="shrink-0 text-accent fill-current" aria-label="Seu padrão" />}
        <ChevronDown size={15} className="shrink-0 text-faint" />
      </button>

      {aberto && (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-line bg-panel shadow-xl py-1 min-w-[220px]">
          <button type="button" onClick={() => setNumbers([])} className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-left hover:bg-field', !numberIds.length && 'font-semibold text-accent-ink')}>
            <input type="checkbox" readOnly checked={!numberIds.length} tabIndex={-1} className="pointer-events-none" />
            Todos os números
          </button>
          <div className="max-h-64 overflow-y-auto">
            {options.map((n) => (
              <label key={n.id} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-ink hover:bg-field cursor-pointer">
                <input type="checkbox" checked={numberIds.includes(n.id)} onChange={() => alternar(n.id)} />
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: n.color }} />
                <span className="min-w-0 flex-1 truncate">{n.label} <span className="text-muted">· {n.phone.slice(-4)}</span></span>
                {nomeDepto(n.defaultDepartmentId) && <span className="shrink-0 text-[10.5px] text-muted">{nomeDepto(n.defaultDepartmentId)}</span>}
                {n.reserved && <Lock size={11} className="shrink-0 text-faint" aria-label="Reservado" />}
                {padrao.includes(n.id) && <Star size={11} className="shrink-0 text-accent fill-current" aria-label="No seu padrão" />}
              </label>
            ))}
          </div>
          <div className="border-t border-line mt-1 px-3 pt-1.5 pb-1 flex items-center justify-between gap-2 text-[11.5px]">
            {ehPadrao ? (
              <span className="text-muted inline-flex items-center gap-1"><Star size={11} className="text-accent fill-current" /> {padrao.length ? 'Este é o seu padrão ao entrar' : 'Você entra vendo todos os números'}</span>
            ) : (
              <button
                type="button"
                disabled={salvar.isPending}
                onClick={() => salvar.mutateAsync(numberIds).then(() => toast.ok(numberIds.length ? 'Pronto: suas conversas vão abrir nestes números' : 'Pronto: suas conversas vão abrir em todos os números')).catch(toast.err)}
                className="font-semibold text-accent-ink hover:underline disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Star size={11} /> Salvar como meu padrão
              </button>
            )}
            <button type="button" onClick={() => setAberto(false)} className="text-muted hover:text-ink">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}
