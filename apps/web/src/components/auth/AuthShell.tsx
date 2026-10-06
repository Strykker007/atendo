import Link from 'next/link';
import { MarcaHorizontal } from '@/components/ui/Marca';

/** Cartão centralizado usado por login, esqueci a senha, redefinir e convite. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center px-4 bg-canvas">
      <div className="w-full max-w-sm bg-panel rounded-2xl shadow-sm border border-line p-8 space-y-5">
        <MarcaHorizontal className="h-10 w-auto max-w-full object-contain object-left" />
        <div>
          <h1 className="font-display font-semibold text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="text-sm text-muted text-center pt-1">{footer}</div>}
      </div>
    </main>
  );
}
export const AuthLink = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="text-accent-ink hover:underline">{children}</Link>;
