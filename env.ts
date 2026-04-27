/**
 * src/config/env.ts
 *
 * Valida todas as variáveis de ambiente na inicialização.
 * Se qualquer variável obrigatória faltar, o processo termina imediatamente.
 */
import { z } from 'zod';

const envSchema = z.object({
  // Banco de dados
  DATABASE_URL: z.string().url('DATABASE_URL deve ser uma URL válida'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY é obrigatória'),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),

  // WhatsApp (Baileys) — sessão
  WA_SESSION_DIR: z.string().default('./sessions'),
  WA_SESSION_NAME: z.string().default('dindin'),

  // Limites e configurações do app
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),   // 1 minuto
  RATE_LIMIT_MAX_MESSAGES: z.coerce.number().default(20),    // max msgs/janela

  // Ambiente
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
