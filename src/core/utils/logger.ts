import pino from 'pino';
import { config } from '../config/env';

/**
 * Provide the shared application logger.
 *
 * Details: redacts sensitive fields and pretty-prints in non-test environments.
 *
 * Side effects: writes structured logs to stdout.
 * Error behavior: none.
 */
export const logger = pino({
    level: config.logLevel || 'info',
    base: {
        env: process.env.NODE_ENV,
    },
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.Authorization',
            '*.password',
            '*.token',
            '*.key',
        ],
        remove: true,
    },
    transport:
        process.env.NODE_ENV === 'test'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    ignore: 'pid,hostname',
                },
            },
});

/**
 * Create a child logger with contextual bindings.
 *
 * Details: binds metadata to all log entries emitted by the child.
 *
 * Side effects: none.
 * Error behavior: none.
 *
 * @param bindings - Key/value metadata to attach to log entries.
 * @returns Child logger instance.
 */
export const childLogger = (bindings: Record<string, any>) => logger.child(bindings);
