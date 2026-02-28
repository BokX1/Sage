import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config/env';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const hex = config.SECRET_ENCRYPTION_KEY.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('SECRET_ENCRYPTION_KEY must be 64 hex chars (32 bytes).');
  }

  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

export function decryptSecret(value: string): string {
  const key = getKey();
  if (!value.startsWith(PREFIX)) {
    throw new Error('Unencrypted secret value is not allowed.');
  }

  const payload = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted secret payload is invalid.');
  }

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
