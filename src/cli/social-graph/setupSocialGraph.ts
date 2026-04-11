import { setupSocialGraph } from '../../features/social-graph/setupSocialGraph';

void setupSocialGraph().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
