import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('secret crypto', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('encrypts/decrypts with a configured key', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SECRET_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const { encryptSecret, decryptSecret } = await import('../../../src/shared/security/secret-crypto');
    const encrypted = encryptSecret('sk_abc123');

    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(encrypted)).toBe('sk_abc123');
  });

  it('rejects unencrypted values', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SECRET_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const { decryptSecret } = await import('../../../src/shared/security/secret-crypto');
    expect(() => decryptSecret('sk_plaintext')).toThrow('Unencrypted secret value is not allowed.');
  });
});
