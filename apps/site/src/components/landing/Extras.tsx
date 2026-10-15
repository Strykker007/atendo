import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EXTRAS, TESTIMONIALS } from './content';
import { Section, glass } from './Section';
import { VideoPlayer } from './VideoPlayer';
import { Reveal } from './motion';

/** Funções extras (lista) ao lado do vídeo de depoimentos. */
export function Extras() {
  return (
    <Section className="grid items-center gap-12 lg:grid-cols-[3fr_2fr]">
      <div>
        <Reveal variant="blur">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">E tem mais</p>
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{EXTRAS.title}</h2>
        </Reveal>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {EXTRAS.items.map((e, i) => (
            <Reveal as="li" key={e} variant="left" delay={i * 70}>
              <div className={cn(glass, 'flex h-full items-start gap-2.5 px-4 py-3 text-sm font-medium text-ink')}>
                <CheckCircle2 size={18} className="mt-px shrink-0 text-ok" /> {e}
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
      <Reveal variant="right" delay={200} className="text-center">
        <h3 className="mx-auto mb-6 max-w-sm font-display text-lg font-semibold text-ink">{TESTIMONIALS.title}</h3>
        <VideoPlayer vertical src={TESTIMONIALS.video.src} poster={TESTIMONIALS.video.poster} title={TESTIMONIALS.title} />
      </Reveal>
    </Section>
  );
}
