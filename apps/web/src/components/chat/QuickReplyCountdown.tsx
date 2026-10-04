'use client';
import { useEffect, useState } from 'react';
import { Pencil, X, Zap } from 'lucide-react';
import type { Upload } from '@/lib/hooks';

/** Resposta rápida escolhida, esperando a contagem para sair (docs/envio.md). */
export interface QuickReplyPending {
  title: string;
  text: string;
  media?: Upload;
  /** epoch ms em que sai */
  at: number;
  /** chave de idempotência do envio: criada na escolha, não no disparo */
  key: string;
}

/** Evento que os painéis de resposta rápida disparam; o ChatPane decide se agenda ou insere. */
export const QUICK_REPLY_EVENT = 'atendo:quick-reply';
export type QuickReplyEventDetail = { title: string; text: string; media?: Upload };

export function QuickReplyCountdown({ pending, onCancel, onEdit }: { pending: QuickReplyPending; onCancel: () => void; onEdit: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((pending.at - now) / 1000));
  return (
    <div className="flex items-center gap-2 rounded-md bg-accent-soft px-2 py-1 text-[12px] text-ink" role="status">
      <Zap size={13} className="text-accent shrink-0" />
      <span className="flex-1 min-w-0 truncate">
        Enviando <b>{pending.title}</b> em <span className="tnum font-semibold">{left}s</span>…
      </span>
      <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:text-ink hover:bg-panel">
        <Pencil size={11} /> Editar
      </button>
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-danger-ink hover:bg-panel">
        <X size={12} /> Cancelar
      </button>
    </div>
  );
}
