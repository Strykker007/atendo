import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@atendo/shared'],
  reactStrictMode: true,
};
export default config;
