// src/infra/queue/statement.queue.ts
import { Queue, Worker } from 'bullmq';
import { redis } from '../cache/redis.client.js';
import { logger } from '../../utils/logger.js';

export const StatementQueue = new Queue('statement-processing', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

/** Worker deve ser inicializado com gateway injetado — ver index.ts */
export function createStatementWorker(
  processStatement: (userId: string, jid: string, msgId: string) => Promise<void>
) {
  return new Worker(
    'statement-processing',
    async (job) => {
      const { userId, jid, messageId } = job.data;
      await processStatement(userId, jid, messageId);
    },
    { connection: redis, concurrency: 3 }
  );
}
