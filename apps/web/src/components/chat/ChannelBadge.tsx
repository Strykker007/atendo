'use client';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/** Cores oferecidas para o canal — as mesmas das tags, para o painel não ganhar uma segunda paleta */
export const NUMBER_PALETTE = ['#22c55e', '#0ea5e9', '#6366f1', '#f59e0b', '#ec4899', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b', '#f97316'];
const FALLBACK = '#25D366';

/** Cor do canal pronta para `style`: só aceita #RRGGBB, o resto (vazio, lixo) vira o verde do WhatsApp. */
export function channelColor(color?: string | null) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : FALLBACK;
}

/** "5511999998888@s.whatsapp.net" → "+55 11 99999-8888". Fora do padrão BR devolve só com o "+". */
export function formatPhone(phone: string) {
  // JID: "numero@s.whatsapp.net" ou "numero:device@..." — só o número interessa
  const d = phone.split('@')[0].split(':')[0].replace(/\D/g, '');
  const br = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${d}`;
}

export type Channel = { label: string; phone?: string; color?: string; status?: string };
export const channelOffline = (c: Channel) => !!c.status && c.status !== 'connected';

/**
 * Selo do canal (número de WhatsApp) da conversa: pílula com fundo suave na cor do canal, ícone
 * do WhatsApp e nome em negrito. Cor dinâmica vai por `style` — classe Tailwind não é gerada em
 * runtime. O texto mistura a cor com `--ink` para continuar legível em cor clara e no tema escuro.
 * Canal desconectado ganha ponto vermelho.
 * `phone`: `full` = telefone formatado inteiro (cabeçalho, composer), `last4` = só os finais (lista).
 */
export function ChannelBadge({ channel, phone = 'last4', className }: { channel: Channel; phone?: 'full' | 'last4' | 'none'; className?: string }) {
  const color = channelColor(channel.color);
  const offline = channelOffline(channel);
  const full = channel.phone ? formatPhone(channel.phone) : undefined;
  const title = `Canal: ${channel.label}${full ? ` (${full})` : ''}${offline ? ' — desconectado' : ''}`;
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 min-w-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold', className)}
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color: `color-mix(in srgb, ${color} 62%, var(--ink))` }}
    >
      <WhatsAppIcon className="w-3 h-3 shrink-0" style={{ color }} />
      <span className="truncate">{channel.label}</span>
      {phone === 'full' && full && <span className="font-medium opacity-85 shrink-0 tnum">• {full}</span>}
      {phone === 'last4' && channel.phone && <span className="font-medium opacity-85 shrink-0 tnum">· {formatPhone(channel.phone).slice(-4)}</span>}
      {offline && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-danger ring-2 ring-danger/25" aria-label="desconectado" />}
    </span>
  );
}

function WhatsAppIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
