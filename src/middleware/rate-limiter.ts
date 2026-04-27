/**
 * src/middleware/rate-limiter.ts
 *
 * Sliding window rate limiter por número de telefone usando Redis.
 * Bloqueia usuários que enviarem mensagens acima do limite configurado.
 */
import { redis } from '../infra/cache/redis.client.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Verifica se o número de telefone está dentro do limite de mensagens.
 * @returns true se permitido, false se bloqueado
 */
export async function checkRateLimit(phone: string): Promise<boolean> {
  const key = `rate:${phone}`;
  const now = Date.now();
  const windowStart = now - env.RATE_LIMIT_WINDOW_MS;

  try {
    const pipeline = redis.pipeline();

    // Remove entradas antigas fora da janela
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Conta entradas na janela atual
    pipeline.zcard(key);

    // Adiciona a requisição atual
    pipeline.zadd(key, now, `${now}-${Math.random()}`);

    // Define TTL da chave (2x a janela para segurança)
    pipeline.pexpire(key, env.RATE_LIMIT_WINDOW_MS * 2);

    const results = await pipeline.exec();
    const count = (results?.[1]?.[1] as number) ?? 0;

    if (count >= env.RATE_LIMIT_MAX_MESSAGES) {
      logger.warn({ phone: '[REDACTED]' }, `Rate limit atingido: ${count} msgs na janela`);
      return false;
    }

    return true;
  } catch (err) {
    // Em caso de falha no Redis, permite a mensagem (fail open)
    logger.error({ err }, 'Erro no rate limiter — permitindo mensagem');
    return true;
  }
}
