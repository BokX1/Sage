import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.fn();
const updateMock = vi.fn();

const encryptSecretMock = vi.fn((v: string) => `enc:v1:${v}`);
const decryptSecretMock = vi.fn((v: string) => `dec:${v}`);

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    guildSettings: {
      findUnique: findUniqueMock,
      update: updateMock,
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
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('migrates legacy plaintext values on read', async () => {
    findUniqueMock.mockResolvedValue({ pollinationsApiKey: 'sk_plain' });

    const { getGuildApiKey } = await import('../../../src/core/settings/guildSettingsRepo');
    const result = await getGuildApiKey('g2');

    expect(result).toBe('sk_plain');
    expect(encryptSecretMock).toHaveBeenCalledWith('sk_plain');
    expect(updateMock).toHaveBeenCalledWith({
      where: { guildId: 'g2' },
      data: { pollinationsApiKey: 'enc:v1:sk_plain' },
    });
  });
});
