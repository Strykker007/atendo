'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Wand2, ListChecks, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useAiRewrite, useAiSuggest, useAiSummary, type AiSummary, type RewriteTone } from '@/lib/hooks';
import { cn } from '@/lib/utils';

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

/** "agora há pouco", "há 5 min", "há 2 h", "em 03/10" */
function updatedLabel(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'Atualizado agora há pouco';
  if (min < 60) return `Atualizado há ${min} min`;
  if (min < 24 * 60) return `Atualizado há ${Math.floor(min / 60)} h`;
  return `Atualizado em ${new Date(iso).toLocaleDateString('pt-BR')}`;
}

/**
 * Resumo da conversa para quem vai assumir: ícone no cabeçalho que abre um popover.
 * Abrir é de graça quando não chegou mensagem nova (a API devolve o cache);
 * "Atualizar" força uma geração nova e cobra uma interação.
 */
export function SummaryButton({ conversationId }: { conversationId: string }) {
  const summary = useAiSummary();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AiSummary | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(false); setData(null); }, [conversationId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const load = (force = false) =>
    summary.mutateAsync({ conversationId, force }).then(setData).catch((e) => { toast.err(e); if (!data) setOpen(false); });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // sempre pergunta à API ao abrir: se nada mudou, ela devolve o cache sem chamar a IA
    if (next) load();
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        variant="ghost"
        icon={<Sparkles size={14} className="text-accent" />}
        onClick={toggle}
        aria-expanded={open}
        title="Resumo da conversa por IA"
      >
        <span className="hidden lg:inline">Resumo</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
            <ListChecks size={14} className="text-accent shrink-0" />
            <span className="text-sm font-semibold text-ink flex-1">Resumo da conversa</span>
            <button onClick={() => setOpen(false)} className="text-faint hover:text-ink" title="Fechar"><X size={14} /></button>
          </div>
          <div className="px-3 py-2.5 max-h-80 overflow-y-auto">
            {summary.isPending && !data ? (
              <div className="space-y-2 animate-pulse" aria-label="Gerando resumo">
                <div className="h-3 rounded bg-field w-11/12" />
                <div className="h-3 rounded bg-field w-4/5" />
                <div className="h-3 rounded bg-field w-2/3" />
              </div>
            ) : data ? (
              <p className={cn('text-[12.5px] leading-relaxed text-ink whitespace-pre-wrap', summary.isPending && 'opacity-50')}>{data.text}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-t border-line">
            {data && (
              <span className="inline-flex items-center rounded-full bg-accent-soft text-accent text-[10.5px] font-semibold px-2 py-0.5">
                {updatedLabel(data.updatedAt)}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              className="h-6 px-2 text-[11px] gap-1 text-muted ml-auto"
              loading={summary.isPending && !!data}
              disabled={summary.isPending}
              icon={<RefreshCw size={12} />}
              title="Gerar o resumo de novo (conta como uma interação de IA)"
              onClick={() => load(true)}
            >
              Atualizar
            </Button>
          </div>
          <p className="text-[10px] text-faint px-3 pb-2">Gerado por IA a partir das últimas mensagens — confira antes de agir.</p>
        </div>
      )}
    </div>
  );
}
