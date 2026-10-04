'use client';
import { useState } from 'react';
import { List, ChevronDown } from 'lucide-react';
import type { ContentListRow } from '@atendo/shared';
import { cn } from '@/lib/utils';

/** Lista/menu interativo. Como no WhatsApp, as opções ficam atrás de um botão. */
export function ListMessage({ text, header, footer, buttonText, sections }: { text: string | null; header?: string; footer?: string; buttonText?: string; sections: { title?: string; rows: ContentListRow[] }[] }) {
  const [aberta, setAberta] = useState(false);
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  return (
    <div className="min-w-[180px]">
      {header && <p className="font-semibold mb-0.5 break-words">{header}</p>}
      {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
      {footer && <p className="text-[11px] opacity-70 mt-0.5 break-words">{footer}</p>}
      {total > 0 && (
        <>
          <button type="button" onClick={() => setAberta((a) => !a)} aria-expanded={aberta} className="mt-1.5 -mx-2.5 w-[calc(100%+1.25rem)] flex items-center justify-center gap-1.5 border-t border-black/10 dark:border-white/10 px-2.5 py-1.5 text-[12.5px] font-medium text-accent hover:bg-black/5 dark:hover:bg-white/10">
            <List size={13} /> {buttonText || 'Ver opções'} <ChevronDown size={13} className={cn('transition-transform', aberta && 'rotate-180')} />
          </button>
          {aberta && (
            <div className="mt-1 space-y-1.5">
              {sections.map((s, i) => (
                <div key={i}>
                  {s.title && <p className="text-[10.5px] font-semibold uppercase tracking-wider opacity-60">{s.title}</p>}
                  <ul className="space-y-0.5">
                    {s.rows.map((r, j) => (
                      <li key={`${r.id ?? r.title}-${j}`} className="rounded-md bg-black/5 dark:bg-white/10 px-2 py-1">
                        <p className="text-[12.5px] font-medium break-words">{r.title}</p>
                        {r.description && <p className="text-[11px] opacity-70 break-words">{r.description}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
