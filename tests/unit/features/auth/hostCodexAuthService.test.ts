import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  AI_PROVIDER_API_KEY: 'env-fallback-key',
  AI_PROVIDER_BASE_URL: 'https://api.openai.example/v1',
  OPENAI_CODEX_AUTH_CLIENT_ID: 'client_test_123',
  OPENAI_CODEX_AUTH_AUTHORIZE_URL: 'https://auth.openai.com/oauth/authorize',
  OPENAI_CODEX_AUTH_TOKEN_URL: 'https://auth.openai.com/oauth/token',
  OPENAI_CODEX_AUTH_REDIRECT_URI: 'http://127.0.0.1:1455/auth/callback',
  OPENAI_CODEX_AUTH_SCOPES: 'openid offline_access profile email',
}));

const repoMocks = vi.hoisted(() => ({
  getHostProviderAuth: vi.fn(),
  getHostProviderAuthMetadata: vi.fn(),
  upsertHostProviderAuth: vi.fn(),
  updateHostProviderAuthStatus: vi.fn(),
  clearHostProviderAuth: vi.fn(),
  claimHostProviderRefreshLease: vi.fn(),
  releaseHostProviderRefreshLease: vi.fn(),
}));

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

vi.mock('@/features/settings/hostProviderAuthRepo', () => ({
  HOST_CODEX_PROVIDER_ID: 'openai_codex',
  getHostProviderAuth: repoMocks.getHostProviderAuth,
  getHostProviderAuthMetadata: repoMocks.getHostProviderAuthMetadata,
  upsertHostProviderAuth: repoMocks.upsertHostProviderAuth,
  updateHostProviderAuthStatus: repoMocks.updateHostProviderAuthStatus,
  clearHostProviderAuth: repoMocks.clearHostProviderAuth,
  claimHostProviderRefreshLease: repoMocks.claimHostProviderRefreshLease,
  releaseHostProviderRefreshLease: repoMocks.releaseHostProviderRefreshLease,
}));

import {
  clearHostCodexAuthRecord,
  completeHostCodexAuthLogin,
  createHostCodexAuthLogin,
  extractAuthorizationCodeFromInput,
  getPublicHostCodexAuthStatus,
  handleHostCodexProviderAuthFailure,
  getHostCodexAuthStatus,
  resolveHostCodexAccessToken,
  resolvePreferredHostAuthCredential,
  resolvePreferredHostAuthToken,
} from '@/features/auth/hostCodexAuthService';

