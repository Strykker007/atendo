import { cn } from '@/lib/utils';
import { FEATURES } from './content';
import { CtaLink, Section, glass } from './Section';
import { Reveal } from './motion';

export function Features() {
  return (
    <Section id="recursos" eyebrow="A solução" title={FEATURES.title} subtitle={FEATURES.subtitle}>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.items.map(({ icon: Icon, title, description }, i) => (
          <Reveal key={title} variant="zoom" delay={(i % 3) * 120}>
            <article className={cn(glass, 'group h-full p-6 transition-all hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg')}>
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent transition-transform group-hover:scale-110">
              <Icon size={24} />
            </div>
            <h3 className="mt-5 font-display text-lg font-semibold text-ink">{title}</h3>
            <p className="mt-2 text-muted">{description}</p>
            </article>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-12 flex justify-center">
        <CtaLink href={FEATURES.cta.href}>{FEATURES.cta.label}</CtaLink>
      </Reveal>
    </Section>
  );
}
