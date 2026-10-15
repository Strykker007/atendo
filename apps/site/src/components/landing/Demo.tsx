import { DEMO } from './content';
import { CtaLink, Section } from './Section';
import { VideoPlayer } from './VideoPlayer';
import { Reveal } from './motion';

export function Demo() {
  return (
    <Section id="demonstracao" eyebrow="Na prática" title={DEMO.title} subtitle={DEMO.subtitle}>
      <Reveal variant="zoom">
        <VideoPlayer src={DEMO.video.src} poster={DEMO.video.poster} title={DEMO.title} />
      </Reveal>
      <Reveal delay={150} className="mt-10 flex justify-center">
        <CtaLink href={DEMO.cta.href}>{DEMO.cta.label}</CtaLink>
      </Reveal>
    </Section>
  );
}