describe('hostCodexAuthService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockConfig.AI_PROVIDER_API_KEY = 'env-fallback-key';
    mockConfig.AI_PROVIDER_BASE_URL = 'https://api.openai.example/v1';
    mockConfig.OPENAI_CODEX_AUTH_CLIENT_ID = 'client_test_123';
    mockConfig.OPENAI_CODEX_AUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
    mockConfig.OPENAI_CODEX_AUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
    mockConfig.OPENAI_CODEX_AUTH_REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';
    mockConfig.OPENAI_CODEX_AUTH_SCOPES = 'openid offline_access profile email';

    repoMocks.getHostProviderAuth.mockReset().mockResolvedValue(null);
    repoMocks.getHostProviderAuthMetadata.mockReset().mockResolvedValue(null);
    repoMocks.upsertHostProviderAuth.mockReset().mockResolvedValue(undefined);
    repoMocks.updateHostProviderAuthStatus.mockReset().mockResolvedValue(undefined);
    repoMocks.clearHostProviderAuth.mockReset().mockResolvedValue(undefined);
    repoMocks.claimHostProviderRefreshLease.mockReset().mockResolvedValue(true);
    repoMocks.releaseHostProviderRefreshLease.mockReset().mockResolvedValue(undefined);
    mockFetch.mockReset();
  });

  it('builds a PKCE authorize URL for host login', () => {
    const login = createHostCodexAuthLogin();
    const url = new URL(login.authorizeUrl);

    expect(login.state).toBeTruthy();
    expect(login.verifier).toBeTruthy();
    expect(login.challenge).toBeTruthy();
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client_test_123');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback');
    expect(url.searchParams.get('scope')).toBe('openid offline_access profile email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('extracts the authorization code from a pasted redirect URL', () => {
    const code = extractAuthorizationCodeFromInput({
      input: 'http://127.0.0.1:1455/auth/callback?code=abc123&state=state-1',
      expectedState: 'state-1',
    });

    expect(code).toBe('abc123');
  });

  it('stores encrypted host auth on successful login completion', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token:
            'header.eyJzdWIiOiJhY2N0X3N0b3JlZCJ9.signature',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
    });

    const result = await completeHostCodexAuthLogin({
      code: 'auth-code-1',
      verifier: 'verifier-1',
    });

    expect(repoMocks.upsertHostProviderAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'header.eyJzdWIiOiJhY2N0X3N0b3JlZCJ9.signature',
        refreshToken: 'refresh-1',
        status: 'active',
        accountId: 'acct_stored',
      }),
    );
    expect(result.accountId).toBe('acct_stored');
  });

  it('prefers active host Codex auth over the host API key fallback', async () => {
    repoMocks.getHostProviderAuthMetadata.mockResolvedValueOnce({
      provider: 'openai_codex',
      expiresAt: new Date(Date.now() + 60 * 60_000),
      accountId: 'acct_1',
      status: 'active',
      lastErrorText: null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repoMocks.getHostProviderAuth.mockResolvedValueOnce({
      provider: 'openai_codex',
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresAt: new Date(Date.now() + 60 * 60_000),
      accountId: 'acct_1',
      status: 'active',
      lastErrorText: null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(resolvePreferredHostAuthToken()).resolves.toBe('codex-access-token');
  });

  it('refreshes expired host auth and returns the new access token', async () => {
    repoMocks.getHostProviderAuthMetadata.mockResolvedValue({
      provider: 'openai_codex',
      expiresAt: new Date(Date.now() - 1_000),
      accountId: 'acct_1',
      status: 'active',
      lastErrorText: null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repoMocks.getHostProviderAuth.mockResolvedValue({
      provider: 'openai_codex',
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() - 1_000),
      accountId: 'acct_1',
      status: 'active',
      lastErrorText: null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: 'fresh-token',
          refresh_token: 'fresh-refresh-token',
          expires_in: 1800,
          account_id: 'acct_1',
        }),
    });

    await expect(resolveHostCodexAccessToken()).resolves.toBe('fresh-token');
    expect(repoMocks.upsertHostProviderAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'fresh-token',
        refreshToken: 'fresh-refresh-token',
        status: 'active',
      }),
    );
    expect(repoMocks.releaseHostProviderRefreshLease).toHaveBeenCalled();
  });

  it('reports a compatibility warning for likely incompatible base URLs', async () => {
    mockConfig.AI_PROVIDER_BASE_URL = 'https://text.pollinations.ai/openai';
    repoMocks.getHostProviderAuthMetadata.mockResolvedValueOnce({
      provider: 'openai_codex',
      expiresAt: new Date(Date.now() + 60 * 60_000),
      accountId: 'acct_warn',
      status: 'active',
      lastErrorText: null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repoMocks.getHostProviderAuth.mockResolvedValueOnce({
      provider: 'openai_codex',
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresAt: new Date(Date.now() + 60 * 60_000),
      accountId: 'acct_warn',
      status: 'active',
      lastErrorText: null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(getHostCodexAuthStatus()).resolves.toEqual(
      expect.objectContaining({
        configured: true,
        compatibility: 'likely_incompatible',
        warning: expect.stringContaining('does not look like a Codex OAuth-compatible endpoint'),
      }),
    );
  });

  it('clears the shared host auth record', async () => {
    await clearHostCodexAuthRecord();
    expect(repoMocks.clearHostProviderAuth).toHaveBeenCalledWith('openai_codex');
  });

  it('marks rejected host Codex auth unhealthy and falls back to the host API key', async () => {
    const recovered = await handleHostCodexProviderAuthFailure({
      errorText: 'AI provider auth error: unauthorized',
    });

    expect(repoMocks.updateHostProviderAuthStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai_codex',
        status: 'refresh_failed',
      }),
    );
    expect(recovered).toEqual({
      apiKey: 'env-fallback-key',
      authSource: 'host_api_key',
    });
  });

  it('degrades unreadable stored host auth to fallback status instead of throwing', async () => {
    repoMocks.getHostProviderAuthMetadata.mockResolvedValue({
      provider: 'openai_codex',
      expiresAt: new Date(Date.now() + 60 * 60_000),
      accountId: 'acct_hidden',
      status: 'active',
      lastErrorText: null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repoMocks.getHostProviderAuth.mockRejectedValue(new Error('bad decrypt'));

    await expect(resolvePreferredHostAuthCredential()).resolves.toEqual({
      apiKey: 'env-fallback-key',
      authSource: 'host_api_key',
    });
    await expect(getHostCodexAuthStatus()).resolves.toEqual(
      expect.objectContaining({
        configured: true,
        status: 'refresh_failed',
        lastErrorText: expect.stringContaining('could not be decrypted'),
      }),
    );
  });

  it('redacts host-wide account and error details from the public status surface', async () => {
    repoMocks.getHostProviderAuthMetadata.mockResolvedValueOnce({
      provider: 'openai_codex',
      expiresAt: new Date(Date.now() + 60 * 60_000),
      accountId: 'acct_hidden',
      status: 'refresh_failed',
      lastErrorText: 'sensitive host error',
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repoMocks.getHostProviderAuth.mockResolvedValueOnce({
      provider: 'openai_codex',
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresAt: new Date(Date.now() + 60 * 60_000),
      accountId: 'acct_hidden',
      status: 'refresh_failed',
      lastErrorText: 'sensitive host error',
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(getPublicHostCodexAuthStatus()).resolves.toEqual(
      expect.objectContaining({
        configured: true,
        status: 'refresh_failed',
        hasOperatorError: true,
      }),
    );
  });
});
