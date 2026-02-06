import pino from 'pino';
import { config } from '../config/env';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: {
    env: config.NODE_ENV,
    service: 'sage',
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.Authorization',
      '*.password',
      '*.token',
      '*.key',
      '*.secret',
      'config.LLM_API_KEY',
    ],
    remove: true,
  },
  transport:
    config.NODE_ENV === 'test'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
          },
        },
});

export const childLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
