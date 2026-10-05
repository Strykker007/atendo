'use client';
import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Etiqueta discreta do departamento (lista e cabeçalho do chat). */
export function DepartmentBadge({ department, className }: { department?: { name: string; color: string; isActive?: boolean } | null; className?: string }) {
  if (!department) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md truncate', className)}
      style={{ background: `color-mix(in srgb, ${department.color} 14%, transparent)`, color: department.color }}
      title={`Departamento: ${department.name}${department.isActive === false ? ' (desativado)' : ''}`}
    >
      <Building2 size={9} className="shrink-0" />
      <span className="truncate">{department.name}</span>
    </span>
  );
}
