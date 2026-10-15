import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';

/** Demo da landing com animações ao rolar, para comparar com a `/`. Fora do Google até ser aprovada. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AnimatedDemoPage() {
  return <LandingPage animated />;
}
