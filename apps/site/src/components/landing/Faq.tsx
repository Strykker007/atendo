'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FAQ } from './content';
import { Reveal } from './motion';
import { Section, glass } from './Section';

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section id="faq" eyebrow="Dúvidas" title="Perguntas frequentes" className="max-w-3xl">
      <div className="space-y-3">
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={item.q} delay={i * 70}>
            <div className={cn(glass, 'overflow-hidden')}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={`faq-${i}`}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-ink transition-colors hover:text-accent"
              >
                {item.q}
                <ChevronDown size={18} className={cn('shrink-0 text-muted transition-transform duration-200', isOpen && 'rotate-180')} />
              </button>
              {/* grid-rows 0fr→1fr anima a altura sem medir o conteúdo */}
              <div id={`faq-${i}`} className={cn('grid transition-[grid-template-rows] duration-200', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                <div className="overflow-hidden">
                  <p className="px-5 pb-4 text-muted">{item.a}</p>
                </div>
              </div>
            </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
