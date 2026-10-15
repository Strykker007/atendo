import { CheckCircle2, Heart, PlayCircle } from 'lucide-react';
import { ChatMockup } from './ChatMockup';
import { HERO } from './content';
import { Reveal } from './motion';
import { CtaLink } from './Section';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* brilhos de fundo (com parallax na versão animada) */}
      <div className="parallax-slow pointer-events-none absolute inset-x-0 -top-40 -z-10 mx-auto h-[480px] max-w-4xl rounded-full bg-accent/20 blur-3xl" />
      <div className="parallax-fast pointer-events-none absolute -right-32 top-1/2 -z-10 h-72 w-72 rounded-full bg-ok/15 blur-3xl" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-2 lg:pb-24">
        <div className="text-center lg:text-left">
          <Reveal>
            <p className="font-display text-sm font-bold uppercase tracking-wider text-danger">{HERO.eyebrow}</p>
          </Reveal>
          <Reveal delay={120}>
            <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-[3.2rem] lg:leading-[1.1]">
              {HERO.title}
            </h1>
          </Reveal>
          <Reveal delay={240}>
            <p className="mt-6 text-lg text-muted">{HERO.subtitle}</p>
          </Reveal>
          <Reveal delay={360}>
            <p className="mt-6 inline-flex items-start gap-2 rounded-xl border border-ok/30 bg-ok-soft px-4 py-2.5 text-left text-sm font-semibold text-ink">
              <Heart size={16} className="mt-0.5 shrink-0 fill-ok text-ok" /> {HERO.offer}
            </p>
          </Reveal>
          <Reveal delay={480} className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <CtaLink href={HERO.ctaPrimary.href}>{HERO.ctaPrimary.label}</CtaLink>
            <a
              href={HERO.ctaSecondary.href}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-panel/70 px-6 py-3 font-semibold text-ink backdrop-blur transition-colors hover:bg-field"
            >
              <PlayCircle size={18} /> {HERO.ctaSecondary.label}
            </a>
          </Reveal>
          <Reveal delay={600}>
            <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted lg:justify-start">
              {HERO.highlights.map((h) => (
                <li key={h} className="flex items-center gap-1.5"><CheckCircle2 size={15} className="text-ok" /> {h}</li>
              ))}
            </ul>
          </Reveal>
        </div>
        <Reveal variant="right" delay={300}>
          <div className="float">
            <ChatMockup className="lg:rotate-1 lg:transition-transform lg:hover:rotate-0" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
