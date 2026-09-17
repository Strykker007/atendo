import type { Metadata } from 'next';
import { Sora, Source_Sans_3, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const display = Sora({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' });
const body = Source_Sans_3({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500'], variable: '--font-mono' });

export const metadata: Metadata = { title: 'Atendo', description: 'Atendimento via WhatsApp' };

/** Aplica o tema antes do primeiro paint para não piscar claro→escuro. */
const themeScript = `(function(){try{var m=JSON.parse(localStorage.getItem('atendo-theme')||'{}').state?.mode||'light';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
