import { config } from './config/legacy-config-adapter';

const limits = new Map<string, number[]>();

export function isRateLimited(channelId: string): boolean {
  const now = Date.now();
  const windowMs = Number(config.rateLimitWindowSec || 10) * 1000;
  const max = Number(config.rateLimitMax || 5);

  const timestamps = limits.get(channelId) || [];
  const validTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (validTimestamps.length >= max) {
    return true;
  }

  validTimestamps.push(now);
  limits.set(channelId, validTimestamps);
  return false;
}
