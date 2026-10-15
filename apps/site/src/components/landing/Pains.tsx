import { XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAINS } from './content';
import { Section, glass } from './Section';
import { Reveal } from './motion';

/** "Você passa por isso?": as dores antes da solução. */
export function Pains() {
  return (
    <Section eyebrow="O problema" title={PAINS.title}>
      <ul className="grid gap-4 md:grid-cols-2">
        {/* coluna da esquerda entra pela esquerda, a da direita pela direita */}
        {PAINS.items.map((p, i) => (
          <Reveal as="li" key={p} variant={i % 2 ? 'right' : 'left'} delay={Math.floor(i / 2) * 120}>
            <div className={cn(glass, 'flex h-full gap-3 p-5 transition-colors hover:border-danger/40')}>
              <XCircle size={20} className="mt-0.5 shrink-0 text-danger" />
              <span className="text-ink">{p}</span>
            </div>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
