import { prisma } from '../../platform/db/prisma-client';
import { decryptSecret, encryptSecret } from '../../platform/security/secret-crypto';

export const HOST_CODEX_PROVIDER_ID = 'openai_codex';

export interface HostProviderAuthRecord {
  provider: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  accountId: string | null;
  status: string;
  lastErrorText: string | null;
  refreshLeaseOwner: string | null;
  refreshLeaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostProviderAuthMetadata {
  provider: string;
  expiresAt: Date;
  accountId: string | null;
  status: string;
  lastErrorText: string | null;
  refreshLeaseOwner: string | null;
  refreshLeaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapHostProviderAuthRecord(
  value: Awaited<ReturnType<typeof prisma.hostProviderAuth.findUnique>>,
): HostProviderAuthRecord | null {
  if (!value) {
    return null;
  }

  return {
    provider: value.provider,
    accessToken: decryptSecret(value.encryptedAccessToken),
    refreshToken: decryptSecret(value.encryptedRefreshToken),
    expiresAt: value.expiresAt,
    accountId: value.accountId,
    status: value.status,
    lastErrorText: value.lastErrorText,
    refreshLeaseOwner: value.refreshLeaseOwner,
    refreshLeaseExpiresAt: value.refreshLeaseExpiresAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function getHostProviderAuth(provider = HOST_CODEX_PROVIDER_ID): Promise<HostProviderAuthRecord | null> {
  const value = await prisma.hostProviderAuth.findUnique({
    where: { provider },
  });

  return mapHostProviderAuthRecord(value);
}

export async function getHostProviderAuthMetadata(provider = HOST_CODEX_PROVIDER_ID): Promise<HostProviderAuthMetadata | null> {
  const value = await prisma.hostProviderAuth.findUnique({
    where: { provider },
    select: {
      provider: true,
      expiresAt: true,
      accountId: true,
      status: true,
      lastErrorText: true,
      refreshLeaseOwner: true,
      refreshLeaseExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!value) {
    return null;
  }

  return value;
}

export async function upsertHostProviderAuth(params: {
  provider?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  accountId?: string | null;
  status: string;
  lastErrorText?: string | null;
}): Promise<void> {
  const provider = params.provider ?? HOST_CODEX_PROVIDER_ID;
  const encryptedAccessToken = encryptSecret(params.accessToken);
  const encryptedRefreshToken = encryptSecret(params.refreshToken);

  await prisma.hostProviderAuth.upsert({
    where: { provider },
    create: {
      provider,
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresAt: params.expiresAt,
      accountId: params.accountId ?? null,
      status: params.status,
      lastErrorText: params.lastErrorText ?? null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
    },
    update: {
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresAt: params.expiresAt,
      accountId: params.accountId ?? null,
      status: params.status,
      lastErrorText: params.lastErrorText ?? null,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
    },
  });
}

export async function updateHostProviderAuthStatus(params: {
  provider?: string;
  status: string;
  lastErrorText?: string | null;
}): Promise<void> {
  const provider = params.provider ?? HOST_CODEX_PROVIDER_ID;
  await prisma.hostProviderAuth.updateMany({
    where: { provider },
    data: {
      status: params.status,
      lastErrorText: params.lastErrorText ?? null,
    },
  });
}

export async function clearHostProviderAuth(provider = HOST_CODEX_PROVIDER_ID): Promise<void> {
  await prisma.hostProviderAuth.deleteMany({
    where: { provider },
  });
}

export async function claimHostProviderRefreshLease(params: {
  provider?: string;
  leaseOwner: string;
  leaseTtlMs: number;
  now: Date;
}): Promise<boolean> {
  const provider = params.provider ?? HOST_CODEX_PROVIDER_ID;
  const result = await prisma.hostProviderAuth.updateMany({
    where: {
      provider,
      OR: [{ refreshLeaseExpiresAt: null }, { refreshLeaseExpiresAt: { lte: params.now } }],
    },
    data: {
      refreshLeaseOwner: params.leaseOwner,
      refreshLeaseExpiresAt: new Date(params.now.getTime() + params.leaseTtlMs),
    },
  });

  return result.count > 0;
}

export async function releaseHostProviderRefreshLease(params: {
  provider?: string;
  leaseOwner: string;
}): Promise<void> {
  const provider = params.provider ?? HOST_CODEX_PROVIDER_ID;
  await prisma.hostProviderAuth.updateMany({
    where: {
      provider,
      refreshLeaseOwner: params.leaseOwner,
    },
    data: {
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
    },
  });
}
