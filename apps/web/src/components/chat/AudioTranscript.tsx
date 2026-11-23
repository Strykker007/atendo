'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ScrollText } from 'lucide-react';
import { useAiStatus, useAiTranscribe, upsertMessageInCache, type Message } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * "Transcrever" embaixo do áudio, como no WhatsApp (docs/transcricao-de-audio.md). Só a pedido:
 * cada clique novo custa. O texto fica gravado na mensagem — depois de transcrito, qualquer
 * atendente vê sem pagar de novo.
 */
export function AudioTranscript({ m }: { m: Message }) {
  const ai = useAiStatus();
  const transcribe = useAiTranscribe();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  if (m.deletedAt || !m.mediaUrl) return null;

  if (m.transcript != null) {
    return (
      <div className="mt-0.5 mb-1 max-w-[280px]">
        <button type="button" onClick={() => setAberto((v) => !v)} className="inline-flex items-center gap-1 text-[10.5px] font-semibold opacity-70 hover:opacity-100">
          <ScrollText size={11} /> Transcrição {aberto ? '▴' : '▾'}
        </button>
        {aberto && <p className={cn('text-[12px] leading-snug whitespace-pre-wrap break-words', !m.transcript && 'italic opacity-70')}>{m.transcript || 'Nenhuma fala reconhecida neste áudio.'}</p>}
      </div>
    );
  }

  if (!ai.transcribe) return null;
  return (
    <div className="mb-1 flex items-center gap-2">
      <button
        type="button"
        disabled={transcribe.isPending}
        onClick={() => {
          setErro(null);
          transcribe.mutate(
            { conversationId: m.conversationId, messageId: m.id },
            {
              onSuccess: (r) => upsertMessageInCache(qc, { ...m, transcript: r.transcript }),
              onError: (e) => setErro(e instanceof Error ? e.message : 'Não foi possível transcrever.'),
            },
          );
        }}
        className="inline-flex items-center gap-1 text-[11px] font-semibold opacity-75 hover:opacity-100 disabled:opacity-50"
      >
        {transcribe.isPending ? <Loader2 size={11} className="animate-spin" /> : <ScrollText size={11} />}
        {transcribe.isPending ? 'Transcrevendo…' : 'Transcrever'}
      </button>
      {erro && <span className="text-[10.5px] text-danger">{erro}</span>}
    </div>
  );
}
