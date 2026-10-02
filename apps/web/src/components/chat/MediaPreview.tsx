'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, FileText, Pencil, Redo2, Send, Trash2, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

/**
 * Prévia antes de enviar, como no WhatsApp: o arquivo escolhido aparece numa tela sobre o
 * chat, com a legenda ali mesmo. Antes, o arquivo subia direto e a pessoa só descobria que
 * escolheu o errado depois de enviar — e cancelar já era mensagem gasta.
 *
 * Em imagem dá para rabiscar e marcar. O desenho é achatado na própria imagem no momento de
 * enviar: o WhatsApp recebe um arquivo só, não imagem + camada.
 */

const CORES = ['#ef4444', '#eab308', '#22c55e', '#3b82f6', '#111827', '#ffffff'];
const ESPESSURAS = [3, 6, 12];

export interface Escolhido {
  file: File;
  caption: string;
}

export function MediaPreview({ file, onCancel, onConfirm, enviando }: {
  file: File;
  onCancel: () => void;
  onConfirm: (escolhido: Escolhido) => void;
  enviando?: boolean;
}) {
  const [caption, setCaption] = useState('');
  const url = useObjectUrl(file);
  const ehImagem = file.type.startsWith('image/');
  const ehVideo = file.type.startsWith('video/');
  const ehAudio = file.type.startsWith('audio/');

  const [desenhando, setDesenhando] = useState(false);
  const [cor, setCor] = useState(CORES[0]);
  const [espessura, setEspessura] = useState(ESPESSURAS[1]);
  const traçosRef = useRef<Traço[]>([]);
  const desfeitosRef = useRef<Traço[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [temTraço, setTemTraço] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onCancel]);

  async function confirmar() {
    if (!ehImagem || !temTraço) return onConfirm({ file, caption });
    const achatada = await achatar(imgRef.current!, traçosRef.current, file);
    onConfirm({ file: achatada, caption });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" role="dialog" aria-modal>
      <div className="flex items-center gap-2 px-3 py-2 text-white/90">
        <button onClick={onCancel} className="p-1.5 hover:bg-white/10 rounded-lg" title="Cancelar (Esc)"><X size={20} /></button>
        <span className="text-sm truncate flex-1 min-w-0 ml-1">{file.name}</span>
        <span className="text-xs text-white/50 shrink-0">{(file.size / 1024).toFixed(0)} KB</span>

        {ehImagem && (
          <button
            onClick={() => setDesenhando((d) => !d)}
            title="Rabiscar e marcar"
            className={cn('p-1.5 rounded-lg', desenhando ? 'bg-white text-ink' : 'hover:bg-white/10')}
          >
            <Pencil size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 grid place-items-center px-4">
        {ehImagem && url && (
          <Tela
            url={url}
            desenhando={desenhando}
            cor={cor}
            espessura={espessura}
            traçosRef={traçosRef}
            desfeitosRef={desfeitosRef}
            canvasRef={canvasRef}
            imgRef={imgRef}
            onMudou={() => setTemTraço(traçosRef.current.length > 0)}
          />
        )}
        {ehVideo && url && <video src={url} controls className="max-h-full max-w-full rounded-lg" />}
        {ehAudio && url && <audio src={url} controls className="w-full max-w-md" />}
        {!ehImagem && !ehVideo && !ehAudio && (
          <div className="text-center text-white/80 space-y-2">
            <FileText size={48} className="mx-auto" />
            <div className="text-sm">{file.name}</div>
            <div className="text-xs text-white/50">Documento — o contato recebe para baixar</div>
          </div>
        )}
      </div>

      {/* a barra embrulha em telas estreitas: no celular ela estourava e o apagar saía da tela */}
      {ehImagem && desenhando && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-3 py-2">
          <div className="flex gap-1.5">
            {CORES.map((c) => (
              <button
                key={c}
                onClick={() => setCor(c)}
                style={{ background: c }}
                className={cn('w-6 h-6 rounded-full border-2', cor === c ? 'border-white scale-110' : 'border-white/30')}
                title="Cor do traço"
              >
                {cor === c && <Check size={12} className={c === '#ffffff' ? 'text-ink mx-auto' : 'text-white mx-auto'} />}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {ESPESSURAS.map((e) => (
              <button key={e} onClick={() => setEspessura(e)} className={cn('w-7 h-7 rounded-lg grid place-items-center', espessura === e ? 'bg-white' : 'bg-white/15')} title="Espessura">
                <span className="rounded-full block" style={{ width: e, height: e, background: espessura === e ? '#111827' : '#fff' }} />
              </button>
            ))}
          </div>
          <button
            onClick={() => { const t = traçosRef.current.pop(); if (t) desfeitosRef.current.push(t); redesenhar(canvasRef.current, traçosRef.current); setTemTraço(traçosRef.current.length > 0); }}
            className="p-1.5 rounded-lg text-white hover:bg-white/10" title="Desfazer"
          ><Undo2 size={18} /></button>
          <button
            onClick={() => { const t = desfeitosRef.current.pop(); if (t) traçosRef.current.push(t); redesenhar(canvasRef.current, traçosRef.current); setTemTraço(traçosRef.current.length > 0); }}
            className="p-1.5 rounded-lg text-white hover:bg-white/10" title="Refazer"
          ><Redo2 size={18} /></button>
          <button
            onClick={() => { desfeitosRef.current = [...traçosRef.current].reverse(); traçosRef.current = []; redesenhar(canvasRef.current, []); setTemTraço(false); }}
            className="p-1.5 rounded-lg text-white hover:bg-white/10" title="Apagar tudo"
          ><Trash2 size={18} /></button>
        </div>
      )}

      <div className="bg-panel border-t border-line px-2.5 py-2 flex items-end gap-2">
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void confirmar())}
          rows={1}
          placeholder="Legenda (opcional)"
          autoFocus
          className="flex-1 resize-none max-h-32 rounded-xl bg-field text-ink placeholder:text-faint px-3.5 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <Button onClick={() => void confirmar()} loading={enviando} className="w-9 h-9 rounded-full p-0" icon={<Send size={18} />} title="Enviar" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Traço { cor: string; espessura: number; pontos: { x: number; y: number }[] }

/** Imagem + camada de desenho. Os pontos ficam em 0..1 para o traço não escorregar quando a
 *  tela muda de tamanho, e para o achatamento valer na resolução original da imagem. */
function Tela({ url, desenhando, cor, espessura, traçosRef, desfeitosRef, canvasRef, imgRef, onMudou }: {
  url: string;
  desenhando: boolean;
  cor: string;
  espessura: number;
  traçosRef: React.MutableRefObject<Traço[]>;
  desfeitosRef: React.MutableRefObject<Traço[]>;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  imgRef: React.MutableRefObject<HTMLImageElement | null>;
  onMudou: () => void;
}) {
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const traçando = useRef<Traço | null>(null);

  function ajustar() {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    c.width = img.clientWidth;
    c.height = img.clientHeight;
    redesenhar(c, traçosRef.current);
  }

  useEffect(() => {
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  });

  const ponto = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <div ref={caixaRef} className="relative max-h-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={url} alt="" onLoad={ajustar} className="max-h-[70vh] max-w-full rounded-lg block" />
      <canvas
        ref={canvasRef}
        className={cn('absolute inset-0 rounded-lg', desenhando ? 'cursor-crosshair touch-none' : 'pointer-events-none')}
        onPointerDown={(e) => {
          if (!desenhando) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          traçando.current = { cor, espessura, pontos: [ponto(e)] };
          desfeitosRef.current = []; // desenhar novo invalida o que estava para refazer
        }}
        onPointerMove={(e) => {
          if (!traçando.current) return;
          traçando.current.pontos.push(ponto(e));
          redesenhar(canvasRef.current, [...traçosRef.current, traçando.current]);
        }}
        onPointerUp={() => {
          if (!traçando.current) return;
          traçosRef.current.push(traçando.current);
          traçando.current = null;
          onMudou();
        }}
      />
    </div>
  );
}

function redesenhar(c: HTMLCanvasElement | null, traços: Traço[]) {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  desenharEm(ctx, traços, c.width, c.height);
}

function desenharEm(ctx: CanvasRenderingContext2D, traços: Traço[], w: number, h: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of traços) {
    if (!t.pontos.length) continue;
    ctx.strokeStyle = t.cor;
    // a espessura acompanha a escala: um traço fino na tela não pode sair grosso no arquivo
    ctx.lineWidth = t.espessura * (w / 600);
    ctx.beginPath();
    t.pontos.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    ctx.stroke();
  }
}

/** Grava o desenho dentro da imagem, na resolução original, e devolve um arquivo novo. */
async function achatar(img: HTMLImageElement, traços: Traço[], original: File): Promise<File> {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  desenharEm(ctx, traços, c.width, c.height);

  // PNG preserva o traço sem borrar; JPEG economizaria, mas marcação fina vira sujeira
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) return original;
  return new File([blob], original.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}
