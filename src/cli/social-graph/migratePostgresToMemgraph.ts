import { logger } from '../../platform/logging/logger';
import { migratePostgresToMemgraph } from '../../features/social-graph/migratePostgresToMemgraph';

void migratePostgresToMemgraph()
  .then(() => {
    logger.info('Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, 'Migration script failed');
    process.exit(1);
  });
