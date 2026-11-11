'use client';
import { useEffect, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { formatPhone } from '@/components/ui/PhoneInput';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';
import { useContactsList } from '@/lib/hooks';

/** contato escolhido: id para a API, rótulo para a etiqueta */
export interface PickedContact { id: string; label: string }

/**
 * Escolher contatos da base para a transmissão: busca por nome/telefone, marcar um a um ou
 * "marcar todos os listados". Grupo, descadastrado e sem WhatsApp não aparecem (o servidor também
 * tira na hora de montar o público).
 */
export function ContactPicker({ value, onChange }: { value: PickedContact[]; onChange: (v: PickedContact[]) => void }) {
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(busca.trim()), 300); return () => clearTimeout(t); }, [busca]);
  const list = useContactsList(q);

  const itens = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((c) => !c.isGroup && !c.optOutAt && !c.waInvalidAt);
  const marcados = new Set(value.map((c) => c.id));
  const rotulo = (c: (typeof itens)[number]) => c.name?.trim() || formatPhone(c.phone);
  const todosMarcados = itens.length > 0 && itens.every((c) => marcados.has(c.id));

  function alternar(c: (typeof itens)[number]) {
    onChange(marcados.has(c.id) ? value.filter((x) => x.id !== c.id) : [...value, { id: c.id, label: rotulo(c) }]);
  }
  function marcarTodos() {
    if (todosMarcados) {
      const fora = new Set(itens.map((c) => c.id));
      onChange(value.filter((x) => !fora.has(x.id)));
    } else {
      onChange([...value, ...itens.filter((c) => !marcados.has(c.id)).map((c) => ({ id: c.id, label: rotulo(c) }))]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className={cn(inputCls, 'pl-8')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone" aria-label="Buscar contatos" />
      </div>
      <div className="rounded-lg border border-line">
        <label className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px] text-muted cursor-pointer">
          <input type="checkbox" checked={todosMarcados} onChange={marcarTodos} disabled={!itens.length} />
          {todosMarcados ? 'Desmarcar' : 'Marcar'} todos os {itens.length} listados{list.hasNextPage ? ' (carregue mais para ver o resto)' : ''}
        </label>
        <div className="max-h-56 overflow-y-auto">
          {list.isLoading && <p className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] text-muted"><Loader2 size={12} className="animate-spin" /> Carregando…</p>}
          {!list.isLoading && !itens.length && <p className="px-3 py-2 text-[12.5px] text-faint">Nenhum contato encontrado.</p>}
          {itens.map((c) => (
            <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-field cursor-pointer">
              <input type="checkbox" checked={marcados.has(c.id)} onChange={() => alternar(c)} />
              <span className="truncate text-ink">{c.name?.trim() || 'Sem nome'}</span>
              <span className="ml-auto shrink-0 text-[12px] text-muted tnum">{formatPhone(c.phone)}</span>
            </label>
          ))}
          {list.hasNextPage && (
            <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="w-full px-3 py-1.5 text-[12.5px] text-accent-ink hover:underline">
              {list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
        </div>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-muted">{value.length} escolhido(s):</span>
          {value.slice(0, 30).map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] text-accent-ink">
              {c.label}
              <button type="button" onClick={() => onChange(value.filter((x) => x.id !== c.id))} aria-label={`Tirar ${c.label}`} className="opacity-70 hover:opacity-100"><X size={11} /></button>
            </span>
          ))}
          {value.length > 30 && <span className="text-[12px] text-muted">+{value.length - 30}</span>}
          <button type="button" onClick={() => onChange([])} className="text-[12px] text-muted hover:text-ink underline">Limpar</button>
        </div>
      )}
    </div>
  );
}
