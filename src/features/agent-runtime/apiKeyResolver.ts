import { config as appConfig } from '../../platform/config/env';
import { getGuildApiKey } from '../settings/guildSettingsRepo';

export async function resolveApiKeyForRuntime(guildId: string | null): Promise<string | undefined> {
  const guildApiKey = guildId ? await getGuildApiKey(guildId) : undefined;
  const apiKey = (guildApiKey ?? appConfig.AI_PROVIDER_API_KEY)?.trim();
  return apiKey || undefined;
}
