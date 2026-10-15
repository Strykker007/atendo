/* eslint-disable @next/next/no-img-element */
import { cn } from '@/lib/utils';
import { CLIENTS, METRICS } from './content';
import { CountUp } from './CountUp';
import { Section, glass } from './Section';
import { Reveal } from './motion';

/** Logos de clientes (faixa rolando) + contadores de resultado. */
export function SocialProof() {
  // a lista vai duas vezes: a animação anda metade da faixa e recomeça sem emenda
  const strip = [...CLIENTS.logos, ...CLIENTS.logos];
  return (
    <Section id="clientes" eyebrow={CLIENTS.title} title={CLIENTS.subtitle}>
      <Reveal variant="blur" className="marquee-mask overflow-hidden">
        <ul className="marquee flex w-max gap-4" aria-label="Logos de farmácias clientes">
          {strip.map((src, i) => (
            <li key={i} aria-hidden={i >= CLIENTS.logos.length || undefined}>
              {/* os logos têm fundo próprio: o bloco branco evita recorte estranho no tema escuro */}
              <img src={src} alt="" loading="lazy" className="h-20 w-56 rounded-xl border border-line/70 bg-white object-contain sm:h-24 sm:w-64" />
            </li>
          ))}
        </ul>
      </Reveal>

      <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
        {METRICS.map((m, i) => (
          <Reveal key={m.label} delay={i * 150}>
            <div className={cn(glass, 'h-full px-6 py-8 text-center')}>
            <p className="font-display text-5xl font-bold text-accent">
              {m.prefix}<CountUp value={m.value} />{m.suffix}
            </p>
            <p className="mt-2 text-muted">{m.label}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
