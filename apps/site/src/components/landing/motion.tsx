'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Animações ao rolar. Ligadas por `<LandingPage animated>`; sem isso, `Reveal` vira um wrapper
 * neutro e a página fica igual à estática. O CSS (classes `.motion`, `.reveal`) está em globals.css.
 */
const MotionContext = createContext(false);

/**
 * Publica a rolagem em variáveis CSS no <html>: `--sy` (px rolados, para parallax) e `--sp`
 * (0→1, barra de progresso). Uma escuta só, com rAF: os elementos só leem a variável.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = root.scrollHeight - window.innerHeight;
      root.style.setProperty('--sy', String(window.scrollY));
      root.style.setProperty('--sp', String(max > 0 ? window.scrollY / max : 0));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
      root.style.removeProperty('--sy');
      root.style.removeProperty('--sp');
    };
  }, []);
  return <MotionContext.Provider value={true}>{children}</MotionContext.Provider>;
}

/** Barra fina no topo que enche conforme a página rola. */
export function ScrollProgress() {
  return <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 origin-left bg-accent" style={{ transform: 'scaleX(var(--sp, 0))' }} />;
}

type Variant = 'up' | 'left' | 'right' | 'zoom' | 'blur';

/** Animações ligadas? (página com `animated`) */
export const useAnimated = () => useContext(MotionContext);

/**
 * Entra na tela quando ~15% do elemento aparece e volta a se esconder quando ele sai por completo —
 * a animação repete toda vez que o elemento volta à tela, em qualquer direção. Esconder só com 0%
 * visível (e mostrar com 15%) evita que fique piscando na borda da tela.
 * `delay` (ms) escalona itens de uma lista. É um wrapper: o transform da animação não briga com o
 * hover do card que está dentro.
 */
export function Reveal({ as: Tag = 'div', variant = 'up', delay = 0, className, children }: {
  as?: 'div' | 'li' | 'span';
  variant?: Variant;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const animated = useContext(MotionContext);
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!animated || !el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio >= 0.15) setShown(true);
      else if (!entry.isIntersecting) setShown(false);
    }, { threshold: [0, 0.15] });
    io.observe(el);
    return () => io.disconnect();
  }, [animated]);

  if (!animated) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-variant={variant}
      data-shown={shown || undefined}
      className={cn('reveal', className)}
      style={{ '--d': `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
