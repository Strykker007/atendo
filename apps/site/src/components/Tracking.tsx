'use client';
import Script from 'next/script';
import { useEffect } from 'react';
import { TRACKING } from '@/lib/site';

type Fn = (...args: unknown[]) => void;
declare global {
  interface Window {
    gtag?: Fn;
    fbq?: Fn;
    ttq?: { track: Fn };
  }
}

const WHATSAPP_HOSTS = ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'whatsapp.com'];

/**
 * Pixels de anúncio (Meta, TikTok, Google Ads) — os mesmos IDs do site antigo em WordPress.
 * Só no build de produção, para o `next dev` não sujar os dados das campanhas.
 * Clique em link do WhatsApp = conversão no Google Ads + "Contact" no TikTok e na Meta.
 */
export function Tracking() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      let host = '';
      try {
        host = new URL(a.href).hostname;
      } catch {
        return;
      }
      if (!WHATSAPP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return;
      // os CTAs abrem em nova aba, então a página continua aberta e o envio termina
      window.gtag?.('event', 'conversion', { send_to: TRACKING.googleAdsWhatsappConversion, value: 1.0, currency: 'BRL', transport_type: 'beacon' });
      window.ttq?.track('Contact');
      window.fbq?.('track', 'Contact');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  if (process.env.NODE_ENV !== 'production') return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${TRACKING.googleAdsId}`} strategy="afterInteractive" />
      <Script id="gtag-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${TRACKING.googleAdsId}');`}
      </Script>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${TRACKING.metaPixelId}');fbq('track','PageView');`}
      </Script>
      <Script id="tiktok-pixel" strategy="afterInteractive">
        {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load('${TRACKING.tiktokPixelId}');ttq.page();}(window,document,'ttq');`}
      </Script>
    </>
  );
}
