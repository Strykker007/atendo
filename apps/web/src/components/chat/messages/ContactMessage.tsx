'use client';
import { Copy } from 'lucide-react';
import type { ContentContact } from '@atendo/shared';
import { Avatar } from '../Avatar';
import { toast } from '@/components/ui/Toast';

/**
 * Contato(s) compartilhado(s) — vCard. Ainda não há "iniciar conversa" com um número novo pelo
 * painel, então a ação é copiar o telefone.
 */
export function ContactMessage({ contacts }: { contacts: ContentContact[] }) {
  if (!contacts.length) return <p className="italic text-xs opacity-70">👤 Contato sem dados</p>;
  return (
    <div className="space-y-1.5 min-w-[200px] mb-1">
      {contacts.map((c, i) => {
        const tel = c.phones[0];
        return (
          <div key={`${c.name}-${i}`} className="flex items-center gap-2 rounded-md bg-black/5 dark:bg-white/10 px-2 py-1.5">
            <Avatar name={c.name} phone={tel ?? c.name} className="w-8 h-8 text-[12px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium truncate">{c.name}</p>
              {c.phones.map((p) => <p key={p} className="text-[11px] opacity-70 tnum font-mono truncate">{formatar(p)}</p>)}
            </div>
            {tel && (
              <button type="button" title="Copiar número" aria-label="Copiar número" className="p-1 opacity-70 hover:opacity-100"
                onClick={() => navigator.clipboard.writeText(tel).then(() => toast.ok('Número copiado'), () => toast.err(new Error('Não foi possível copiar')))}>
                <Copy size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Só dígitos vira "+55 11 98888-7777"; o resto fica como veio do vCard. */
function formatar(p: string) {
  const d = p.replace(/\D/g, '');
  if (d !== p.replace(/^\+/, '')) return p;
  const m = /^(55)(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : `+${d}`;
}
