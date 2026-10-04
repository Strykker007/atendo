'use client';
import { MapPin, ExternalLink, Radio } from 'lucide-react';

/**
 * Localização como card com link para o Google Maps. Sem mapa estático de propósito: toda API
 * de mapa estático pede chave, e um iframe de terceiro carregando em cada bolha pesa a conversa.
 */
export function LocationMessage({ lat, lng, name, address, live, text }: { lat: number; lng: number; name?: string; address?: string; live?: boolean; text: string | null }) {
  const valida = Number.isFinite(lat) && Number.isFinite(lng);
  const href = `https://www.google.com/maps?q=${lat},${lng}`;
  const corpo = (
    <>
      <span className="grid place-items-center w-9 h-9 rounded-md bg-accent/15 text-accent shrink-0">{live ? <Radio size={18} /> : <MapPin size={18} />}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium truncate">{name ?? (live ? 'Localização em tempo real' : 'Localização')}</span>
        <span className="block text-[11px] opacity-70 truncate">{address ?? (valida ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Coordenadas indisponíveis')}</span>
      </span>
      {valida && <ExternalLink size={13} className="opacity-60 shrink-0" />}
    </>
  );
  const caixa = 'flex items-center gap-2 rounded-md bg-black/5 dark:bg-white/10 px-2 py-1.5 mb-1 min-w-[200px]';
  return (
    <>
      {valida ? <a href={href} target="_blank" rel="noreferrer noopener" title="Abrir no Google Maps" className={`${caixa} hover:bg-black/10 dark:hover:bg-white/15`}>{corpo}</a> : <div className={caixa}>{corpo}</div>}
      {live && <p className="text-[10.5px] opacity-60 mb-0.5">Tempo real: o painel mostra só o ponto enviado.</p>}
      {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
    </>
  );
}
