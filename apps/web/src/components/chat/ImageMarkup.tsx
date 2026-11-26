'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Eraser, PenLine, Square, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

/**
 * Riscar a imagem antes de mandar na nota interna (docs/notas-internas.md#imagem): caneta,
 * retângulo e seta, cor e espessura, desfazer e limpar. Tudo no navegador, sobre o arquivo local —
 * nada sobe antes de "Concluir". A imagem é reduzida para no máximo 2000 px no lado maior: print de
 * tela cheia e foto de celular passariam do limite de upload sem ganho nenhum para quem lê.
 */

type Ferramenta = 'caneta' | 'retangulo' | 'seta';
type Ponto = { x: number; y: number };
type Traco = { tipo: Ferramenta; cor: string; largura: number; pontos: Ponto[] };

const CORES = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111827', '#ffffff'];
const ESPESSURAS = [{ id: 1, label: 'Fina' }, { id: 2, label: 'Média' }, { id: 4, label: 'Grossa' }];
const LADO_MAX = 2000;

function desenhar(ctx: CanvasRenderingContext2D, t: Traco) {
  ctx.strokeStyle = t.cor;
  ctx.fillStyle = t.cor;
  ctx.lineWidth = t.largura;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const [a] = t.pontos;
  const b = t.pontos[t.pontos.length - 1];
  if (!a) return;
  if (t.tipo === 'caneta') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (const p of t.pontos.slice(1)) ctx.lineTo(p.x, p.y);
    if (t.pontos.length === 1) ctx.lineTo(a.x + 0.1, a.y + 0.1);
    ctx.stroke();
  } else if (t.tipo === 'retangulo') {
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else {
    // seta: linha + ponta proporcional à espessura
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const ponta = Math.max(14, t.largura * 4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - ponta * Math.cos(ang - Math.PI / 7), b.y - ponta * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(b.x - ponta * Math.cos(ang + Math.PI / 7), b.y - ponta * Math.sin(ang + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }
}

export function ImageMarkup({ file, onDone, onCancel }: { file: Blob; onDone: (blob: Blob) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [tracos, setTracos] = useState<Traco[]>([]);
  const atual = useRef<Traco | null>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>('caneta');
  const [cor, setCor] = useState(CORES[0]);
  const [espessura, setEspessura] = useState(2);
  const [salvando, setSalvando] = useState(false);

  // carrega o arquivo local (sem CORS: o canvas pode exportar depois)
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const escala = img ? Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
  const largura = img ? Math.round(img.naturalWidth * escala) : 0;
  const altura = img ? Math.round(img.naturalHeight * escala) : 0;
  // espessura relativa ao tamanho da imagem: "média" parece igual num print pequeno e numa foto grande
  const base = Math.max(2, Math.round(Math.max(largura, altura) / 300));

  const redesenhar = (extra?: Traco | null) => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !img) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const t of tracos) desenhar(ctx, t);
    if (extra) desenhar(ctx, extra);
  };
  useEffect(() => { redesenhar(); }); // a cada render: imagem, desfazer, limpar

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); setTracos((t) => t.slice(0, -1)); }
    };
    document.addEventListener('keydown', h, true);
    return () => document.removeEventListener('keydown', h, true);
  }, [onCancel]);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>): Ponto => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * largura, y: ((e.clientY - r.top) / r.height) * altura };
  };
  const inicio = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = ponto(e);
    atual.current = { tipo: ferramenta, cor, largura: base * espessura, pontos: [p] };
    redesenhar(atual.current);
  };
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = atual.current;
    if (!t) return;
    const p = ponto(e);
    t.pontos = t.tipo === 'caneta' ? [...t.pontos, p] : [t.pontos[0], p];
    redesenhar(t);
  };
  const fim = () => {
    const t = atual.current;
    atual.current = null;
    if (t) setTracos((ts) => [...ts, t]);
  };

  const concluir = () => {
    const c = canvasRef.current;
    if (!c) return;
    setSalvando(true);
    redesenhar();
    // foto continua JPEG (bem menor); print/PNG continua PNG (texto nítido)
    const tipo = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    c.toBlob((b) => { setSalvando(false); if (b) onDone(b); }, tipo, 0.9);
  };

  const botao = (on: boolean) => cn('h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors', on ? 'bg-white text-ink' : 'text-white/85 hover:bg-white/15');

  return (
    <div className="fixed inset-0 z-[80] bg-black/85 flex flex-col" role="dialog" aria-label="Marcar a imagem">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-black/60">
        <button type="button" onClick={() => setFerramenta('caneta')} className={botao(ferramenta === 'caneta')} title="Riscar à mão livre"><PenLine size={15} />Caneta</button>
        <button type="button" onClick={() => setFerramenta('retangulo')} className={botao(ferramenta === 'retangulo')} title="Destacar uma área"><Square size={15} />Retângulo</button>
        <button type="button" onClick={() => setFerramenta('seta')} className={botao(ferramenta === 'seta')} title="Apontar para algo"><ArrowUpRight size={15} />Seta</button>
        <span className="w-px h-6 bg-white/20 mx-1" />
        {CORES.map((c) => (
          <button key={c} type="button" onClick={() => setCor(c)} title="Cor" aria-label={`Cor ${c}`}
            className={cn('w-6 h-6 rounded-full border-2 transition-transform', cor === c ? 'border-white scale-110' : 'border-white/30')} style={{ background: c }} />
        ))}
        <span className="w-px h-6 bg-white/20 mx-1" />
        {ESPESSURAS.map((x) => (
          <button key={x.id} type="button" onClick={() => setEspessura(x.id)} className={botao(espessura === x.id)} title={`Traço ${x.label.toLowerCase()}`}>
            <span className="rounded-full bg-current" style={{ width: 4 + x.id * 2, height: 4 + x.id * 2 }} />{x.label}
          </button>
        ))}
        <span className="w-px h-6 bg-white/20 mx-1" />
        <button type="button" onClick={() => setTracos((t) => t.slice(0, -1))} disabled={!tracos.length} className={cn(botao(false), 'disabled:opacity-40')} title="Desfazer (Ctrl+Z)"><Undo2 size={15} />Desfazer</button>
        <button type="button" onClick={() => setTracos([])} disabled={!tracos.length} className={cn(botao(false), 'disabled:opacity-40')} title="Apagar todas as marcações"><Eraser size={15} />Limpar</button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onCancel}>Descartar</Button>
          <Button size="sm" icon={<Check size={14} />} loading={salvando} disabled={!img} onClick={concluir}>Concluir</Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 grid place-items-center p-3 overflow-auto">
        {!img ? <p className="text-white/70 text-sm">Abrindo a imagem…</p> : (
          <canvas
            ref={canvasRef}
            width={largura}
            height={altura}
            onPointerDown={inicio}
            onPointerMove={mover}
            onPointerUp={fim}
            onPointerCancel={fim}
            className="max-w-full w-auto h-auto rounded shadow-2xl cursor-crosshair touch-none bg-white"
            // cabe na tela sem distorcer: altura limitada, largura acompanha a proporção
            style={{ maxHeight: 'calc(100vh - 130px)', aspectRatio: `${largura} / ${altura}` }}
          />
        )}
      </div>
      <p className="px-3 pb-2 text-center text-[11.5px] text-white/60">Desenhe sobre a imagem para mostrar o ponto — ou clique em Concluir para usar como está. Ctrl+Z desfaz · Esc descarta.</p>
    </div>
  );
}
