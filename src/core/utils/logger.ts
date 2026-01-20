import pino from 'pino';
import { config } from '../config/env';

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

export const childLogger = (bindings: Record<string, any>) => logger.child(bindings);
