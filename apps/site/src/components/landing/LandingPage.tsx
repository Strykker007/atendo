import { cn } from '@/lib/utils';
import { Demo } from './Demo';
import { Extras } from './Extras';
import { Faq } from './Faq';
import { Features } from './Features';
import { Hero } from './Hero';
import { LandingFooter } from './LandingFooter';
import { LandingHeader } from './LandingHeader';
import { MotionProvider, ScrollProgress } from './motion';
import { Pains } from './Pains';
import { Pricing } from './Pricing';
import { SocialProof } from './SocialProof';

/**
 * Landing page pública. Textos em `content.ts`; ver docs/21-site.md.
 * `animated`: animações ao rolar (motion.tsx) — hoje só na rota /animado, para comparar.
 * Funil: dor → solução → prova social → oferta; todos os CTAs levam a #planos, e de lá ao WhatsApp.
 */
export function LandingPage({ animated = false }: { animated?: boolean }) {
  const page = (
    <div className={cn('min-h-screen overflow-x-clip bg-canvas text-ink', animated && 'motion')}>
      {animated && (
        <>
          <ScrollProgress />
          {/* sem JS os elementos ficariam invisíveis esperando a animação: mostra tudo */}
          <noscript>
            <style>{'.motion .reveal{opacity:1!important;transform:none!important;filter:none!important}'}</style>
          </noscript>
        </>
      )}
      <LandingHeader />
      <main>
        <Hero />
        <Demo />
        <Pains />
        <Features />
        <SocialProof />
        <Extras />
        <Pricing />
        <Faq />
      </main>
      <LandingFooter />
    </div>
  );
  return animated ? <MotionProvider>{page}</MotionProvider> : page;
}
