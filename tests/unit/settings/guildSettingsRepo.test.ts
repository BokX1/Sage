import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.fn();
const upsertMock = vi.fn();

const encryptSecretMock = vi.fn((v: string) => `enc:v1:${v}`);
const decryptSecretMock = vi.fn((v: string) => {
  if (!v.startsWith('enc:v1:')) {
    throw new Error('Unencrypted secret value is not allowed.');
  }
  return `dec:${v}`;
});

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    guildSettings: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
    },
  },
}));

vi.mock('../../../src/shared/security/secret-crypto', () => ({
  encryptSecret: encryptSecretMock,
  decryptSecret: decryptSecretMock,
}));

describe('guildSettingsRepo.getGuildApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decrypts encrypted values', async () => {
    findUniqueMock.mockResolvedValue({ pollinationsApiKey: 'enc:v1:abc' });

    const { getGuildApiKey } = await import('../../../src/core/settings/guildSettingsRepo');
    const result = await getGuildApiKey('g1');

    expect(result).toBe('dec:enc:v1:abc');
    expect(decryptSecretMock).toHaveBeenCalledWith('enc:v1:abc');
  });

  it('throws on unencrypted plaintext values', async () => {
    findUniqueMock.mockResolvedValue({ pollinationsApiKey: 'sk_plain' });

    const { getGuildApiKey } = await import('../../../src/core/settings/guildSettingsRepo');
    await expect(getGuildApiKey('g2')).rejects.toThrow('Unencrypted secret value is not allowed.');
  });
});

describe('guildSettingsRepo.upsertGuildApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encrypts and stores key values', async () => {
    upsertMock.mockResolvedValue({});

    const { upsertGuildApiKey } = await import('../../../src/core/settings/guildSettingsRepo');
    await upsertGuildApiKey('g1', 'sk_secret');

    expect(encryptSecretMock).toHaveBeenCalledWith('sk_secret');
    expect(encryptSecretMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { guildId: 'g1' },
      create: { guildId: 'g1', pollinationsApiKey: 'enc:v1:sk_secret' },
      update: { pollinationsApiKey: 'enc:v1:sk_secret' },
    });
  });

  it('reuses one encrypted value for both create and update paths', async () => {
    encryptSecretMock.mockImplementationOnce(() => 'enc:v1:unique');
    upsertMock.mockResolvedValue({});

    const { upsertGuildApiKey } = await import('../../../src/core/settings/guildSettingsRepo');
    await upsertGuildApiKey('g1', 'sk_secret');

    expect(encryptSecretMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { guildId: 'g1' },
      create: { guildId: 'g1', pollinationsApiKey: 'enc:v1:unique' },
      update: { pollinationsApiKey: 'enc:v1:unique' },
    });
  });

  it('stores null when clearing key', async () => {
    upsertMock.mockResolvedValue({});

    const { upsertGuildApiKey } = await import('../../../src/core/settings/guildSettingsRepo');
    await upsertGuildApiKey('g1', null);

    expect(upsertMock).toHaveBeenCalledWith({
      where: { guildId: 'g1' },
      create: { guildId: 'g1', pollinationsApiKey: null },
      update: { pollinationsApiKey: null },
    });
  });
});
