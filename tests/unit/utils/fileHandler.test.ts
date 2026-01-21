import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAttachmentText } from '../../../src/utils/fileHandler';

describe('fetchAttachmentText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips unsupported extensions', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://example.com/file.bin', 'file.bin', {
      maxBytes: 1000,
    });

    expect(result.kind).toBe('skip');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns too_large when content-length exceeds limit', async () => {
    const response = new Response('ignored', {
      status: 200,
      headers: { 'content-length': '2048', 'content-type': 'text/plain' },
    });
    const mockFetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://example.com/file.txt', 'file.txt', {
      maxBytes: 512,
    });

    expect(result.kind).toBe('too_large');
  });

  it('truncates content that exceeds maxChars', async () => {
    const response = new Response('a'.repeat(200), {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const mockFetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://example.com/file.txt', 'file.txt', {
      maxBytes: 1024,
      maxChars: 50,
      truncateStrategy: 'head',
    });

    expect(result.kind).toBe('truncated');
    if (result.kind === 'truncated') {
      expect(result.text.length).toBeLessThanOrEqual(50);
    }
  });

  it('returns ok for small text files', async () => {
    const response = new Response('hello', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const mockFetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://example.com/file.md', 'file.md', {
      maxBytes: 1024,
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.text).toBe('hello');
    }
  });
});
