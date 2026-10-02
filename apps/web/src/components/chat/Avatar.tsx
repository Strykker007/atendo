'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { avatarStyle, initialOf } from '@/lib/avatar';

/**
 * Foto do contato com queda para a inicial colorida.
 *
 * A queda não é detalhe: a URL é assinada e expira, o arquivo pode ter sumido do storage, e
 * contato que esconde a foto de desconhecidos simplesmente não tem uma. Em todos esses casos
 * o certo é a inicial, nunca o ícone de imagem quebrada.
 */
export function Avatar({ name, phone, src, className }: { name: string; phone: string; src?: string | null; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  const base = cn('w-9 h-9 rounded-lg grid place-items-center font-display font-semibold text-[14px] shrink-0 overflow-hidden', className);

  if (src && !falhou) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFalhou(true)}
        className={cn(base, 'object-cover')}
      />
    );
  }

  return <div className={base} style={avatarStyle(phone)}>{initialOf(name)}</div>;
}
