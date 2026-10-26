import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  // `next build` usa uma pasta própria (NEXT_DIST_DIR, ver package.json): compartilhar o
  // .next com o `next dev` corrompe o cache do servidor de desenvolvimento em execução.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // não anunciar o framework (docs/32-checklist-seguranca.md#15)
  poweredByHeader: false,
  // `next dev` aberto por um túnel (link temporário para mostrar o site): sem isso o Next recusa o acesso
  allowedDevOrigins: ['*.trycloudflare.com'],
  // build enxuto para Docker (copia só o necessário para rodar)
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
};
export default config;
