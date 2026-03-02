import * as dns from 'node:dns/promises';

export type DnsLookupRecord = {
  address: string;
  family: 4 | 6;
};

export async function lookupAll(hostname: string): Promise<DnsLookupRecord[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family as 4 | 6,
  }));
}
