import { describe, expect, it, vi } from 'vitest';
import {
  buildImageGenUrl,
  fetchWithTimeout,
  getImageExtensionFromContentType,
} from '../../../src/core/orchestration/experts/imageGenExpert';

describe('buildImageGenUrl', () => {
  it('builds a generate URL with encoded prompt', () => {
    const url = buildImageGenUrl({
      baseUrl: 'https://gen.pollinations.ai',
      prompt: 'A cat & dog',
      model: 'klein-large',
      seed: 42,
    });

    expect(url).toContain('/image/A%20cat%20%26%20dog');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('model')).toBe('klein-large');
    expect(parsed.searchParams.get('nologo')).toBe('true');
    expect(parsed.searchParams.get('seed')).toBe('42');
    expect(parsed.searchParams.get('image')).toBeNull();
  });

  it('adds edit image parameter when attachment is present', () => {
    const url = buildImageGenUrl({
      baseUrl: 'https://gen.pollinations.ai',
      prompt: 'Add a sunset',
      model: 'klein-large',
      seed: 7,
      attachmentUrl: 'https://example.com/images/source.png',
    });

    expect(url).toContain('image=https%3A%2F%2Fexample.com%2Fimages%2Fsource.png');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('image')).toBe('https://example.com/images/source.png');
  });
});

describe('getImageExtensionFromContentType', () => {
  it('maps content types to extensions', () => {
    expect(getImageExtensionFromContentType('image/jpeg')).toBe('jpg');
    expect(getImageExtensionFromContentType('image/png; charset=binary')).toBe('png');
    expect(getImageExtensionFromContentType('image/webp')).toBe('webp');
  });

  it('returns null for unknown content types', () => {
    expect(getImageExtensionFromContentType('application/json')).toBeNull();
    expect(getImageExtensionFromContentType(undefined)).toBeNull();
  });
});

describe('fetchWithTimeout', () => {
  it('aborts the request when the timeout is reached', async () => {
    vi.useFakeTimers();

    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          (error as Error & { name: string }).name = 'AbortError';
          reject(error);
        });
      });
    });

    const promise = fetchWithTimeout('https://example.com', 5, fetcher as typeof fetch);
    const expectation = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(5);
    await expectation;
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
