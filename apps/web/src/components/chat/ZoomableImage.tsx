'use client';
import { useEffect, useRef, useState } from 'react';
import { RotateCw, ZoomIn, ZoomOut, Maximize } from 'lucide-react';

const MIN = 1;
const MAX = 6;
/** fator por clique no +/- e por "dente" da roda */
const PASSO = 1.4;
/** zoom do duplo clique */
const DUPLO = 2.5;

type Vista = { escala: number; x: number; y: number; giro: number };
const INICIAL: Vista = { escala: 1, x: 0, y: 0, giro: 0 };
const limitar = (v: number) => Math.min(MAX, Math.max(MIN, v));

/**
 * Imagem com zoom (roda do mouse, botões +/-, duplo clique, teclas + - 0), arrastar quando
 * ampliada e girar 90°.
 *
 * O zoom da roda e do duplo clique é **na direção do cursor**: comprovante e nota fiscal são
 * lidos por pedaço, e ampliar no centro obrigava a arrastar até o valor toda vez.
 *
 * Trocar de imagem tem que zerar a vista — quem usa passa `key={url}`.
 */
export function ZoomableImage({ src, alt = '' }: { src: string; alt?: string }) {
  const [vista, setVista] = useState<Vista>(INICIAL);
  const area = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  // soltar o arrasto fora da imagem não pode virar "clique no fundo" (que fecha o visualizador)
  const arrastou = useRef(false);
  const [arrastando, setArrastando] = useState(false);

  /** zoom mantendo parado o ponto (cx, cy), relativo ao centro da área */
  function zoom(fator: number, cx = 0, cy = 0) {
    setVista((v) => {
      const escala = limitar(v.escala * fator);
      if (escala === MIN) return { ...INICIAL, giro: v.giro };
      const k = escala / v.escala;
      return { ...v, escala, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }
  const relativo = (clientX: number, clientY: number) => {
    const r = area.current!.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const;
  };

  // roda: listener próprio e não-passivo, senão o preventDefault não segura o zoom da página
  // (pinça do trackpad chega como wheel + ctrl)
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const [cx, cy] = relativo(e.clientX, e.clientY);
      zoom(e.deltaY < 0 ? Math.pow(PASSO, Math.min(1, -e.deltaY / 100)) : 1 / Math.pow(PASSO, Math.min(1, e.deltaY / 100)), cx, cy);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || e.key === '=') zoom(PASSO);
      else if (e.key === '-') zoom(1 / PASSO);
      else if (e.key === '0') setVista(INICIAL);
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const ampliada = vista.escala > MIN;
  const btn = 'p-2 rounded-lg hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div
      ref={area}
      className="relative flex-1 min-w-0 self-stretch flex items-center justify-center overflow-hidden"
      onClickCapture={(e) => { if (arrastou.current) { e.stopPropagation(); arrastou.current = false; } }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          if (ampliada) return setVista((v) => ({ ...INICIAL, giro: v.giro }));
          const [cx, cy] = relativo(e.clientX, e.clientY);
          zoom(DUPLO, cx, cy);
        }}
        onPointerDown={(e) => {
          if (!ampliada || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          arrasto.current = { px: e.clientX, py: e.clientY, x: vista.x, y: vista.y };
          arrastou.current = false;
          setArrastando(true);
        }}
        onPointerMove={(e) => {
          const a = arrasto.current;
          if (!a) return;
          const dx = e.clientX - a.px, dy = e.clientY - a.py;
          if (Math.abs(dx) + Math.abs(dy) > 3) arrastou.current = true;
          setVista((v) => ({ ...v, x: a.x + dx, y: a.y + dy }));
        }}
        onPointerUp={() => { arrasto.current = null; setArrastando(false); }}
        onPointerCancel={() => { arrasto.current = null; setArrastando(false); }}
        style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala}) rotate(${vista.giro}deg)` }}
        className={`max-h-full max-w-full object-contain rounded-lg select-none touch-none ${arrastando ? '' : 'transition-transform duration-100'} ${ampliada ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
      />

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-xl bg-black/60 px-1 py-0.5 text-white/90" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={btn} onClick={() => zoom(1 / PASSO)} disabled={!ampliada} title="Diminuir (−)" aria-label="Diminuir zoom"><ZoomOut size={17} /></button>
        <span className="w-11 text-center text-xs tnum">{Math.round(vista.escala * 100)}%</span>
        <button type="button" className={btn} onClick={() => zoom(PASSO)} disabled={vista.escala >= MAX} title="Ampliar (+)" aria-label="Ampliar zoom"><ZoomIn size={17} /></button>
        <button type="button" className={btn} onClick={() => setVista(INICIAL)} disabled={!ampliada && !vista.giro} title="Tamanho original (0)" aria-label="Restaurar"><Maximize size={16} /></button>
        <button type="button" className={btn} onClick={() => setVista((v) => ({ ...v, giro: (v.giro + 90) % 360 }))} title="Girar" aria-label="Girar 90 graus"><RotateCw size={16} /></button>
      </div>
    </div>
  );
}
