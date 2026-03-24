import { createHash, randomBytes, randomUUID } from 'crypto';
import { config as appConfig } from '../../platform/config/env';
import { logger } from '../../platform/logging/logger';
import {
  claimHostProviderRefreshLease,
  clearHostProviderAuth,
  getHostProviderAuth,
  getHostProviderAuthMetadata,
  HOST_CODEX_PROVIDER_ID,
  releaseHostProviderRefreshLease,
  updateHostProviderAuthStatus,
  upsertHostProviderAuth,
} from '../settings/hostProviderAuthRepo';

const HOST_CODEX_REFRESH_SKEW_MS = 5 * 60_000;
const HOST_CODEX_REFRESH_LEASE_MS = 30_000;
const HOST_CODEX_REFRESH_WAIT_MS = 500;
const HOST_CODEX_REFRESH_WAIT_ATTEMPTS = 20;
const HOST_CODEX_UNREADABLE_AUTH_ERROR =
  'Stored host Codex auth could not be decrypted. Re-run `npm run auth:codex:login` on the host.';
const OPENCLAW_STYLE_PUBLIC_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENCLAW_STYLE_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENCLAW_STYLE_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENCLAW_STYLE_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OPENCLAW_STYLE_SCOPES = 'openid profile email offline_access';

type HostCodexAuthState = 'active' | 'expired' | 'refresh_failed';
type ActiveTextProvider = 'openai_codex' | 'default' | 'missing';

export type HostCodexAuthStatus =
  | {
      configured: false;
      activeTextProvider: ActiveTextProvider;
      fallbackTextProviderConfigured: boolean;
    }
  | {
      configured: true;
      provider: typeof HOST_CODEX_PROVIDER_ID;
      status: HostCodexAuthState;
      accountId: string | null;
      expiresAt: string;
      activeTextProvider: ActiveTextProvider;
      fallbackTextProviderConfigured: boolean;
      lastErrorText: string | null;
    };

export type PublicHostCodexAuthStatus =
  | {
      configured: false;
      activeTextProvider: ActiveTextProvider;
      fallbackTextProviderConfigured: boolean;
    }
  | {
      configured: true;
      provider: typeof HOST_CODEX_PROVIDER_ID;
      status: HostCodexAuthState;
      expiresAt: string;
      activeTextProvider: ActiveTextProvider;
      fallbackTextProviderConfigured: boolean;
      hasOperatorError: boolean;
    };

type SafeHostProviderAuthRead =
  | {
      record: NonNullable<Awaited<ReturnType<typeof getHostProviderAuth>>>;
      metadata: NonNullable<Awaited<ReturnType<typeof getHostProviderAuthMetadata>>>;
      readErrorText: null;
    }
  | {
      record: null;
      metadata: Awaited<ReturnType<typeof getHostProviderAuthMetadata>>;
      readErrorText: string | null;
    };

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  account_id?: string;
}

interface CodexOAuthConfig {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, delayMs);
    timeoutId.unref?.();
  });
}

function trimOptional(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function getHostApiKeyFallback(): string | undefined {
  const apiKey = appConfig.AI_PROVIDER_API_KEY?.trim();
  return apiKey || undefined;
}

function resolveActiveTextProvider(params: {
  codexConfigured: boolean;
  codexStatus?: HostCodexAuthState;
  fallbackTextProviderConfigured: boolean;
}): ActiveTextProvider {
  if (params.codexConfigured && params.codexStatus === 'active') {
    return 'openai_codex';
  }
  if (params.fallbackTextProviderConfigured) {
    return 'default';
  }
  return 'missing';
}

async function readHostProviderAuthSafe(): Promise<SafeHostProviderAuthRead> {
  const metadata = await getHostProviderAuthMetadata(HOST_CODEX_PROVIDER_ID);
  if (!metadata) {
    return {
      record: null,
      metadata: null,
      readErrorText: null,
    };
  }

  try {
    const record = await getHostProviderAuth(HOST_CODEX_PROVIDER_ID);
    if (!record) {
      return {
        record: null,
        metadata: null,
        readErrorText: null,
      };
    }
    return {
      record,
      metadata,
      readErrorText: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message }, 'Failed to read stored host Codex auth');
    await updateHostProviderAuthStatus({
      provider: HOST_CODEX_PROVIDER_ID,
      status: 'refresh_failed',
      lastErrorText: HOST_CODEX_UNREADABLE_AUTH_ERROR,
    }).catch(() => undefined);
    return {
      record: null,
      metadata: {
        ...metadata,
        status: 'refresh_failed',
        lastErrorText: HOST_CODEX_UNREADABLE_AUTH_ERROR,
      },
      readErrorText: HOST_CODEX_UNREADABLE_AUTH_ERROR,
    };
  }
}

