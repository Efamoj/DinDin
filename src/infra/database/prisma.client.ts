/**
 * src/infra/database/prisma.client.ts
 *
 * Singleton do Prisma Client.
 * Em desenvolvimento, reutiliza a instância para evitar "too many connections".
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

prisma.$on('error', (e) => logger.error({ err: e }, 'Prisma error'));
prisma.$on('warn', (e) => logger.warn({ msg: e.message }, 'Prisma warn'));

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
