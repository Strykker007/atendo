import { AlertTriangle, Check } from 'lucide-react';
import { WhatsAppIcon } from '@/components/WhatsAppIcon';
import { WHATSAPP_URL } from '@/lib/site';
import { cn } from '@/lib/utils';
import { OFFER } from './content';
import { CtaLink, Section, glass } from './Section';
import { Reveal } from './motion';

/** Oferta + filtro de qualificação antes do WhatsApp do consultor (destino de todos os CTAs da página). */
export function Pricing() {
  const w = OFFER.warning;
  return (
    <Section id="planos" eyebrow="Valores" title={OFFER.title} className="max-w-3xl">
      <Reveal variant="zoom">
      <article className={cn(glass, 'relative bg-panel p-6 text-center shadow-xl shadow-accent/10 ring-1 ring-accent sm:p-10')}>
        <p className="font-semibold text-muted">{OFFER.plan}</p>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted">Apenas</p>
        <p className="flex items-baseline justify-center gap-1">
          <span className="font-display text-6xl font-bold text-accent">{OFFER.price}</span>
          <span className="text-lg text-muted">{OFFER.period}</span>
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
          {OFFER.perks.map((p) => (
            <li key={p} className="flex items-center gap-1.5 font-medium text-ink"><Check size={18} className="text-ok" /> {p}</li>
          ))}
        </ul>

        <div className="mt-8 rounded-xl border border-warn/40 bg-warn-soft p-5 text-left text-sm text-warn-ink">
          <p className="flex items-center gap-2 font-bold uppercase"><AlertTriangle size={18} /> {w.title}</p>
          <p className="mt-2"><strong>{w.lead}</strong>{w.rest}</p>
          <p className="mt-2">{w.note}</p>
        </div>

        <CtaLink href={WHATSAPP_URL} external icon={<WhatsAppIcon size={20} />} className="mt-8 w-full bg-ok shadow-ok/25 hover:bg-ok/90 sm:w-auto">
          {OFFER.cta}
        </CtaLink>
        <p className="mt-6 text-sm text-muted">{OFFER.closing}</p>
      </article>
      </Reveal>
    </Section>
  );
}
