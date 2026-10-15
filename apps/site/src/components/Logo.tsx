/* eslint-disable @next/next/no-img-element */
import { SITE } from '@/lib/site';
import { cn } from '@/lib/utils';

/** Logo horizontal: duas artes porque o texto escuro sumiria no tema escuro. */
export function Logo({ className }: { className?: string }) {
  return (
    <>
      <img src={SITE.logo.light} alt={SITE.name} className={cn('dark:hidden', className)} />
      <img src={SITE.logo.dark} alt={SITE.name} className={cn('hidden dark:block', className)} />
    </>
  );
}
