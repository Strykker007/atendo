import { CheckCheck, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { glass } from './Section';
import { Reveal } from './motion';

/** Demo estática da tela de conversas do painel, num atendimento de farmácia. Dados fictícios. */
const CONVERSAS = [
  { nome: 'Mariana Costa', previa: 'Vocês têm fralda tamanho G?', status: 'wait', ativo: true },
  { nome: 'Seu Antônio', previa: 'Segue a foto da receita', status: 'prog' },
  { nome: 'Carla Souza', previa: 'Entrega até que horas?', status: 'wait' },
  { nome: 'Ana Ribeiro', previa: 'Pode separar, obrigada! 👍', status: 'done' },
] as const;

const STATUS_DOT = { wait: 'bg-wait', prog: 'bg-prog', done: 'bg-done' } as const;

export function ChatMockup({ className }: { className?: string }) {
  return (
    <div className={cn(glass, 'overflow-hidden p-0 shadow-xl', className)} aria-hidden>
      {/* barra da janela */}
      <div className="flex items-center gap-1.5 border-b border-line/70 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-ok/70" />
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] text-left">
        {/* lista de conversas */}
        <div className="border-r border-line/70">
          <div className="m-3 flex items-center gap-2 rounded-lg bg-field px-2.5 py-1.5 text-xs text-faint">
            <Search size={13} /> Buscar
          </div>
          {CONVERSAS.map((c) => (
            <div key={c.nome} className={cn('flex items-center gap-2.5 px-3 py-2.5', 'ativo' in c && c.ativo && 'bg-accent-soft')}>
              <div className="relative h-8 w-8 shrink-0 rounded-full bg-field">
                <span className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-panel', STATUS_DOT[c.status])} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink">{c.nome}</p>
                <p className="truncate text-[11px] text-muted">{c.previa}</p>
              </div>
            </div>
          ))}
        </div>
        {/* conversa aberta */}
        <div className="flex flex-col bg-chat-bg">
          <div className="border-b border-line/70 bg-panel/80 px-4 py-2.5">
            <p className="text-xs font-semibold text-ink">Mariana Costa</p>
            <p className="text-[11px] text-muted">Balcão · com Rafael</p>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-4">
            {/* na versão animada os balões chegam um a um, como numa conversa */}
            <Reveal delay={900} className="max-w-[80%] self-start rounded-2xl rounded-tl-sm bg-chat-in px-3 py-2 text-xs text-chat-in-ink shadow-sm">
              Oi! Vocês têm fralda tamanho G? Fazem entrega?
            </Reveal>
            <Reveal delay={1700} className="max-w-[80%] self-end rounded-2xl rounded-tr-sm bg-chat-out px-3 py-2 text-xs text-chat-out-ink shadow-sm">
              Temos sim, Mariana! Pacote com 52 unidades, entrega hoje 🚚
            </Reveal>
            <Reveal delay={2500} className="max-w-[80%] self-end rounded-2xl rounded-tr-sm bg-chat-out px-3 py-2 text-xs text-chat-out-ink shadow-sm">
              <span className="block">Levando junto, o lenço umedecido sai com 20% de desconto 😉</span>
              <span className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-80">
                10:42 <CheckCheck size={12} className="text-chat-tick-read" />
              </span>
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}
