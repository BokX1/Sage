import { logger } from '../../platform/logging/logger';
import { runGraphAnalyticsPulse } from '../../features/social-graph/graphAnalyticsPulse';

void runGraphAnalyticsPulse()
  .then(() => {
    logger.info('Social graph analytics pulse finished');
  })
  .catch((error) => {
    logger.error({ error }, 'Social graph analytics pulse failed');
    process.exitCode = 1;
  });
