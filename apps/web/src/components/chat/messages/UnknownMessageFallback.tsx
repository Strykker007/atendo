'use client';
import { HelpCircle } from 'lucide-react';

/**
 * Último recurso: a API já tenta extrair qualquer texto do payload; isto só aparece quando nem
 * isso existe. Nunca mostra a palavra crua "unknown" — o atendente precisa saber que chegou algo
 * e que deve olhar no celular.
 */
export function UnknownMessageFallback({ text, interactive }: { text?: string | null; interactive?: boolean }) {
  if (text) return <p className="whitespace-pre-wrap break-words">{text}</p>;
  return (
    <p className="flex items-center gap-1.5 italic text-xs opacity-75">
      <HelpCircle size={13} className="shrink-0" />
      {interactive ? 'Mensagem interativa recebida' : 'Conteúdo não suportado para visualização — confira no celular'}
    </p>
  );
}
