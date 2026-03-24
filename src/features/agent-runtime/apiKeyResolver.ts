import { config as appConfig } from '../../platform/config/env';
import type { LLMAuthSource } from '../../platform/llm/llm-types';
import { resolvePreferredHostAuthCredential } from '../auth/hostCodexAuthService';
import { getGuildApiKey } from '../settings/guildSettingsRepo';

export interface ResolvedRuntimeCredential {
  apiKey?: string;
  authSource?: LLMAuthSource;
}

export async function resolveRuntimeCredential(guildId: string | null): Promise<ResolvedRuntimeCredential> {
  const guildApiKey = guildId ? await getGuildApiKey(guildId) : undefined;
  if (guildApiKey?.trim()) {
    return {
      apiKey: guildApiKey.trim(),
      authSource: 'guild_api_key',
    };
  }

  const hostCredential = (await resolvePreferredHostAuthCredential()) ?? {};
  if (hostCredential.apiKey?.trim()) {
    return {
      apiKey: hostCredential.apiKey.trim(),
      authSource: hostCredential.authSource,
    };
  }

  const envApiKey = appConfig.AI_PROVIDER_API_KEY?.trim();
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      authSource: 'host_api_key',
    };
  }

  return {};
}

export async function resolveApiKeyForRuntime(guildId: string | null): Promise<string | undefined> {
  const credential = await resolveRuntimeCredential(guildId);
  return credential.apiKey;
}
