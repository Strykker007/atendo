'use client';
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';

/**
 * Visualizador de imagem sobre o chat.
 *
 * Abrir em aba nova tirava o atendente da conversa: ele perdia o contexto, voltava e tinha
 * que achar o lugar de novo. Aqui a imagem abre por cima e fecha com Esc ou um clique fora,
 * sem sair de onde estava.
 *
 * As setas percorrem as **outras imagens da mesma conversa**, que é como se olha um
 * comprovante seguido da foto do produto sem ficar fechando e reabrindo.
 */
export function ImageViewer({ imagens, indice, onIndice, onClose }: {
  imagens: { url: string; nome?: string | null }[];
  indice: number;
  onIndice: (i: number) => void;
  onClose: () => void;
}) {
  const atual = imagens[indice];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && indice < imagens.length - 1) onIndice(indice + 1);
      if (e.key === 'ArrowLeft' && indice > 0) onIndice(indice - 1);
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [indice, imagens.length, onIndice, onClose]);

  if (!atual) return null;

  return (
    // o clique no fundo fecha; o clique na imagem não, senão olhar de perto fecharia sem querer
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={onClose} role="dialog" aria-modal>
      <div className="flex items-center gap-2 px-3 py-2 text-white/90" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" title="Fechar (Esc)"><X size={20} /></button>
        <span className="text-sm truncate flex-1 min-w-0">{atual.nome ?? 'Imagem'}</span>
        {imagens.length > 1 && <span className="text-xs text-white/50 tnum shrink-0">{indice + 1} de {imagens.length}</span>}
        <a href={atual.url} download={atual.nome ?? undefined} target="_blank" rel="noreferrer" className="p-1.5 hover:bg-white/10 rounded-lg" title="Baixar">
          <Download size={18} />
        </a>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-between gap-2 px-2 pb-4">
        <Seta lado="esq" visivel={indice > 0} onClick={() => onIndice(indice - 1)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={atual.url} alt="" onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain rounded-lg" />
        <Seta lado="dir" visivel={indice < imagens.length - 1} onClick={() => onIndice(indice + 1)} />
      </div>
    </div>
  );
}

function Seta({ lado, visivel, onClick }: { lado: 'esq' | 'dir'; visivel: boolean; onClick: () => void }) {
  // ocupa o espaço mesmo invisível, para a imagem não pular ao chegar na primeira ou na última
  if (!visivel) return <span className="w-10 shrink-0" />;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/10 text-white hover:bg-white/20"
      title={lado === 'esq' ? 'Anterior (←)' : 'Próxima (→)'}
    >
      {lado === 'esq' ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );
}
