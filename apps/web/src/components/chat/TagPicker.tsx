'use client';
import { useEffect, useRef, useState } from 'react';
import { Star, Tag as TagIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tag } from '@/lib/hooks';

/**
 * Campo de tags: ao focar, exibe a lista para digitar ou clicar.
 * Usado tanto no filtro da lista quanto no cabeçalho do chat.
 *
 * Com `onPrimary`, a tag principal (etapa no Kanban) ganha estrela e anel, e clicar numa
 * selecionada que seja coluna do Kanban a promove a principal.
 */
export function TagPicker({ tags, value, onChange, placeholder, compact, primaryId, onPrimary }: { tags: Tag[]; value: string[]; onChange: (ids: string[]) => void; placeholder?: string; compact?: boolean; primaryId?: string | null; onPrimary?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selected = tags.filter((t) => value.includes(t.id));
  const options = tags.filter((t) => !value.includes(t.id) && t.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div ref={ref} className="relative">
      <div className={cn('flex flex-wrap items-center gap-1 rounded-lg bg-field px-2 min-h-8 cursor-text', compact && 'bg-transparent px-0 min-h-7')} onClick={() => setOpen(true)}>
        <TagIcon size={14} className="text-faint ml-1" />
        {selected.map((t) => (
          <span
            key={t.id}
            className={cn('inline-flex items-center gap-1 text-[11px] text-white rounded px-1.5 py-0.5', t.id === primaryId && 'font-semibold', onPrimary && t.isKanban !== false && t.id !== primaryId && 'cursor-pointer hover:opacity-80')}
            style={{ background: t.color, ...(t.id === primaryId ? { outline: `2px solid ${t.color}`, outlineOffset: 1 } : {}) }}
            title={!onPrimary ? undefined : t.id === primaryId ? 'Tag principal — etapa no Kanban' : t.isKanban !== false ? 'Clique para tornar principal' : 'Esta tag não é etapa do Kanban'}
            onClick={(e) => { if (!onPrimary || t.id === primaryId || t.isKanban === false) return; e.stopPropagation(); onPrimary(t.id); }}
          >
            {t.id === primaryId && <Star size={10} className="fill-current" />}
            {t.name}
            <X size={11} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); toggle(t.id); }} />
          </span>
        ))}
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && options[0]) { toggle(options[0].id); setQ(''); }
            if (e.key === 'Backspace' && !q && selected.length) toggle(selected[selected.length - 1].id);
          }}
          placeholder={selected.length ? '' : placeholder}
          className="flex-1 min-w-20 bg-transparent text-[12.5px] py-1 focus:outline-none"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg bg-panel border border-line shadow-lg py-1">
          {options.length === 0 && <p className="px-3 py-2 text-xs text-faint">Nenhuma tag</p>}
          {options.map((t) => (
            <button key={t.id} onClick={() => { toggle(t.id); setQ(''); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-field flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