function base64UrlEncode(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deriveAccountId(params: { responseAccountId?: string; accessToken: string }): string | null {
  const explicit = trimOptional(params.responseAccountId);
  if (explicit) {
    return explicit;
  }

  const jwt = decodeJwtPayload(params.accessToken);
  const authClaim = jwt?.['https://api.openai.com/auth'];
  if (authClaim && typeof authClaim === 'object' && !Array.isArray(authClaim)) {
    const chatgptAccountId = trimOptional(
      (authClaim as Record<string, unknown>).chatgpt_account_id as string | undefined,
    );
    if (chatgptAccountId) {
      return chatgptAccountId;
    }
  }

  const claims = ['account_id', 'sub', 'org_id'];
  for (const claim of claims) {
    const value = jwt?.[claim];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function resolveExpiresAt(response: OAuthTokenResponse): Date {
  const expiresInSec =
    typeof response.expires_in === 'number' && Number.isFinite(response.expires_in)
      ? Math.max(60, Math.floor(response.expires_in))
      : 3600;
  return new Date(Date.now() + expiresInSec * 1000);
}

function resolveCodexOAuthConfig(): CodexOAuthConfig {
  return {
    clientId: OPENCLAW_STYLE_PUBLIC_CLIENT_ID,
    authorizeUrl: trimOptional(appConfig.OPENAI_CODEX_AUTH_AUTHORIZE_URL) ?? OPENCLAW_STYLE_AUTHORIZE_URL,
    tokenUrl: trimOptional(appConfig.OPENAI_CODEX_AUTH_TOKEN_URL) ?? OPENCLAW_STYLE_TOKEN_URL,
    redirectUri: trimOptional(appConfig.OPENAI_CODEX_AUTH_REDIRECT_URI) ?? OPENCLAW_STYLE_REDIRECT_URI,
    scopes: trimOptional(appConfig.OPENAI_CODEX_AUTH_SCOPES) ?? OPENCLAW_STYLE_SCOPES,
  };
}

async function requestToken(body: URLSearchParams): Promise<OAuthTokenResponse> {
  const oauth = resolveCodexOAuthConfig();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).error_description === 'string'
        ? String((payload as Record<string, unknown>).error_description)
        : text || `HTTP ${response.status}`;
    throw new Error(`Codex OAuth token request failed: ${message}`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Codex OAuth token response was not a JSON object.');
  }

  const tokenResponse = payload as OAuthTokenResponse;
  if (!trimOptional(tokenResponse.access_token)) {
    throw new Error('Codex OAuth token response did not include an access_token.');
  }

  return tokenResponse;
}

export function createHostCodexAuthLogin(): {
  state: string;
  verifier: string;
  challenge: string;
  authorizeUrl: string;
  redirectUri: string;
} {
  const oauth = resolveCodexOAuthConfig();
  const state = base64UrlEncode(randomBytes(24));
  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = buildCodeChallenge(verifier);
  const url = new URL(oauth.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oauth.clientId);
  url.searchParams.set('redirect_uri', oauth.redirectUri);
  url.searchParams.set('scope', oauth.scopes);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'pi');

  return {
    state,
    verifier,
    challenge,
    authorizeUrl: url.toString(),
    redirectUri: oauth.redirectUri,
  };
}

export function extractAuthorizationCodeFromInput(params: {
  input: string;
  expectedState: string;
}): string {
  const trimmed = params.input.trim();
  if (!trimmed) {
    throw new Error('Auth completion input was empty.');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const code = trimOptional(url.searchParams.get('code'));
    const state = trimOptional(url.searchParams.get('state'));
    if (!code) {
      throw new Error('Redirect URL did not include a code parameter.');
    }
    if (state !== params.expectedState) {
      throw new Error('Redirect URL state did not match the login session.');
    }
    return code;
  }

  return trimmed;
}

export async function completeHostCodexAuthLogin(params: {
  code: string;
  verifier: string;
}): Promise<{ accountId: string | null; expiresAt: Date }> {
  const oauth = resolveCodexOAuthConfig();
  const response = await requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: oauth.clientId,
      code: params.code,
      code_verifier: params.verifier,
      redirect_uri: oauth.redirectUri,
    }),
  );

  const accessToken = trimOptional(response.access_token);
  const refreshToken = trimOptional(response.refresh_token);
  if (!accessToken || !refreshToken) {
    throw new Error('Codex OAuth token response did not include both access and refresh tokens.');
  }

  const accountId = deriveAccountId({
    responseAccountId: response.account_id,
    accessToken,
  });
  const expiresAt = resolveExpiresAt(response);

  await upsertHostProviderAuth({
    provider: HOST_CODEX_PROVIDER_ID,
    accessToken,
    refreshToken,
    expiresAt,
    accountId,
    status: 'active',
    lastErrorText: null,
  });

  return { accountId, expiresAt };
}

