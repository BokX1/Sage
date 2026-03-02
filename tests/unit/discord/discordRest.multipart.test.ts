import { beforeEach, describe, expect, it } from 'vitest';
import { stubFetch, type FetchMock } from '../../testkit/fetch';
import { discordRestRequest } from '@/core/discord/discordRest';

function makeHeaders(values: Record<string, string>): { get: (name: string) => string | null } {
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    lower.set(key.toLowerCase(), value);
  }
  return {
    get: (name: string) => lower.get(name.toLowerCase()) ?? null,
  };
}

describe('discordRestRequest multipart uploads', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = stubFetch();
    fetchMock.mockReset();
  });

  it('sends multipart/form-data with payload_json and files[n] parts', async () => {
    const fileBytes = new TextEncoder().encode('hey');

    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);

      if (url === 'https://files.example/test.txt') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: makeHeaders({
            'content-type': 'text/plain',
            'content-length': String(fileBytes.byteLength),
          }),
          arrayBuffer: async () => fileBytes.buffer,
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          headers: { get: (name: string) => string | null };
          arrayBuffer: () => Promise<ArrayBuffer>;
        };
      }

      if (url === 'https://discord.com/api/v10/channels/123/messages') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: makeHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'msg-1' }),
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          headers: { get: (name: string) => string | null };
          text: () => Promise<string>;
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await discordRestRequest({
      method: 'POST',
      path: '/channels/123/messages',
      body: { content: 'hi', attachments: [{ id: 0, filename: 'test.txt' }] },
      files: [
        {
          filename: 'test.txt',
          source: { type: 'url', url: 'https://files.example/test.txt' },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, discordInit] = fetchMock.mock.calls[1];
    expect(discordInit?.method).toBe('POST');
    expect(discordInit?.headers?.Authorization).toContain('Bot ');
    expect(discordInit?.headers?.['Content-Type']).toBeUndefined();

    const form = discordInit?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('payload_json')).toBe(
      JSON.stringify({ content: 'hi', attachments: [{ id: 0, filename: 'test.txt' }] }),
    );

    const uploaded = form.get('files[0]') as File;
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded.name).toBe('test.txt');
    const uploadedBytes = new Uint8Array(await uploaded.arrayBuffer());
    expect(uploadedBytes).toEqual(fileBytes);
  });

  it('supports multipartBodyMode="fields" and custom file field names', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: makeHeaders({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ id: 'sticker-1' }),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      headers: { get: (name: string) => string | null };
      text: () => Promise<string>;
    });

    const result = await discordRestRequest({
      method: 'POST',
      path: '/guilds/1/stickers',
      multipartBodyMode: 'fields',
      body: { name: 'Demo', description: 'demo', tags: 'tag' },
      files: [
        {
          fieldName: 'file',
          filename: 'sticker.txt',
          source: { type: 'text', text: 'abc' },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, discordInit] = fetchMock.mock.calls[0];
    const form = discordInit?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('payload_json')).toBeNull();
    expect(form.get('name')).toBe('Demo');
    expect(form.get('description')).toBe('demo');
    expect(form.get('tags')).toBe('tag');

    const uploaded = form.get('file') as File;
    expect(uploaded.name).toBe('sticker.txt');
    const uploadedBytes = new Uint8Array(await uploaded.arrayBuffer());
    expect(uploadedBytes).toEqual(new TextEncoder().encode('abc'));
  });

  it('rejects private/local URLs for file sources', async () => {
    await expect(
      discordRestRequest({
        method: 'POST',
        path: '/channels/123/messages',
        body: { content: 'hi' },
        files: [
          {
            filename: 'test.txt',
            source: { type: 'url', url: 'http://localhost/test.txt' },
          },
        ],
      }),
    ).rejects.toThrow('public');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('retries once on Discord 429 responses', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: makeHeaders({ 'content-type': 'application/json', 'retry-after': '0' }),
        text: async () =>
          JSON.stringify({
            message: 'You are being rate limited.',
            retry_after: 0,
            global: false,
          }),
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        headers: { get: (name: string) => string | null };
        text: () => Promise<string>;
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ id: 'me' }),
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        headers: { get: (name: string) => string | null };
        text: () => Promise<string>;
      });

    const result = await discordRestRequest({
      method: 'GET',
      path: '/users/@me',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
