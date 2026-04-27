/**
 * src/infra/queue/statement.queue.ts
 *
 * Fila BullMQ para processamento assíncrono de extratos PDF.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const connection = { url: env.REDIS_URL };

export const StatementQueue = new Queue('statement', { connection });

export interface StatementJobData {
  userId: string;
  jid: string;
  messageId: string;
}

/**
 * Cria o worker que processa os jobs da fila de extratos.
 * O handler recebe (userId, jid, messageId) e deve fazer o processamento real.
 */
export function createStatementWorker(
  handler: (userId: string, jid: string, messageId: string) => Promise<void>
): Worker {
  const worker = new Worker<StatementJobData>(
    'statement',
    async (job: Job<StatementJobData>) => {
      const { userId, jid, messageId } = job.data;
      logger.info({ userId, messageId }, 'Processando extrato');
      await handler(userId, jid, messageId);
    },
    {
      connection,
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Extrato processado'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Falha no processamento de extrato'));

  return worker;
}