async function refreshHostCodexAuthOnce(): Promise<string | undefined> {
  const current = await readHostProviderAuthSafe();
  if (!current.record) {
    return undefined;
  }
  const currentRecord = current.record;

  const oauth = resolveCodexOAuthConfig();
  const refreshToken = trimOptional(currentRecord.refreshToken);
  if (!refreshToken) {
    await updateHostProviderAuthStatus({
      provider: HOST_CODEX_PROVIDER_ID,
      status: 'expired',
      lastErrorText: 'Stored host Codex auth is missing a refresh token.',
    });
    return undefined;
  }

  const response = await requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: oauth.clientId,
      refresh_token: refreshToken,
    }),
  );

  const accessToken = trimOptional(response.access_token);
  if (!accessToken) {
    throw new Error('Codex OAuth refresh response did not include an access token.');
  }

  const nextRefreshToken = trimOptional(response.refresh_token) ?? currentRecord.refreshToken;
  const accountId = deriveAccountId({
    responseAccountId: response.account_id,
    accessToken,
  }) ?? currentRecord.accountId;
  const expiresAt = resolveExpiresAt(response);

  await upsertHostProviderAuth({
    provider: HOST_CODEX_PROVIDER_ID,
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt,
    accountId,
    status: 'active',
    lastErrorText: null,
  });

  return accessToken;
}

async function waitForRefreshResult(): Promise<string | undefined> {
  for (let attempt = 0; attempt < HOST_CODEX_REFRESH_WAIT_ATTEMPTS; attempt += 1) {
    await sleep(HOST_CODEX_REFRESH_WAIT_MS);
    const current = await getHostProviderAuth(HOST_CODEX_PROVIDER_ID).catch(() => null);
    if (!current) {
      return undefined;
    }
    if (current.expiresAt.getTime() > Date.now() + HOST_CODEX_REFRESH_SKEW_MS && current.status === 'active') {
      return current.accessToken;
    }
    if (
      !current.refreshLeaseOwner
      || (current.refreshLeaseExpiresAt && current.refreshLeaseExpiresAt.getTime() <= Date.now())
    ) {
      return undefined;
    }
  }

  return undefined;
}

