'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Permission } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/lib/hooks';

/**
 * Tudo que é horário mora em "Escalas e plantões" (docs/escalas.md#telas): plantões do dia,
 * turnos da equipe e o horário de atendimento da empresa. Cada aba exige a permissão da API
 * dela — aba que a pessoa não pode usar não aparece.
 */
export const ESCALAS_ABAS: { href: string; label: string; need: Permission }[] = [
  { href: '/escalas/aprovacoes', label: 'Plantões e liberações', need: 'team.manage' },
  { href: '/escalas/turnos', label: 'Escalas de trabalho', need: 'team.manage' },
  { href: '/escalas/horario-atendimento', label: 'Horário de atendimento', need: 'settings.manage' },
];

/** Primeira aba que a pessoa pode abrir (destino do item do menu); null = nenhuma. */
export const primeiraAbaEscalas = (perms: Permission[]) => ESCALAS_ABAS.find((a) => perms.includes(a.need))?.href ?? null;

export function EscalasTabs() {
  const path = usePathname();
  const perms = usePermissions();
  const abas = ESCALAS_ABAS.filter((a) => perms.includes(a.need));
  if (abas.length < 2) return null;
  return (
    <nav aria-label="Seções de escalas e horários" className="flex gap-1 rounded-xl border border-line bg-panel p-1">
      {abas.map((a) => (
        <Link key={a.href} href={a.href} aria-current={path.startsWith(a.href) ? 'page' : undefined}
          className={cn('flex-1 text-center rounded-lg px-3 py-2 text-[13px] font-medium transition-colors', path.startsWith(a.href) ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink hover:bg-field')}>
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
