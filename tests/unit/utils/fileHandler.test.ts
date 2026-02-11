import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAttachmentText } from '../../../src/core/utils/file-handler';

describe('fetchAttachmentText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips non-discord hosts', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://example.com/file.txt', 'file.txt', {
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

    const result = await fetchAttachmentText('https://cdn.discordapp.com/file.txt', 'file.txt', {
      maxBytes: 512,
    });

    expect(result.kind).toBe('too_large');
  });

  it('truncates content that exceeds maxChars', async () => {
    const fileResponse = new Response('source file', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const tikaResponse = new Response('a'.repeat(200), { status: 200 });
    const mockFetch = vi.fn().mockResolvedValueOnce(fileResponse).mockResolvedValueOnce(tikaResponse);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://cdn.discordapp.com/file.txt', 'file.txt', {
      maxBytes: 1024,
      maxChars: 50,
      truncateStrategy: 'head',
    });

    expect(result.kind).toBe('truncated');
    if (result.kind === 'truncated') {
      expect(result.text.length).toBeLessThanOrEqual(50);
      expect(result.extractor).toBe('tika');
    }
  });

  it('returns ok for small text files', async () => {
    const fileResponse = new Response('file-bytes', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const tikaResponse = new Response('hello', { status: 200 });
    const mockFetch = vi.fn().mockResolvedValueOnce(fileResponse).mockResolvedValueOnce(tikaResponse);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://cdn.discordapp.com/file.md', 'file.md', {
      maxBytes: 1024,
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.text).toBe('hello');
      expect(result.extractor).toBe('tika');
    }
  });

  it('uses tika for non-text files', async () => {
    const fileResponse = new Response(Buffer.from('%PDF-1.5 content'), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
    const tikaResponse = new Response('Extracted from pdf', { status: 200 });
    const mockFetch = vi.fn().mockResolvedValueOnce(fileResponse).mockResolvedValueOnce(tikaResponse);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://cdn.discordapp.com/file.pdf', 'file.pdf', {
      maxBytes: 4096,
      tikaBaseUrl: 'http://127.0.0.1:9998',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.extractor).toBe('tika');
      expect(result.text).toContain('Extracted from pdf');
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips non-text files when tika parsing fails', async () => {
    const fileResponse = new Response(Buffer.from('%PDF-1.5 content'), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
    const tikaFailure = new Response('boom', { status: 500 });
    const mockFetch = vi.fn().mockResolvedValueOnce(fileResponse).mockResolvedValueOnce(tikaFailure);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://cdn.discordapp.com/file.pdf', 'file.pdf', {
      maxBytes: 4096,
      tikaBaseUrl: 'http://127.0.0.1:9998',
    });

    expect(result.kind).toBe('skip');
    if (result.kind === 'skip') {
      expect(result.reason).toContain('could not be parsed by Tika');
    }
  });

  it('falls back to native text extraction when tika fails for text files', async () => {
    const fileResponse = new Response('native fallback text', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const tikaFailure = new Response('boom', { status: 500 });
    const mockFetch = vi.fn().mockResolvedValueOnce(fileResponse).mockResolvedValueOnce(tikaFailure);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://cdn.discordapp.com/file.txt', 'file.txt', {
      maxBytes: 4096,
      tikaBaseUrl: 'http://127.0.0.1:9998',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.extractor).toBe('native');
      expect(result.text).toContain('native fallback text');
    }
  });

  it('treats non-finite maxBytes as invalid and skips fetching', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAttachmentText('https://cdn.discordapp.com/file.txt', 'file.txt', {
      maxBytes: Number.NaN,
    });

    expect(result.kind).toBe('too_large');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
