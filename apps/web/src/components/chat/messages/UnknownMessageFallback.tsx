'use client';
import { EyeOff, HelpCircle } from 'lucide-react';

/**
 * Último recurso: a API já tenta extrair qualquer texto do payload; isto só aparece quando nem
 * isso existe. Nunca mostra a palavra crua "unknown" — o atendente precisa saber que chegou algo
 * e que deve olhar no celular.
 */
export function UnknownMessageFallback({ text, interactive, unavailable }: { text?: string | null; interactive?: boolean; unavailable?: boolean }) {
  if (text) return <p className="whitespace-pre-wrap break-words">{text}</p>;
  // API oficial: o WhatsApp avisou que chegou algo, mas não liberou o conteúdo (docs/meta-cadastro-incorporado.md)
  if (unavailable) {
    return (
      <p className="flex items-start gap-1.5 italic text-xs opacity-75">
        <EyeOff size={13} className="shrink-0 mt-0.5" />
        <span>Mensagem indisponível — o WhatsApp não liberou o conteúdo para a API oficial (ex.: visualização única ou enquete). Confira no celular ou peça para o cliente reenviar.</span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 italic text-xs opacity-75">
      <HelpCircle size={13} className="shrink-0" />
      {interactive ? 'Mensagem interativa recebida' : 'Conteúdo não suportado para visualização — confira no celular'}
    </p>
  );
}
