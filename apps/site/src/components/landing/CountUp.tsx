'use client';
import { useEffect, useRef, useState } from 'react';
import { useAnimated } from './motion';

/**
 * Número que conta de 0 até `value` quando aparece na tela. O HTML do servidor já traz o valor
 * final (SEO, e quem não tem JS vê o número certo); a animação só roda no cliente.
 * Na página animada conta de novo toda vez que volta à tela; na estática, só na primeira vez.
 */
export function CountUp({ value, duration = 1200 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  const repeat = useAnimated();

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        // fora da tela: zera para contar de novo na volta (invisível, então não pisca)
        if (repeat) {
          cancelAnimationFrame(raf);
          setShown(0);
        }
        return;
      }
      if (entry.intersectionRatio < 0.4) return;
      if (!repeat) io.disconnect();
      cancelAnimationFrame(raf);
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        setShown(Math.round(value * (1 - (1 - t) ** 3))); // ease-out
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      // zera só dentro do primeiro quadro: se a animação não rodar (aba em segundo plano), o número final fica
      raf = requestAnimationFrame(tick);
    }, { threshold: [0, 0.4] });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration, repeat]);

  return <span ref={ref} className="tabular-nums">{shown.toLocaleString('pt-BR')}</span>;
}
