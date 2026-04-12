// src/utils/logger.ts
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  redact: {
    // Jamais logar esses campos — LGPD compliance
    paths: ['phone', 'msg.phone', '*.phone', 'text', 'msg.text', '*.rawInput'],
    censor: '[REDACTED]',
  },
});
