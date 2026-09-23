import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // fuso fixo: a agenda converte horários e os testes precisam ser iguais em qualquer máquina/CI
    env: { TZ: 'UTC' },
    setupFiles: ['test/setup.ts'],
  },
  esbuild: { target: 'es2022' },
});
