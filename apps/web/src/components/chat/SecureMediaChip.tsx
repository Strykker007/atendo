'use client';
import { Lock, Eye, Ban } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { useRevokeSecureMedia, useSecureMedia, secureMediaHashIn } from '@/lib/hooks';

/**
 * Na bolha da mensagem com link de foto protegida: a foto que foi (a equipe continua vendo, mesmo
 * expirada para o contato), se o contato abriu e até quando vale. Revogar tira a página do ar.
 * Ver docs/foto-protegida.md.
 */
export function SecureMediaChip({ conversationId, text, onVerMidia }: { conversationId: string; text: string | null; onVerMidia?: (url: string) => void }) {
  const hash = secureMediaHashIn(text);
  const lista = useSecureMedia(conversationId, !!hash);
  const revogar = useRevokeSecureMedia();
  const sm = hash ? lista.data?.find((x) => x.hash === hash) : undefined;
  if (!sm) return null;
  const imagem = sm.mimeType.startsWith('image/');
  const situacao = sm.status === 'revoked' ? 'revogado' : sm.status === 'expired' ? 'expirado' : `até ${new Date(sm.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
  return (
    <div className="mt-1 flex items-center gap-2 rounded-lg bg-black/5 p-1.5 text-[11px]">
      {imagem
        ? <img src={sm.url} alt="" onClick={() => onVerMidia?.(sm.url)} className="h-12 w-12 rounded object-cover cursor-zoom-in shrink-0" />
        : <a href={sm.url} target="_blank" rel="noreferrer" className="h-12 w-12 rounded bg-black/10 grid place-items-center shrink-0"><Lock size={16} /></a>}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="font-semibold flex items-center gap-1"><Lock size={11} /> Foto protegida · {situacao}</div>
        <div className="text-muted flex items-center gap-1">
          <Eye size={11} /> {sm.viewCount ? `aberta ${sm.viewCount}× · 1ª em ${new Date(sm.firstViewedAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'ainda não aberta'}
        </div>
        {sm.caption && <div className="text-muted truncate" title={sm.caption}>Legenda: {sm.caption}</div>}
      </div>
      {sm.status === 'active' && (
        <button
          type="button"
          title="Tirar a foto do ar agora"
          disabled={revogar.isPending}
          onClick={() => revogar.mutate({ conversationId, id: sm.id }, { onSuccess: () => toast.ok('Link revogado: a foto saiu do ar'), onError: (e) => toast.err(e) })}
          className="shrink-0 rounded p-1 text-faint hover:text-danger"
        >
          <Ban size={14} />
        </button>
      )}
    </div>
  );
}
