import { bootstrapApp } from './app/bootstrap';
import { toErrorWithCode } from './shared/errors/app-error';
import { logger } from './shared/logging/logger';

void bootstrapApp().catch((error) => {
  const appError = toErrorWithCode(error, 'BOOTSTRAP_FAILED');
  const rootError = appError.cause instanceof Error ? appError.cause : appError;

  logger.error(
    {
      err: rootError,
      code: appError.code,
      details: appError.details,
    },
    'Fatal startup error',
  );
  process.exit(1);
});
