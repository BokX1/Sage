/**
 * @module tests/unit/utils/dnsLookup.test
 * @description Verifies bounded DNS lookup behavior for utility consumers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as dns from 'node:dns/promises';
import { lookupAll } from '../../../src/core/utils/dnsLookup';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

describe('lookupAll', () => {
  const lookupMock = vi.mocked(dns.lookup);

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('throws when hostname is empty', async () => {
    await expect(lookupAll('   ')).rejects.toThrow('hostname must not be empty');
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('maps DNS records to typed lookup results', async () => {
    lookupMock.mockResolvedValueOnce(
      [
        { address: '1.1.1.1', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ] as unknown as Awaited<ReturnType<typeof dns.lookup>>,
    );

    await expect(lookupAll('example.com')).resolves.toEqual([
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('rejects when DNS resolution exceeds timeout', async () => {
    vi.useFakeTimers();
    lookupMock.mockImplementationOnce(() => new Promise(() => {}));

    const pending = expect(lookupAll('example.com', { timeoutMs: 250 })).rejects.toThrow(
      'DNS lookup timed out after 250ms',
    );
    await vi.advanceTimersByTimeAsync(250);

    await pending;
  });
});
