/**
 * Os testes são unitários: nunca sobem banco, Redis, fila ou rede.
 * Este arquivo só fornece o ambiente mínimo exigido pelo `config/env.ts`,
 * que valida as variáveis na importação.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5433/atendo_test';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.API_PUBLIC_URL ||= 'http://localhost:4000';
process.env.WEB_ORIGIN ||= 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET ||= 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'b'.repeat(32);
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.EVOLUTION_BASE_URL ||= 'http://localhost:8080';
process.env.EVOLUTION_API_KEY ||= 'chave-evolution-de-teste';
process.env.META_WEBHOOK_VERIFY_TOKEN ||= 'token-de-verificacao';
process.env.META_APP_SECRET ||= 'segredo-do-app-meta';
