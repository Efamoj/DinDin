// src/infra/cache/redis.client.ts
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // necessário para BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (err) => logger.error({ err }, 'Erro no Redis'));
redis.on('connect', () => logger.info('Redis conectado'));
