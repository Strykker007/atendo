import type { Config } from 'tailwindcss';

/**
 * Todas as cores vêm de variáveis CSS definidas em globals.css.
 * Tema claro = direção "Semáforo" (C). Tema escuro = "Sala de controle" (B).
 * Nunca use hex direto em componente: use os tokens abaixo para funcionar nos dois temas.
 */
const v = (name: string) => `var(--${name})`;

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // superfícies
        canvas: v('bg'),
        panel: v('panel'),
        field: v('field'),
        line: v('line'),
        'line-strong': v('line-strong'),
        // texto
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        // ação (accent) — botões, links, balão de saída
        accent: { DEFAULT: v('accent'), hover: v('accent-hover'), soft: v('accent-soft'), ink: v('accent-ink') },
        // menu lateral
        side: { DEFAULT: v('side'), ink: v('side-ink'), on: v('side-on'), 'on-ink': v('side-on-ink'), line: v('side-line') },
        // estado da conversa (semáforo)
        wait: { DEFAULT: v('wait'), soft: v('wait-soft') },
        prog: { DEFAULT: v('prog'), soft: v('prog-soft') },
        done: { DEFAULT: v('done'), soft: v('done-soft') },
        // semânticas
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft'), ink: v('warn-ink') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft'), ink: v('danger-ink') },
        // chat
        chat: { bg: v('chat-bg'), in: v('bub-in'), 'in-ink': v('bub-in-ink'), out: v('bub-out'), 'out-ink': v('bub-out-ink') },
        // provider
        meta: { soft: v('meta-soft'), ink: v('meta-ink') },
        evo: { soft: v('evo-soft'), ink: v('evo-ink') },
        // aliases antigos (mantidos para não quebrar; migrar aos poucos)
        brand: { DEFAULT: v('accent'), hover: v('accent-hover'), soft: v('accent-soft') },
        surface: { DEFAULT: v('panel'), muted: v('field'), border: v('line') },
      },
    },
  },
  plugins: [],
} satisfies Config;
