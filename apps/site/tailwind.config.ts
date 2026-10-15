import type { Config } from 'tailwindcss';

/**
 * Mesmos tokens do painel (apps/web/tailwind.config.ts) — as cores vêm de variáveis CSS em
 * globals.css, então o site e o painel ficam com a mesma cara nos dois temas.
 * Nunca use hex direto em componente: use os tokens abaixo.
 */
const v = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-body)', 'sans-serif'],
      },
      colors: {
        canvas: v('bg'),
        panel: v('panel'),
        field: v('field'),
        line: v('line'),
        'line-strong': v('line-strong'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        accent: { DEFAULT: v('accent'), hover: v('accent-hover'), soft: v('accent-soft'), ink: v('accent-ink') },
        wait: { DEFAULT: v('wait'), soft: v('wait-soft') },
        prog: { DEFAULT: v('prog'), soft: v('prog-soft') },
        done: { DEFAULT: v('done'), soft: v('done-soft') },
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft'), ink: v('warn-ink') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft'), ink: v('danger-ink') },
        chat: { bg: v('chat-bg'), in: v('bub-in'), 'in-ink': v('bub-in-ink'), out: v('bub-out'), 'out-ink': v('bub-out-ink'), 'tick-read': v('tick-read') },
      },
    },
  },
  plugins: [],
} satisfies Config;
