/**
 * @description Provides DNS resolution helpers with bounded lookup latency.
 */
import * as dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { normalizeTimeoutMs } from '../../shared/utils/timeout';

/**
 * Represents the DnsLookupRecord type.
 */
export type DnsLookupRecord = {
  address: string;
  family: 4 | 6;
};

/**
 * Represents optional behavior for DNS lookup calls.
 */
export type LookupAllOptions = {
  timeoutMs?: number;
};

const DEFAULT_DNS_LOOKUP_TIMEOUT_MS = 5_000;
const MIN_DNS_LOOKUP_TIMEOUT_MS = 250;
const MAX_DNS_LOOKUP_TIMEOUT_MS = 30_000;

/** Resolve all A/AAAA records with a bounded timeout. */
async function lookupAllWithTimeout(hostname: string, timeoutMs: number): Promise<LookupAddress[]> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<LookupAddress[]>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`DNS lookup timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeoutId.unref?.();
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Resolve all DNS addresses for a hostname.
 *
 * @param hostname - DNS hostname to resolve.
 * @param options - Optional timeout override.
 * @returns Resolved IPv4/IPv6 addresses with family metadata.
 */
export async function lookupAll(hostname: string, options: LookupAllOptions = {}): Promise<DnsLookupRecord[]> {
  const normalizedHostname = hostname.trim();
  if (!normalizedHostname) {
    throw new Error('hostname must not be empty');
  }

  const timeoutMs = normalizeTimeoutMs(options.timeoutMs, {
    fallbackMs: DEFAULT_DNS_LOOKUP_TIMEOUT_MS,
    minMs: MIN_DNS_LOOKUP_TIMEOUT_MS,
    maxMs: MAX_DNS_LOOKUP_TIMEOUT_MS,
  });
  const records = await lookupAllWithTimeout(normalizedHostname, timeoutMs);
  return records.map((record) => ({
    address: record.address,
    family: record.family as 4 | 6,
  }));
}
