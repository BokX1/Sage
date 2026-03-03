/**
 * @module src/core/invocation/invocation-rate-limiter
 * @description Defines the invocation rate limiter module.
 */
import { config } from '../../config';

const wakewordCooldowns = new Map<string, number>();
const channelWakewordHistory = new Map<string, number[]>();

function toNonNegativeInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value as number));
}

/**
 * Runs shouldAllowInvocation.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
export function shouldAllowInvocation(params: {
  channelId: string;
  userId: string;
  kind: 'mention' | 'reply' | 'wakeword' | 'autopilot';
}): boolean {
  const { channelId, userId, kind } = params;
  if (kind !== 'wakeword') {
    return true;
  }

  const now = Date.now();
  const key = `${channelId}:${userId}`;
  const cooldownSec = toNonNegativeInt(config.WAKEWORD_COOLDOWN_SEC as number | undefined, 0);
  const cooldownMs = cooldownSec * 1000;
  const maxPerMinute = toNonNegativeInt(
    config.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL as number | undefined,
    0,
  );

  const lastWakeword = wakewordCooldowns.get(key);
  if (typeof lastWakeword === 'number' && now - lastWakeword < cooldownMs) {
    return false;
  }

  if (maxPerMinute > 0) {
    const windowMs = 60_000;
    const history = channelWakewordHistory.get(channelId) ?? [];
    const recent = history.filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maxPerMinute) {
      channelWakewordHistory.set(channelId, recent);
      return false;
    }
    recent.push(now);
    channelWakewordHistory.set(channelId, recent);
  }

  wakewordCooldowns.set(key, now);
  return true;
}

/**
 * Runs resetInvocationCooldowns.
 *
 * @returns Returns the function result.
 */
export function resetInvocationCooldowns(): void {
  wakewordCooldowns.clear();
  channelWakewordHistory.clear();
}
