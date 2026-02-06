import { config } from '../../config';

const wakewordCooldowns = new Map<string, number>();
const channelWakewordHistory = new Map<string, number[]>();

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
  const cooldownMs = config.WAKEWORD_COOLDOWN_SEC * 1000;
  const maxPerMinute = config.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL;

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

export function resetInvocationCooldowns(): void {
  wakewordCooldowns.clear();
  channelWakewordHistory.clear();
}
