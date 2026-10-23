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

/**
 * Número opcional. `VAR=` no .env chega como string vazia, e `z.coerce.number()` a
 * converteria em **0** — para preço de IA isso significaria "de graça" e zeraria o custo
 * no ledger sem ninguém perceber. Vazio tem que virar "não informado".
 */
const optionalNumber = z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.coerce.number().min(0).optional());

// Valida o ambiente na subida. Falha cedo e com mensagem clara em vez de quebrar em runtime.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_PORT: z.coerce.number().default(3001),
  API_PUBLIC_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  // outras origens do painel (vertentes de marca em outro domínio), separadas por vírgula.
  // Só liberam CORS/socket: links de e-mail e de pagamento continuam no WEB_ORIGIN.
  WEB_EXTRA_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.string().url())),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY (32 bytes base64) é obrigatória'),
  EVOLUTION_BASE_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  /**
   * Evolution canário (docs/27-deploy-evolution.md#canário): imagem nova testada em poucos números
   * antes de ir para todos. Só as instâncias de EVOLUTION_CANARY_INSTANCES (nomes separados por
   * vírgula) falam com EVOLUTION_CANARY_URL; as demais seguem no EVOLUTION_BASE_URL. Mesma chave.
   * Qualquer um dos dois vazio = desligado.
   */
  EVOLUTION_CANARY_URL: z.union([z.literal(''), z.string().url()]).default(''),
  EVOLUTION_CANARY_INSTANCES: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  /**
   * Pix como cartão nativo ("Copiar chave Pix") na Evolution. Exige a imagem com o patch do nó
   * <biz> (infra/evolution): sem ele o WhatsApp entrega (`delivered`) e o celular não exibe nada.
   * Desligado = sai como texto (docs/04-providers-whatsapp.md#chave-pix-copiar-chave-pix).
   */
  EVOLUTION_PIX_BUTTON: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * Menu do fluxo com até 3 opções como botões clicáveis (resposta rápida nativa) na Evolution.
   * Mesmo requisito do Pix: imagem com o patch do <biz>. Desligado = texto com lista numerada
   * (docs/04-providers-whatsapp.md#menus-interativos-botões-e-listas). Ligar só depois de ver os
   * botões chegarem num aparelho real.
   */
  EVOLUTION_MENU_BUTTONS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
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
  /** consultas de relatório ao mesmo tempo por processo (o resto espera): protege o pool do chat */
  REPORT_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_CURRENCY: z.string().default('brl'),
  /**
   * Asaas (PIX + cartão). Com a chave preenchida, o Asaas vira o gateway dos checkouts novos;
   * o Stripe continua atendendo quem já assina por lá (docs/05).
   * Sandbox: https://api-sandbox.asaas.com/v3
   */
  ASAAS_API_KEY: z.string().optional().default(''),
  ASAAS_BASE_URL: z.string().url().default('https://api.asaas.com/v3'),
  /** token cadastrado no webhook do Asaas; chega no header `asaas-access-token` */
  ASAAS_WEBHOOK_TOKEN: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  /** Brevo (ex-Sendinblue): se preenchida, tem prioridade sobre o Resend */
  BREVO_API_KEY: z.string().optional().default(''),
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
  AI_PRICE_IN_PER_1K: optionalNumber,
  AI_PRICE_OUT_PER_1K: optionalNumber,
  /**
   * Orçamento mensal de IA da **plataforma inteira** (todos os tenants somados), em BRL.
   * Alerta por e-mail em 50/80/100% e, ao atingir, desliga a IA até virar o mês — os fluxos
   * caem no humano. 0 = sem orçamento. Use junto com o limite de gasto no console do fornecedor.
   */
  AI_PLATFORM_BUDGET_BRL: z.coerce.number().min(0).default(0),
  /** quem recebe os alertas do orçamento de IA (vírgula separa vários) */
  AI_ALERT_EMAIL: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['debug', 'log', 'warn', 'error']).default('log'),
  /** > 0: amostra memória/event loop a cada N ms no Redis (testes de carga locais; docs/30). 0 = desligado */
  DIAG_STATS_MS: z.coerce.number().int().min(0).default(0),
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
/** Origens aceitas pelo CORS da API e do socket: o painel principal + vertentes de marca. */
export const webOrigins = [env.WEB_ORIGIN, ...env.WEB_EXTRA_ORIGINS];
export type Env = typeof env;
