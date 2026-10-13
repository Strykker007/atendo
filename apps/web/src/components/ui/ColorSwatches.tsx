'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/** Cores prontas de tag (tela de Tags, modelo de perfil). */
export const PALETTE = ['#22c55e', '#f59e0b', '#6366f1', '#ec4899', '#0ea5e9', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b', '#f97316'];

/**
 * Paleta + cor livre (seletor do navegador). Nos modais a cor só vale ao salvar, então a livre
 * entra direto; marcada fica a escolhida, inclusive quando é uma fora da paleta.
 */
export function ColorSwatches({ value, onChange, size = 'w-7 h-7' }: { value?: string; onChange: (c: string) => void; size?: string }) {
  const livre = !!value && !PALETTE.includes(value.toLowerCase());
  const anel = (c: string) => ({ background: c, boxShadow: `0 0 0 2px var(--panel), 0 0 0 4px ${c}` });
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {PALETTE.map((c) => (
        <button type="button" key={c} aria-label={`Cor ${c}`} aria-pressed={value?.toLowerCase() === c} onClick={() => onChange(c)} className={cn(size, 'rounded-full transition')} style={value?.toLowerCase() === c ? anel(c) : { background: c }} />
      ))}
      <label title="Outra cor" className={cn(size, 'relative rounded-full cursor-pointer overflow-hidden border border-line grid place-items-center text-faint hover:text-ink')} style={livre ? anel(value!) : { background: 'conic-gradient(#ef4444,#f59e0b,#22c55e,#0ea5e9,#8b5cf6,#ec4899,#ef4444)' }}>
        {!livre && <Plus size={13} className="text-white drop-shadow" />}
        <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#6366f1'} onChange={(e) => onChange(e.target.value)} aria-label="Escolher outra cor" />
      </label>
    </div>
  );
}

/**
 * Popover de cor que salva na hora (bolinha da linha e "Cor" em massa): cor da paleta aplica no
 * clique; a livre só ao confirmar — o seletor do navegador dispara a cada arrastada.
 */
export function ColorPopover({ value, onPick, onClose, align = 'left' }: { value?: string; onPick: (c: string) => void; onClose: () => void; align?: 'left' | 'right' }) {
  const [livre, setLivre] = useState(value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#6366f1');
  return (
    <>
      {/* clique fora fecha */}
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className={cn('absolute top-full mt-1 z-30 w-52 rounded-lg border border-line bg-panel p-2.5 shadow-lg space-y-2', align === 'right' ? 'right-0' : 'left-0')}>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map((c) => <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => onPick(c)} className="w-6 h-6 rounded-full" style={{ background: c, boxShadow: value?.toLowerCase() === c ? `0 0 0 2px var(--panel), 0 0 0 3px ${c}` : undefined }} />)}
        </div>
        <div className="flex items-center gap-2 border-t border-line pt-2">
          <input type="color" value={livre} onChange={(e) => setLivre(e.target.value)} className="w-8 h-7 rounded cursor-pointer bg-transparent" aria-label="Outra cor" />
          <span className="text-[11px] text-muted font-mono flex-1">{livre}</span>
          <Button size="sm" onClick={() => onPick(livre)}>Aplicar</Button>
        </div>
      </div>
    </>
  );
}

