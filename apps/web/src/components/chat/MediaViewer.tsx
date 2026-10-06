'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, X } from 'lucide-react';

export interface ViewerMedia { url: string; nome?: string | null; tipo: 'image' | 'video' }

/**
 * Visualizador de imagem e vídeo em tela cheia, sobre o chat.
 *
 * Abrir em aba nova tirava o atendente da conversa: ele perdia o contexto, voltava e tinha
 * que achar o lugar de novo. Aqui a mídia abre por cima e fecha com Esc, no X ou num clique fora,
 * sem sair de onde estava. Vídeo vem com os controles nativos completos (play/pausa, barra,
 * volume, tela cheia do navegador).
 *
 * As setas percorrem as **outras imagens e vídeos da mesma conversa**, que é como se olha um
 * comprovante seguido da foto do produto sem ficar fechando e reabrindo.
 */
export function MediaViewerModal({ midias, indice, onIndice, onClose }: {
  midias: ViewerMedia[];
  indice: number;
  onIndice: (i: number) => void;
  onClose: () => void;
}) {
  const atual = midias[indice];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      // com o foco no vídeo, ← → avançam/voltam o vídeo (nativo), não trocam de mídia
      if (e.target instanceof HTMLVideoElement) return;
      if (e.key === 'ArrowRight' && indice < midias.length - 1) onIndice(indice + 1);
      if (e.key === 'ArrowLeft' && indice > 0) onIndice(indice - 1);
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [indice, midias.length, onIndice, onClose]);

  if (!atual) return null;
  const titulo = atual.nome ?? (atual.tipo === 'video' ? 'Vídeo' : 'Imagem');

  return (
    // o clique no fundo fecha; o clique na mídia não, senão olhar de perto (ou dar play) fecharia sem querer
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={onClose} role="dialog" aria-modal aria-label={titulo}>
      <div className="flex items-center gap-2 px-3 py-2 text-white/90" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" title="Fechar (Esc)"><X size={20} /></button>
        <span className="text-sm truncate flex-1 min-w-0">{titulo}</span>
        {midias.length > 1 && <span className="text-xs text-white/50 tnum shrink-0">{indice + 1} de {midias.length}</span>}
        <BotaoBaixar midia={atual} />
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-between gap-2 px-2 pb-4">
        <Seta lado="esq" visivel={indice > 0} onClick={() => onIndice(indice - 1)} />
        {atual.tipo === 'video' ? (
          // `key`: trocar de mídia recria o player (o anterior para de tocar)
          <video key={atual.url} src={atual.url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full min-w-0 rounded-lg bg-black" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={atual.url} alt="" onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full min-w-0 object-contain rounded-lg" />
        )}
        <Seta lado="dir" visivel={indice < midias.length - 1} onClick={() => onIndice(indice + 1)} />
      </div>
    </div>
  );
}

/**
 * Baixa de verdade: o atributo `download` é ignorado em URL de outro domínio (storage), e o
 * navegador só abria o arquivo. Busca como blob; se o storage recusar (CORS), abre em aba nova.
 */
function BotaoBaixar({ midia }: { midia: ViewerMedia }) {
  const [baixando, setBaixando] = useState(false);
  async function baixar() {
    setBaixando(true);
    try {
      const res = await fetch(midia.url);
      if (!res.ok) throw new Error(String(res.status));
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = midia.nome || nomePadrao(midia, res.headers.get('content-type'));
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      window.open(midia.url, '_blank', 'noopener');
    } finally {
      setBaixando(false);
    }
  }
  return (
    <button onClick={() => void baixar()} disabled={baixando} className="p-1.5 hover:bg-white/10 rounded-lg disabled:opacity-60" title="Baixar">
      {baixando ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
    </button>
  );
}

const nomePadrao = (m: ViewerMedia, mime: string | null) => {
  const ext = mime?.split('/')[1]?.split(';')[0] || (m.tipo === 'video' ? 'mp4' : 'jpg');
  return `${m.tipo === 'video' ? 'video' : 'imagem'}.${ext}`;
};

function Seta({ lado, visivel, onClick }: { lado: 'esq' | 'dir'; visivel: boolean; onClick: () => void }) {
  // ocupa o espaço mesmo invisível, para a mídia não pular ao chegar na primeira ou na última
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
