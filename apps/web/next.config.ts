import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  transpilePackages: ['@atendo/shared'],
  // `next build` usa uma pasta própria (NEXT_DIST_DIR, ver package.json): compartilhar o
  // .next com o `next dev` corrompe o cache do servidor de desenvolvimento em execução.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // não anunciar o framework (docs/32-checklist-seguranca.md#15)
  poweredByHeader: false,
  // build enxuto para Docker (copia só o necessário para rodar)
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // escalas (docs/escalas.md): as rotas do app são em português; os nomes em inglês da especificação continuam funcionando
  async redirects() {
    return [
      // tudo que é horário mora em Escalas e plantões: o endereço antigo das escalas continua valendo
      { source: '/settings/schedules', destination: '/escalas/turnos', permanent: false },
      { source: '/configuracoes/escalas', destination: '/escalas/turnos', permanent: false },
      { source: '/schedules/approvals', destination: '/escalas/aprovacoes', permanent: false },
      { source: '/escalas', destination: '/escalas/aprovacoes', permanent: false },
    ];
  },
};
export default config;
