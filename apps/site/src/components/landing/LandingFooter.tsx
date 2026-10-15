import { Facebook, Instagram } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { APP_URL, SITE } from '@/lib/site';
import { NAV_LINKS } from './content';

export function LandingFooter() {
  return (
    <footer className="border-t border-line bg-panel/50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Logo className="h-8 w-auto" />
          <p className="mt-4 max-w-sm text-sm text-muted">Sistema de atendimento no WhatsApp para farmácias venderem mais.</p>
          <div className="mt-4 flex gap-2">
            <a href={SITE.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-field hover:text-ink"><Instagram size={18} /></a>
            <a href={SITE.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-field hover:text-ink"><Facebook size={18} /></a>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Navegação</p>
          <ul className="mt-3 space-y-2">
            {NAV_LINKS.map((l) => (
              <li key={l.href}><a href={l.href} className="text-sm text-muted transition-colors hover:text-ink">{l.label}</a></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Clientes</p>
          <ul className="mt-3 space-y-2">
            <li><a href={`${APP_URL}/login`} className="text-sm text-muted transition-colors hover:text-ink">Entrar no painel</a></li>
            <li><a href={`mailto:${SITE.supportEmail}`} className="text-sm text-muted transition-colors hover:text-ink">{SITE.supportEmail}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-faint sm:px-6">
          © {new Date().getFullYear()} {SITE.name}. Todos os direitos reservados. · CNPJ {SITE.cnpj}
        </p>
      </div>
    </footer>
  );
}
