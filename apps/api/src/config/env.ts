import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carrega o .env: apps/api/.env é um symlink para o .env da raiz do monorepo.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

// Valida o ambiente na subida. Falha cedo e com mensagem clara em vez de quebrar em runtime.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_PORT: z.coerce.number().default(3001),
  API_PUBLIC_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY (32 bytes base64) é obrigatória'),
  EVOLUTION_BASE_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  META_APP_SECRET: z.string().optional().default(''),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  MEDIA_MAX_MB: z.coerce.number().default(25),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_CURRENCY: z.string().default('brl'),
  RESEND_API_KEY: z.string().optional().default(''),
  // ---- IA ----
  /** none = IA desligada (o front esconde os recursos) */
  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai']).default('none'),
  AI_API_KEY: z.string().optional().default(''),
  /**
   * Endpoint alternativo compatível com o formato do provider escolhido. Vazio = o oficial.
   * Destrava Ollama (local, grátis), Gemini, Groq, OpenRouter e afins sem mexer no código.
   */
  AI_BASE_URL: z.string().optional().default(''),
  /** vazio = modelo padrão do adapter (o mais barato) */
  AI_MODEL: z.string().optional().default(''),
  AI_MAX_TOKENS: z.coerce.number().min(32).max(4000).default(400),
  /** o contato está esperando no WhatsApp: melhor falhar rápido e cair no humano */
  AI_TIMEOUT_MS: z.coerce.number().min(1000).max(60_000).default(20_000),
  /** conversão do preço do fornecedor (USD) para o que você cobra (BRL) */
  USD_BRL_RATE: z.coerce.number().positive().default(5.5),
  /**
   * Preço por 1.000 tokens (USD) quando o modelo não está em AI_MODEL_PRICE — caso de
   * endpoint alternativo. Sem isto, um modelo desconhecido assume o mais caro da tabela
   * (proposital: nunca subestimar custo) e estouraria o teto de gasto cedo demais.
   */
  AI_PRICE_IN_PER_1K: z.coerce.number().min(0).optional(),
  AI_PRICE_OUT_PER_1K: z.coerce.number().min(0).optional(),
  LOG_LEVEL: z.enum(['debug', 'log', 'warn', 'error']).default('log'),
  /** json = uma linha JSON por evento (produção/agregador); pretty = legível no terminal */
  LOG_FORMAT: z.enum(['json', 'pretty']).default(process.env.NODE_ENV === 'production' ? 'json' : 'pretty'),
  /** vazio = Sentry desligado; o projeto roda igual */
  SENTRY_DSN: z.string().optional().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  /** versão/commit que está no ar — agrupa os erros por release no Sentry */
  APP_VERSION: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Atendo <no-reply@atendo.local>'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
