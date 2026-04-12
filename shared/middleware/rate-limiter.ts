/**
 * src/middleware/rate-limiter.ts
 *
 * Sliding window rate limit por número de telefone.
 * Bloqueia abuso sem prejudicar usuário legítimo.
 */

import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redis } from '../infra/cache/redis.client.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const limiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:msg',
  points: env.RATE_LIMIT_MAX_POINTS,        // mensagens permitidas
  duration: env.RATE_LIMIT_DURATION_SECONDS, // janela em segundos
  blockDuration: 60,                         // bloqueia por 60s ao estourar
});

/**
 * Retorna `true` se a mensagem deve ser processada, `false` se bloqueada.
 */
export async function checkRateLimit(phone: string): Promise<boolean> {
  try {
    await limiter.consume(phone);
    return true;
  } catch {
    logger.warn({ phone: maskPhone(phone) }, 'Rate limit atingido');
    return false;
  }
}

/** Máscara para logs: +5511999** * *9999 → +55119****9999 */
function maskPhone(phone: string): string {
  return phone.replace(/(\+\d{4})\d{4}(\d{4})/, '$1****$2');
}
