import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  transpilePackages: ['@atendo/shared'],
  reactStrictMode: true,
  // build enxuto para Docker (copia só o necessário para rodar)
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
};
export default config;
