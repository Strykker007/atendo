import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  transpilePackages: ['@atendo/shared'],
  // `next build` usa uma pasta própria (NEXT_DIST_DIR, ver package.json): compartilhar o
  // .next com o `next dev` corrompe o cache do servidor de desenvolvimento em execução.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // build enxuto para Docker (copia só o necessário para rodar)
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
};
export default config;
