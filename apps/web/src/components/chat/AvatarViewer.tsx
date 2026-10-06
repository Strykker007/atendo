'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarStyle, initialOf } from '@/lib/avatar';
import { formatPhone } from './ChannelBadge';
import { Avatar } from './Avatar';

/** duração da saída — igual à da animação `avatar-out` em globals.css */
const SAIDA_MS = 140;

/**
 * Foto do contato ampliada, com nome e telefone embaixo.
 *
 * Vai num portal acima de tudo: abre de dentro da ficha do contato (que já é um modal), e o
 * Esc é tratado na captura para fechar só o visualizador, não a ficha junto.
 */
export function AvatarViewer({ name, phone, src, onClose }: { name: string; phone: string; src?: string | null; onClose: () => void }) {
  const [falhou, setFalhou] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const fechar = () => {
    if (saindo) return;
    setSaindo(true);
    setTimeout(onClose, SAIDA_MS);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      fechar();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  });

  const temFoto = !!src && !falhou;
  return createPortal(
    // stopPropagation: no React o evento do portal sobe para quem abriu (linha, cabeçalho, ficha)
    <div
      className={cn('fixed inset-0 z-[60] bg-black/80 grid place-items-center px-4', saindo ? 'avatar-out' : 'avatar-backdrop-in')}
      onClick={(e) => { e.stopPropagation(); fechar(); }}
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal
      aria-label={`Foto de ${name}`}
    >
      <div className={cn('relative flex flex-col items-center gap-3', saindo ? 'avatar-out' : 'avatar-in')} onClick={(e) => e.stopPropagation()}>
        <button onClick={fechar} className="absolute -top-2 -right-2 z-10 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80" title="Fechar (Esc)" aria-label="Fechar">
          <X size={18} />
        </button>
        {temFoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src!} alt={`Foto de ${name}`} onError={() => setFalhou(true)} className="w-[min(80vw,420px)] aspect-square object-cover rounded-2xl shadow-2xl" />
        ) : (
          <div className="w-[min(60vw,240px)] aspect-square rounded-2xl grid place-items-center font-display font-semibold text-[96px] shadow-2xl" style={avatarStyle(phone)}>
            {initialOf(name)}
          </div>
        )}
        <div className="text-center text-white">
          <div className="font-semibold text-base">{name}</div>
          <div className="text-sm text-white/70 tnum">{formatPhone(phone)}</div>
          {!temFoto && <div className="mt-1 text-xs text-white/50">Sem foto de perfil</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Avatar que amplia no clique. Não usar dentro de outro botão (ex.: linha da lista de conversas). */
export function ZoomableAvatar({ name, phone, src, className }: { name: string; phone: string; src?: string | null; className?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} title="Clique para ampliar" aria-label={`Ampliar foto de ${name}`} className="shrink-0 rounded-lg cursor-zoom-in hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent">
        <Avatar name={name} phone={phone} src={src} className={className} />
      </button>
      {aberto && <AvatarViewer name={name} phone={phone} src={src} onClose={() => setAberto(false)} />}
    </>
  );
}
