import dotenv from 'dotenv';
import { isPrivateOrLocalHostname, parseEnvSafe } from './envSchema';

const isTestRuntime =
  process.env.NODE_ENV === 'test' ||
  process.env.VITEST === 'true' ||
  process.env.VITEST_WORKER_ID !== undefined;

if (!isTestRuntime) {
  dotenv.config({ quiet: true });
}

const parsed = parseEnvSafe(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
};

export type AppConfig = typeof config;
export { isPrivateOrLocalHostname };
