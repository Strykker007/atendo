'use client';
import { useEffect, useState } from 'react';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { APP_URL } from '@/lib/site';
import { setTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { NAV_LINKS } from './content';

/** Alterna claro/escuro. O tema inicial já foi aplicado pelo script do layout. */
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  return (
    <button
      type="button"
      onClick={() => {
        setTheme(!dark);
        setDark(!dark);
      }}
      aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}
      className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-field hover:text-ink"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8);
    h();
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  return (
    <header className={cn('sticky top-0 z-40 transition-colors', scrolled ? 'border-b border-line/70 bg-canvas/80 backdrop-blur-md' : 'border-b border-transparent')}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="#" className="shrink-0">
          <Logo className="h-8 w-auto" />
        </a>
        <nav className="hidden flex-1 items-center gap-6 lg:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-muted transition-colors hover:text-ink">{l.label}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <a href={`${APP_URL}/login`} className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-field sm:inline-flex">Entrar</a>
          <a href="#planos" className="hidden rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover sm:inline-flex">
            Ver valores
          </a>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className="grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-field lg:hidden">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line bg-canvas px-4 py-3 lg:hidden">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-field">{l.label}</a>
          ))}
          <a href={`${APP_URL}/login`} className="block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-field">Entrar</a>
        </nav>
      )}
    </header>
  );
}
