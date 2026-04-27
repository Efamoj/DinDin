/**
 * src/utils/logger.ts
 *
 * Logger centralizado usando Pino.
 * Campos de PII (phone, text, rawInput, content) são mascarados automaticamente — LGPD.
 */
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'phone',
      'msg.phone',
      '*.phone',
      'text',
      'msg.text',
      '*.text',
      'rawInput',
      '*.rawInput',
      'content',
      '*.content',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
});
