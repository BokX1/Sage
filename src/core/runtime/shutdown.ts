import type { Client } from 'discord.js';
import { logger } from '../utils/logger';
import { prisma } from '../db/prisma-client';
import { stopChannelSummaryScheduler } from '../summary/channelSummaryScheduler';

type ShutdownSignal = NodeJS.Signals | 'UNHANDLED_REJECTION' | 'UNCAUGHT_EXCEPTION';

interface RegisterShutdownHooksParams {
  client: Client;
}

let shutdownInFlight: Promise<void> | null = null;

async function runShutdown(signal: ShutdownSignal, client: Client): Promise<void> {
  if (shutdownInFlight) {
    return shutdownInFlight;
  }

  shutdownInFlight = (async () => {
    logger.info({ signal }, 'Shutdown initiated');

    stopChannelSummaryScheduler();

    try {
      await client.destroy();
    } catch (error) {
      logger.warn({ error }, 'Discord client destroy failed during shutdown');
    }

    try {
      await prisma.$disconnect();
    } catch (error) {
      logger.warn({ error }, 'Prisma disconnect failed during shutdown');
    }

    logger.info({ signal }, 'Shutdown complete');
  })();

  return shutdownInFlight;
}

export function registerShutdownHooks({ client }: RegisterShutdownHooksParams): void {
  const handleSignal = (signal: NodeJS.Signals) => {
    void runShutdown(signal, client)
      .catch((error) => {
        logger.error({ error, signal }, 'Fatal shutdown failure');
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ error: reason }, 'Unhandled promise rejection');
    void runShutdown('UNHANDLED_REJECTION', client)
      .catch((error) => {
        logger.error({ error }, 'Fatal shutdown failure after unhandled rejection');
      })
      .finally(() => {
        process.exit(1);
      });
  });

  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught exception');
    void runShutdown('UNCAUGHT_EXCEPTION', client)
      .catch((shutdownError) => {
        logger.error({ error: shutdownError }, 'Fatal shutdown failure after uncaught exception');
      })
      .finally(() => {
        process.exit(1);
      });
  });
}

