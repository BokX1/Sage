/**
 * Context provider names used by runtime planning/execution.
 */
export type ContextProviderName = 'UserMemory' | 'ChannelMemory' | 'SocialGraph' | 'VoiceAnalytics';

export const CONTEXT_PROVIDER_NAMES: readonly ContextProviderName[] = [
  'UserMemory',
  'ChannelMemory',
  'SocialGraph',
  'VoiceAnalytics',
] as const;

export function isContextProviderName(value: unknown): value is ContextProviderName {
  return typeof value === 'string' && CONTEXT_PROVIDER_NAMES.includes(value as ContextProviderName);
}

export function resolveContextProviderSet(params: {
  providers?: ContextProviderName[] | null;
  fallback: ContextProviderName[];
}): ContextProviderName[] {
  const dedupe = (providers: ContextProviderName[]): ContextProviderName[] => {
    const deduped = new Set<ContextProviderName>();
    for (const provider of providers) {
      if (!isContextProviderName(provider)) continue;
      deduped.add(provider);
    }
    return [...deduped];
  };

  const fallbackProviders = dedupe(params.fallback);
  const hasProvided = !!params.providers && params.providers.length > 0;
  if (!hasProvided) {
    return fallbackProviders;
  }

  const providedProviders = dedupe(params.providers ?? []);
  if (providedProviders.length > 0) {
    return providedProviders;
  }

  // If provided set is non-empty but invalid/unknown, fail safe to fallback.
  return fallbackProviders;
}

export function withRequiredContextProviders(params: {
  providers: ContextProviderName[];
  required: ContextProviderName[];
}): ContextProviderName[] {
  const combined = [...params.required, ...params.providers];
  const deduped = new Set<ContextProviderName>();
  for (const provider of combined) {
    if (!isContextProviderName(provider)) continue;
    deduped.add(provider);
  }
  return [...deduped];
}


/**
 * Context packet: bounded context injection from a backend provider.
 */
export interface ContextPacket {
  /** Name of the provider that produced this packet */
  name: ContextProviderName;
  /** Human-readable content safe to inject into LLM context */
  content: string;
  /** Optional structured copy for trace persistence */
  json?: unknown;
  /** Estimated token count */
  tokenEstimate?: number;
  /** Optional binary attachment (e.g. charts, no longer images) */
  binary?: {
    data: Buffer;
    filename: string;
    mimetype: string;
  };
}
