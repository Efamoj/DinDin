import { z } from 'zod';

/**
 * Valida e exporta todas as variáveis de ambiente.
 * Falha em startup se algo estiver faltando — sem surpresas em produção.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Banco de dados
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),

  // WhatsApp / Baileys
  WA_SESSION_DIR: z.string().default('./sessions'),
  WA_SESSION_ENCRYPTION_KEY: z.string().min(32), // AES-256 → 32 bytes mínimo

  // Rate limiting (por número, por minuto)
  RATE_LIMIT_MAX_POINTS: z.coerce.number().default(20),
  RATE_LIMIT_DURATION_SECONDS: z.coerce.number().default(60),

  // Planos e pagamentos
  PIX_KEY: z.string().min(1),
  FREE_TRIAL_DAYS: z.coerce.number().default(10),
  PLAN_MONTHLY_PRICE_BRL: z.coerce.number().default(15),
  PLAN_QUARTERLY_PRICE_BRL: z.coerce.number().default(40),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌  Variáveis de ambiente inválidas:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
