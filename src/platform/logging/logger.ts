/**
 * @description Configures the shared structured logger and child logger factory.
 */
import pino from 'pino';
import { config } from '../config/env';

/**
 * Enable pretty transport only for local interactive development sessions.
 */
function shouldUsePrettyTransport(): boolean {
  return config.NODE_ENV === 'development' && Boolean(process.stdout.isTTY);
}

/**
 * Create the process-wide logger.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  base: {
    env: config.NODE_ENV,
    service: 'sage',
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.Authorization',
      '*.password',
      '*.token',
      '*.key',
      '*.secret',
      'config.AI_PROVIDER_API_KEY',
      'config.IMAGE_PROVIDER_API_KEY',
      'config.SERVER_PROVIDER_API_KEY',
    ],
    remove: true,
  },
  transport: shouldUsePrettyTransport()
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * Create a contextual child logger.
 *
 * @param bindings - Structured fields added to every emitted log line.
 * @returns A logger that inherits root logger configuration.
 */
export const childLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
