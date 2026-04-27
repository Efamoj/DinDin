/**
 * src/infra/cache/redis.client.ts
 *
 * Singleton do Redis usando ioredis.
 */
import Redis from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 3000),
});

redis.on('connect', () => logger.info('Redis conectado'));
redis.on('error', (err) => logger.error({ err }, 'Erro no Redis'));
redis.on('reconnecting', () => logger.warn('Redis reconectando...'));

// Alias para manter compatibilidade com código que chama redis.connect()
const originalConnect = redis.connect.bind(redis);
redis.connect = async () => {
  try {
    await originalConnect();
  } catch (err: any) {
    // ioredis lança erro se já estiver conectado — ignora
    if (!err.message?.includes('already')) throw err;
  }
  return redis as any;
};
