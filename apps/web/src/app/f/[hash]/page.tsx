'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Clock, CircleAlert, Download, Loader2 } from 'lucide-react';
import type { PublicSecureMedia } from '@atendo/shared';
import { MarcaHorizontal } from '@/components/ui/Marca';
import { useBrand } from '@/lib/brand-context';

/**
 * Foto protegida (docs/foto-protegida.md) — o contato abre pelo link do WhatsApp. Sem login: o
 * hash é a credencial. A mídia só é pedida ao abrir (a prévia de link do WhatsApp não carrega
 * imagem nenhuma: a página não tem og:image) e vem em URL assinada de 10 minutos.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchMedia(hash: string): Promise<PublicSecureMedia> {
  const r = await fetch(`${API}/secure-media/public/${encodeURIComponent(hash)}`);
  if (r.status === 404) throw new Error('Link não encontrado. Confira o link ou peça de novo ao atendimento.');
  if (r.status === 429) throw new Error('Muitas tentativas. Aguarde um minuto e recarregue a página.');
  if (!r.ok) throw new Error('Não foi possível carregar. Tente novamente em instantes.');
  return r.json();
}

export default function FotoProtegidaPage() {
  const { hash } = useParams<{ hash: string }>();
  const q = useQuery({ queryKey: ['public-secure-media', hash], queryFn: () => fetchMedia(hash), retry: false, refetchOnWindowFocus: false });

  return (
    <main className="min-h-dvh bg-chat-bg text-ink">
      <div className="mx-auto w-full max-w-md px-4 py-6 space-y-4">
        {/* logo da empresa (Configurações → Páginas públicas); sem ela, a marca do painel */}
        <header className="flex justify-center py-2">{q.isLoading ? <div className="h-12" /> : q.data?.logoUrl ? <img src={q.data.logoUrl} alt={q.data.tenantName} className="h-12 max-w-[220px] object-contain" /> : <MarcaHorizontal className="h-8" />}</header>
        {q.isLoading && <Cartao><p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Carregando…</p></Cartao>}
        {q.error && <Cartao><p className="text-sm text-muted">{(q.error as Error).message}</p></Cartao>}
        {q.data && <Conteudo m={q.data} />}
      </div>
    </main>
  );
}

function Cartao({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-panel border border-line shadow-sm p-4 ${className}`}>{children}</section>;
}

function Conteudo({ m }: { m: PublicSecureMedia }) {
  const brand = useBrand();
  const empresa = m.tenantName || brand.brandName;
  const validade = new Date(m.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <>
      <Cartao>
        <p className="text-xs text-muted">{empresa}</p>
        <h1 className="font-display text-lg font-semibold mt-0.5">{m.contactFirstName ? `Olá, ${m.contactFirstName}!` : 'Olá!'}</h1>
        {m.agentName && <p className="text-xs text-faint mt-0.5">Enviado por {m.agentName}</p>}
        {m.status === 'active'
          ? <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-field px-2.5 py-1 text-xs text-muted"><Clock size={13} /> Disponível até {validade}</p>
          : <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs text-warn-ink"><CircleAlert size={13} /> {m.status === 'revoked' ? 'Este conteúdo foi retirado pelo atendimento.' : 'Este link expirou.'} Peça de novo pelo WhatsApp.</p>}
      </Cartao>

      {m.media && (
        <Cartao className="p-2 space-y-2">
          {m.media.mimeType.startsWith('image/') && <img src={m.media.url} alt={m.caption ?? 'Imagem'} className="w-full rounded-xl" />}
          {m.media.mimeType.startsWith('video/') && <video src={m.media.url} controls playsInline className="w-full rounded-xl" />}
          {m.media.mimeType === 'application/pdf' && (
            <a href={m.media.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full rounded-xl bg-accent hover:bg-accent-hover text-white py-3 text-sm font-semibold">
              <Download size={16} /> Abrir {m.media.fileName ?? 'documento'}
            </a>
          )}
          {m.caption && <p className="px-2 pb-1 text-sm whitespace-pre-wrap break-words">{m.caption}</p>}
        </Cartao>
      )}

      <p className="text-center text-[11px] text-faint pt-2">Página segura de {empresa}. Não compartilhe este link.</p>
    </>
  );
}