export async function resolveHostCodexAccessToken(): Promise<string | undefined> {
  const current = await readHostProviderAuthSafe();
  if (!current.record) {
    return undefined;
  }
  const currentRecord = current.record;

  if (
    currentRecord.expiresAt.getTime() > Date.now() + HOST_CODEX_REFRESH_SKEW_MS
    && currentRecord.status === 'active'
  ) {
    return currentRecord.accessToken;
  }

  const leaseOwner = `sage-host-codex-refresh:${process.pid}:${randomUUID()}`;
  const claimed = await claimHostProviderRefreshLease({
    provider: HOST_CODEX_PROVIDER_ID,
    leaseOwner,
    leaseTtlMs: HOST_CODEX_REFRESH_LEASE_MS,
    now: new Date(),
  });

  if (!claimed) {
    return waitForRefreshResult();
  }

  try {
    return await refreshHostCodexAuthOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message }, 'Failed to refresh host Codex auth');
    await updateHostProviderAuthStatus({
      provider: HOST_CODEX_PROVIDER_ID,
      status: 'refresh_failed',
      lastErrorText: message,
    });
    return undefined;
  } finally {
    await releaseHostProviderRefreshLease({
      provider: HOST_CODEX_PROVIDER_ID,
      leaseOwner,
    });
  }
}

export async function handleHostCodexProviderAuthFailure(params: {
  errorText: string;
}): Promise<void> {
  await updateHostProviderAuthStatus({
    provider: HOST_CODEX_PROVIDER_ID,
    status: 'refresh_failed',
    lastErrorText: `Provider rejected the stored host Codex access token: ${params.errorText}`,
  }).catch(() => undefined);
}

export async function getHostCodexAuthStatus(): Promise<HostCodexAuthStatus> {
  const current = await readHostProviderAuthSafe();
  const fallbackTextProviderConfigured = !!getHostApiKeyFallback();

  if (!current.record && !current.metadata) {
    return {
      configured: false,
      activeTextProvider: resolveActiveTextProvider({
        codexConfigured: false,
        fallbackTextProviderConfigured,
      }),
      fallbackTextProviderConfigured,
    };
  }

  const currentState = current.record ?? current.metadata;
  if (!currentState) {
    return {
      configured: false,
      activeTextProvider: resolveActiveTextProvider({
        codexConfigured: false,
        fallbackTextProviderConfigured,
      }),
      fallbackTextProviderConfigured,
    };
  }

  const now = Date.now();
  const expired = currentState.expiresAt.getTime() <= now;
  const status: HostCodexAuthState =
    currentState.status === 'refresh_failed'
      ? 'refresh_failed'
      : expired
        ? 'expired'
        : 'active';

  return {
    configured: true,
    provider: HOST_CODEX_PROVIDER_ID,
    status,
    accountId: currentState.accountId,
    expiresAt: currentState.expiresAt.toISOString(),
    activeTextProvider: resolveActiveTextProvider({
      codexConfigured: true,
      codexStatus: status,
      fallbackTextProviderConfigured,
    }),
    fallbackTextProviderConfigured,
    lastErrorText: current.readErrorText ?? currentState.lastErrorText,
  };
}

export function toPublicHostCodexAuthStatus(status: HostCodexAuthStatus): PublicHostCodexAuthStatus {
  if (!status.configured) {
    return status;
  }

  return {
    configured: true,
    provider: status.provider,
    status: status.status,
    expiresAt: status.expiresAt,
    activeTextProvider: status.activeTextProvider,
    fallbackTextProviderConfigured: status.fallbackTextProviderConfigured,
    hasOperatorError: !!status.lastErrorText,
  };
}

export async function getPublicHostCodexAuthStatus(): Promise<PublicHostCodexAuthStatus> {
  return toPublicHostCodexAuthStatus(await getHostCodexAuthStatus());
}

export async function clearHostCodexAuthRecord(): Promise<void> {
  await clearHostProviderAuth(HOST_CODEX_PROVIDER_ID);
}
