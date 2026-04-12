// src/infra/queue/audio.queue.ts
import { Queue } from 'bullmq';
import { redis } from '../cache/redis.client.js';

export const AudioQueue = new Queue('audio-transcription', {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
    removeOnComplete: true,
    removeOnFail: 20,
  },
});
