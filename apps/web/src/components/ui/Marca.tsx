'use client';
/* eslint-disable @next/next/no-img-element */
import { cn } from '@/lib/utils';
import { useBrand } from '@/lib/brand-context';

/** Marca sem arte cadastrada: o nome em texto, na fonte de títulos. */
function NomeMarca({ className }: { className?: string }) {
  const { brandName } = useBrand();
  return <span className={cn('font-display font-bold tracking-tight truncate', className)}>{brandName}</span>;
}

/**
 * Logo horizontal (login, convite, recuperação de senha). Duas versões porque o texto escuro
 * sumiria no cartão do tema escuro — ver docs/08-frontend.md › Marca.
 */
export function MarcaHorizontal({ className }: { className?: string }) {
  const { brandName, logo } = useBrand();
  if (!logo.horizontal) return <NomeMarca className="text-2xl text-ink" />;
  return (
    <>
      <img src={logo.horizontal} alt={brandName} className={cn(logo.horizontalDark && 'dark:hidden', className)} />
      {logo.horizontalDark && <img src={logo.horizontalDark} alt={brandName} className={cn('hidden dark:block', className)} />}
    </>
  );
}

/** Logo do menu lateral (fundo escuro nos dois temas). */
export function MarcaMenu({ className }: { className?: string }) {
  const { brandName, logo } = useBrand();
  if (!logo.sidebar) return <NomeMarca className="flex-1 min-w-0 text-base text-white" />;
  return <img src={logo.sidebar} alt={brandName} className={className} />;
}

/** Só o símbolo (menu recolhido). Sem arte, a inicial do nome. */
export function MarcaIcone({ className }: { className?: string }) {
  const { brandName, logo } = useBrand();
  if (!logo.icon) {
    return <span className="h-7 w-7 shrink-0 grid place-items-center rounded-md bg-accent text-white font-display font-bold text-sm">{brandName[0]}</span>;
  }
  return <img src={logo.icon} alt={brandName} className={className} />;
}
