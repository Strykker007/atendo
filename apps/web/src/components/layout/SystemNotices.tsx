'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertOctagon, AlertTriangle, Bell, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistedState } from '@/lib/persisted';
import { useActiveNotices, useNoticePopups, type SystemNotice, type SystemNoticeType } from '@/lib/hooks';

/** tempo do popup: aviso do sistema é frase inteira, precisa de tempo para ler */
const POPUP_MS = 14_000;

const ESTILO: Record<SystemNoticeType, { icon: typeof Info; cls: string; label: string }> = {
  INFO: { icon: Info, cls: 'border-accent bg-accent-soft text-accent-ink', label: 'Informação' },
  WARNING: { icon: AlertTriangle, cls: 'border-warn bg-warn-soft text-warn-ink', label: 'Atenção' },
  CRITICAL: { icon: AlertOctagon, cls: 'border-danger bg-danger-soft text-danger-ink', label: 'Crítico' },
};

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Popup no topo central quando chega `system_notice` pelo socket. */
export function NoticePopups() {
  const { items, remove } = useNoticePopups();
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] w-[min(32rem,calc(100vw-2rem))] space-y-2 pointer-events-none">
      {items.map((n) => <NoticePopup key={n.id} notice={n} onClose={() => remove(n.id)} />)}
    </div>
  );
}

function NoticePopup({ notice, onClose }: { notice: SystemNotice; onClose: () => void }) {
  const fechar = useRef(onClose);
  fechar.current = onClose;
  useEffect(() => { const t = setTimeout(() => fechar.current(), POPUP_MS); return () => clearTimeout(t); }, []);
  const { icon: Icon, cls } = ESTILO[notice.type] ?? ESTILO.INFO;
  return (
    <div role="alert" className={cn('pointer-events-auto flex items-start gap-3 rounded-xl border-l-4 px-4 py-3 shadow-lg animate-fade-in', cls)}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{notice.title}</p>
        <p className="text-[13px] whitespace-pre-line break-words">{notice.message}</p>
      </div>
      <button onClick={onClose} aria-label="Fechar aviso" className="shrink-0 opacity-70 hover:opacity-100"><X size={15} /></button>
    </div>
  );
}

/**
 * Sino com os avisos ativos. "Não lido" é por navegador: guarda a data do aviso mais novo já
 * visto — aviso global não tem dono, então não vale uma tabela de leitura por usuário.
 */
export function NoticeBell({ className }: { className?: string }) {
  const notices = useActiveNotices();
  const [visto, setVisto] = usePersistedState('notices-seen', '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lista = notices.data ?? [];
  const naoLidos = lista.filter((n) => n.createdAt > visto).length;

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [open]);

  function alternar() {
    setOpen((o) => !o);
    if (lista[0] && lista[0].createdAt > visto) setVisto(lista[0].createdAt);
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button onClick={alternar} title="Avisos do sistema" aria-label={naoLidos ? `Avisos do sistema (${naoLidos} novos)` : 'Avisos do sistema'} className="relative p-1 rounded-md text-side-ink/60 hover:text-white hover:bg-white/5">
        <Bell size={17} />
        {naoLidos > 0 && <span className="absolute -top-1 -right-1 tnum text-[10px] font-bold rounded-full px-1 min-w-[16px] text-center bg-danger text-white">{naoLidos > 9 ? '9+' : naoLidos}</span>}
      </button>
      {open && (
        <div className="absolute left-full top-0 ml-2 z-50 w-80 max-w-[calc(100vw-5rem)] rounded-xl border border-line bg-panel text-ink shadow-xl">
          <div className="px-4 py-2.5 border-b border-line font-semibold text-sm">Avisos do sistema</div>
          <div className="max-h-96 overflow-y-auto divide-y divide-line">
            {!lista.length && <p className="px-4 py-6 text-center text-[13px] text-muted">{notices.isLoading ? 'Carregando…' : 'Nenhum aviso no momento.'}</p>}
            {lista.map((n) => {
              const { icon: Icon, label } = ESTILO[n.type] ?? ESTILO.INFO;
              return (
                <div key={n.id} className="px-4 py-3 flex gap-2.5">
                  <Icon size={16} className={cn('mt-0.5 shrink-0', n.type === 'CRITICAL' ? 'text-danger' : n.type === 'WARNING' ? 'text-warn' : 'text-accent')} aria-label={label} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{n.title}</p>
                    <p className="text-[13px] text-muted whitespace-pre-line break-words">{n.message}</p>
                    <p className="text-[11px] text-faint mt-0.5">{quando(n.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
