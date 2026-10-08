import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Sora, Source_Sans_3, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { brandCss, envBrandId, getBrand, resolveBrand } from '@/lib/brand';

const display = Sora({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' });
const body = Source_Sans_3({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500'], variable: '--font-mono' });

/** Marca da requisição. Com `NEXT_PUBLIC_BRAND_ID` nem lê o host (a página pode continuar estática). */
async function currentBrand() {
  const fixed = envBrandId();
  if (fixed) return getBrand(fixed);
  const h = await headers();
  return resolveBrand(h.get('x-forwarded-host') ?? h.get('host'));
}

export async function generateMetadata(): Promise<Metadata> {
  const brand = await currentBrand();
  return {
    title: brand.brandName,
    description: 'Atendimento via WhatsApp',
    icons: brand.faviconUrl ? { icon: brand.faviconUrl } : undefined,
  };
}

/** Aplica o tema antes do primeiro paint para não piscar claro→escuro. */
const themeScript = `(function(){try{var m=JSON.parse(localStorage.getItem('atendo-theme')||'{}').state?.mode||'light';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await currentBrand();
  const css = brandCss(brand);
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* cores da marca por cima dos tokens de globals.css (vazio na marca base) */}
        {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      </head>
      <body className="font-sans">
        <Providers brandId={brand.brandId}>{children}</Providers>
      </body>
    </html>
  );
}
