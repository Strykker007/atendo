import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#16a34a', hover: '#15803d', soft: '#dcfce7' },
        surface: { DEFAULT: '#ffffff', muted: '#f5f6f8', border: '#e5e7eb' },
      },
    },
  },
  plugins: [],
} satisfies Config;
