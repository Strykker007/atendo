import type { Metadata } from 'next';
import { Sora, Source_Sans_3 } from 'next/font/google';
import './globals.css';
import { Tracking } from '@/components/Tracking';
import { SITE, TRACKING } from '@/lib/site';
import { themeScript } from '@/lib/theme';

const display = Sora({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' });
const body = Source_Sans_3({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: SITE.title,
  description: SITE.description,
  alternates: { canonical: '/' },
  robots: { index: true, follow: true, 'max-image-preview': 'large' },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: '/',
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    images: [{ url: '/og.webp', width: 2560, height: 496 }],
  },
  twitter: { card: 'summary_large_image' },
  verification: { google: TRACKING.googleSiteVerification },
  icons: { icon: '/icon.png', apple: '/apple-icon.png' },
};

/** Dados estruturados (Google): a empresa e as redes sociais. */
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE.name,
  url: SITE.url,
  logo: `${SITE.url}/icon.png`,
  sameAs: [SITE.social.instagram, SITE.social.facebook],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${display.variable} ${body.variable} scroll-smooth`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className="font-sans">
        {children}
        <Tracking />
      </body>
    </html>
  );
}
