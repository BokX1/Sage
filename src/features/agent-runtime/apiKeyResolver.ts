import { config as appConfig } from '../../platform/config/env';
import type { LLMProviderRoute } from '../../platform/llm/llm-types';
import { resolveHostCodexAccessToken } from '../auth/hostCodexAuthService';
import { getGuildApiKey } from '../settings/guildSettingsRepo';

export type TextModelLane = 'main' | 'profile' | 'summary';

export interface ResolvedTextProviderRoute extends LLMProviderRoute {
  lane: TextModelLane;
  fallbackRoute?: LLMProviderRoute;
}

const BUILTIN_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const BUILTIN_CODEX_MODEL = 'gpt-5.4';

function resolveDefaultLaneModel(lane: TextModelLane): string {
  switch (lane) {
    case 'main':
      return appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
    case 'profile':
      return appConfig.AI_PROVIDER_PROFILE_AGENT_MODEL.trim();
    case 'summary':
      return appConfig.AI_PROVIDER_SUMMARY_AGENT_MODEL.trim();
  }
}

async function resolveDefaultProviderCredential(
  guildId: string | null,
): Promise<Pick<LLMProviderRoute, 'apiKey' | 'authSource'>> {
  const guildApiKey = guildId ? await getGuildApiKey(guildId) : undefined;
  if (guildApiKey?.trim()) {
    return {
      apiKey: guildApiKey.trim(),
      authSource: 'guild_api_key',
    };
  }

  const hostApiKey = appConfig.AI_PROVIDER_API_KEY?.trim();
  if (hostApiKey) {
    return {
      apiKey: hostApiKey,
      authSource: 'host_api_key',
    };
  }

  return {};
}

export async function resolveDefaultTextProviderRoute(
  guildId: string | null,
  lane: TextModelLane,
): Promise<ResolvedTextProviderRoute> {
  const credential = await resolveDefaultProviderCredential(guildId);
  return {
    providerId: 'default',
    lane,
    baseUrl: appConfig.AI_PROVIDER_BASE_URL,
    model: resolveDefaultLaneModel(lane),
    apiKey: credential.apiKey,
    authSource: credential.authSource,
  };
}

export async function resolveTextProviderRoute(
  guildId: string | null,
  lane: TextModelLane,
): Promise<ResolvedTextProviderRoute> {
  const hostCodexToken = await resolveHostCodexAccessToken();
  const defaultRoute = await resolveDefaultTextProviderRoute(guildId, lane);

  if (hostCodexToken) {
    return {
      providerId: 'openai_codex',
      lane,
      baseUrl: BUILTIN_CODEX_BASE_URL,
      model: BUILTIN_CODEX_MODEL,
      apiKey: hostCodexToken,
      authSource: 'host_codex_auth',
      fallbackRoute: defaultRoute.apiKey
        ? {
            providerId: defaultRoute.providerId,
            baseUrl: defaultRoute.baseUrl,
            model: defaultRoute.model,
            apiKey: defaultRoute.apiKey,
            authSource: defaultRoute.authSource,
          }
        : undefined,
    };
  }

  return defaultRoute;
}

export async function resolveTextProviderApiKey(
  guildId: string | null,
  lane: TextModelLane,
): Promise<string | undefined> {
  const route = await resolveTextProviderRoute(guildId, lane);
  return route.apiKey;
}
