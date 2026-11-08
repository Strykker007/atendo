'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Permission, PlanFeature } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { usePermissions, useUsage } from '@/lib/hooks';

/**
 * Telas parecidas que dividem um item só no menu lateral (docs/08-frontend.md#menu-lateral).
 * Cada aba repete a regra do item de menu: `need` = basta UMA permissão; `feature` = recurso do
 * plano. Aba que a pessoa não pode usar não aparece; com uma só, a barra some.
 */
export interface SectionTab { href: string; label: string; need?: Permission[]; feature?: PlanFeature }

export const SECTION_TABS = {
  fluxos: [
    { href: '/fluxos', label: 'Fluxos', need: ['flows.manage'], feature: 'flows' },
    // agente com etapas: entra no atendimento pelo bloco IA dos fluxos (docs/agente-ia.md)
    { href: '/agentes-ia', label: 'Agentes de IA', need: ['flows.manage'], feature: 'ai_flows' },
  ],
  relatorios: [
    { href: '/relatorios', label: 'Relatórios', need: ['reports.view'] },
    { href: '/pesquisas', label: 'Pesquisas de satisfação', need: ['settings.manage'], feature: 'satisfaction_surveys' },
  ],
  configuracoes: [
    { href: '/configuracoes', label: 'Configurações' },
    { href: '/plano', label: 'Plano e uso', need: ['billing.manage'] },
  ],
} satisfies Record<string, SectionTab[]>;
export type SectionKey = keyof typeof SECTION_TABS;

/** Filtro de permissão + plano; enquanto o plano carrega, a aba aparece (sumir e voltar pisca). */
export function useTabFilter() {
  const perms = usePermissions();
  const usage = useUsage();
  return (t: SectionTab) =>
    (!t.need || t.need.some((p) => perms.includes(p))) && (!t.feature || !usage.data || !!usage.data.limits?.features?.includes(t.feature));
}

export function SectionTabs({ section, label }: { section: SectionKey; label?: string }) {
  const path = usePathname();
  const pode = useTabFilter();
  const abas = (SECTION_TABS[section] as SectionTab[]).filter(pode);
  if (abas.length < 2) return null;
  return (
    <nav aria-label={label ?? 'Seções'} className="flex gap-1 rounded-xl border border-line bg-panel p-1 overflow-x-auto">
      {abas.map((a) => {
        const ativa = path === a.href || path.startsWith(`${a.href}/`);
        return (
          <Link key={a.href} href={a.href} aria-current={ativa ? 'page' : undefined}
            className={cn('flex-1 shrink-0 whitespace-nowrap text-center rounded-lg px-3 py-2 text-[13px] font-medium transition-colors', ativa ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink hover:bg-field')}>
            {a.label}
          </Link>
        );
      })}
    </nav>
  );
}
