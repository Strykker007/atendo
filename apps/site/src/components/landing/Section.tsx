import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from './motion';

/** Cartão "vidro" da landing: translúcido sobre o fundo, borda sutil. Só tokens, para valer nos dois temas. */
export const glass = 'rounded-2xl border border-line/70 bg-panel/70 backdrop-blur-md shadow-sm';

/** Seção da landing: largura máxima, respiro vertical e título opcional. */
export function Section({ id, eyebrow, title, subtitle, className, children }: {
  id?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn('mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 scroll-mt-16', className)}>
      {title && (
        <Reveal variant="blur" className="mx-auto mb-12 max-w-2xl text-center">
          {eyebrow && <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>}
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h2>
          {subtitle && <p className="mt-4 text-lg text-muted">{subtitle}</p>}
        </Reveal>
      )}
      {children}
    </section>
  );
}

/** Botão de ação principal (link). Âncoras internas (#planos) ou externos. */
export function CtaLink({ href, children, className, icon, external }: {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** ícone à esquerda; sem ele, seta à direita */
  icon?: React.ReactNode;
  /** abre em nova aba (WhatsApp): a página fica aberta e os eventos de conversão terminam de enviar */
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
      className={cn(
        'group inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-center font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:-translate-y-0.5 hover:bg-accent-hover',
        className,
      )}
    >
      {icon}
      {children}
      {!icon && <ArrowRight size={18} className="shrink-0 transition-transform group-hover:translate-x-0.5" />}
    </a>
  );
}
