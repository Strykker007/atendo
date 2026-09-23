'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Wand2, ListChecks, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useAiRewrite, useAiSuggest, useAiSummary, type RewriteTone } from '@/lib/hooks';

const TONES: { id: RewriteTone; label: string }[] = [
  { id: 'formal', label: 'Mais formal' },
  { id: 'friendly', label: 'Mais simpático' },
  { id: 'short', label: 'Mais curto' },
  { id: 'clear', label: 'Mais claro' },
];

/**
 * Copiloto no campo de digitação. **Nada é enviado ao cliente por aqui**: a IA escreve
 * no composer e o atendente revisa, edita e clica em enviar.
 */
export function CopilotBar({ conversationId, text, onText }: { conversationId: string; text: string; onText: (t: string) => void }) {
  const suggest = useAiSuggest();
  const rewrite = useAiRewrite();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const busy = suggest.isPending || rewrite.isPending;

  return (
    <div className="flex items-center gap-1.5 text-[11px]" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        className="h-6 px-2 text-[11px] gap-1 text-accent border-accent/30"
        loading={suggest.isPending}
        disabled={busy}
        icon={<Sparkles size={12} />}
        title="A IA escreve uma sugestão aqui no campo. Você revisa antes de enviar."
        onClick={() => suggest.mutateAsync(conversationId).then((r) => onText(r.text)).catch(toast.err)}
      >
        Sugerir resposta
      </Button>

      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          className="h-6 px-2 text-[11px] gap-1 text-muted"
          loading={rewrite.isPending}
          disabled={busy || text.trim().length < 2}
          icon={<Wand2 size={12} />}
          title={text.trim().length < 2 ? 'Escreva algo para a IA reescrever' : 'Reescrever o que você digitou'}
          onClick={() => setMenu((m) => !m)}
        >
          Reescrever
        </Button>
        {menu && (
          <div className="absolute bottom-full mb-1 left-0 z-20 w-40 rounded-lg border border-line bg-panel shadow-lg py-1">
            {TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-field text-ink"
                onClick={() => {
                  setMenu(false);
                  rewrite.mutateAsync({ text, tone: t.id, conversationId }).then((r) => onText(r.text)).catch(toast.err);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="text-faint">a IA sugere, você revisa e envia</span>
    </div>
  );
}

/** Resumo da conversa para quem vai assumir. Aparece como faixa acima do composer. */
export function SummaryButton({ conversationId }: { conversationId: string }) {
  const summary = useAiSummary();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(null), [conversationId]);

  if (text) {
    return (
      <div className="bg-accent-soft border-b border-accent/20 px-3 py-2 text-[12px] text-ink">
        <div className="flex items-start gap-2">
          <ListChecks size={14} className="text-accent mt-0.5 shrink-0" />
          <p className="flex-1 whitespace-pre-wrap leading-snug">{text}</p>
          <button onClick={() => setText(null)} className="text-faint hover:text-ink" title="Fechar"><X size={14} /></button>
        </div>
        <p className="text-[10px] text-faint mt-1 pl-6">Resumo gerado por IA a partir das últimas mensagens — confira antes de agir.</p>
      </div>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-7 px-2 text-[11px] gap-1 text-muted"
      loading={summary.isPending}
      icon={<ListChecks size={13} />}
      title="Resumir a conversa para quem vai assumir"
      onClick={() => summary.mutateAsync(conversationId).then((r) => setText(r.text)).catch(toast.err)}
    >
      Resumir
    </Button>
  );
}
