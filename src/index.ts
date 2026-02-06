import { bootstrapApp } from './app/bootstrap';
import { toErrorWithCode } from './shared/errors/app-error';
import { logger } from './shared/logging/logger';

void bootstrapApp().catch((error) => {
  const appError = toErrorWithCode(error, 'BOOTSTRAP_FAILED');
  logger.error(
    {
      code: appError.code,
      message: appError.message,
      cause: appError.cause,
      details: appError.details,
    },
    'Fatal startup error',
  );
  process.exit(1);
});
