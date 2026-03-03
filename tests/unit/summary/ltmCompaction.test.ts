/**
 * @module tests/unit/summary/ltmCompaction.test
 * @description Defines the ltm compaction.test module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStore = vi.hoisted(() => ({
  listActiveProfiles: vi.fn(),
  getLatestSummary: vi.fn(),
  upsertSummary: vi.fn(),
  listArchiveSummaries: vi.fn(),
}));

const mockGetChannelSummaryStore = vi.hoisted(() => vi.fn(() => mockStore));
const mockSummarizeChannelProfile = vi.hoisted(() => vi.fn());

vi.mock('@/core/summary/channelSummaryStoreRegistry', () => ({
  getChannelSummaryStore: mockGetChannelSummaryStore,
}));

vi.mock('@/core/summary/summarizeChannelWindow', () => ({
  summarizeChannelProfile: mockSummarizeChannelProfile,
}));

import {
  __resetCompactionStateForTests,
  getISOWeekString,
  startCompactionScheduler,
  stopCompactionScheduler,
  runWeeklyCompaction,
} from '@/core/summary/ltmCompaction';

describe('ltmCompaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCompactionStateForTests();
    mockStore.listActiveProfiles.mockResolvedValue([{ guildId: 'guild-1', channelId: 'channel-1' }]);
    mockStore.getLatestSummary.mockResolvedValue({
      guildId: 'guild-1',
      channelId: 'channel-1',
      kind: 'profile',
      windowStart: new Date('2026-02-01T00:00:00.000Z'),
      windowEnd: new Date('2026-02-07T23:59:59.000Z'),
      summaryText: 'Historical summary',
      topics: ['planning'],
      threads: [],
      unresolved: [],
      decisions: [],
      actionItems: [],
      glossary: {},
      updatedAt: new Date('2026-02-07T23:59:59.000Z'),
    });
    mockSummarizeChannelProfile.mockResolvedValue({
      windowStart: new Date('2026-02-01T00:00:00.000Z'),
      windowEnd: new Date('2026-02-08T23:59:59.000Z'),
      summaryText: 'Compacted summary',
      topics: ['planning'],
      threads: [],
      unresolved: [],
      decisions: [],
      actionItems: [],
      glossary: {},
    });
  });

  it('computes ISO weeks with UTC boundaries', () => {
    expect(getISOWeekString(new Date('2021-01-01T12:00:00.000Z'))).toBe('2020-W53');
    expect(getISOWeekString(new Date('2021-01-04T12:00:00.000Z'))).toBe('2021-W01');
    expect(getISOWeekString(new Date('2026-02-24T12:00:00.000Z'))).toBe('2026-W09');
  });

  it('runs compaction only once per ISO week', async () => {
    const timestamp = new Date('2026-02-22T23:55:00.000Z');
    const expectedArchiveKind = `archive:${getISOWeekString(timestamp)}`;

    await runWeeklyCompaction(timestamp);
    await runWeeklyCompaction(timestamp);

    expect(mockStore.listActiveProfiles).toHaveBeenCalledTimes(1);
    expect(mockStore.upsertSummary).toHaveBeenCalledTimes(2);
    expect(mockStore.upsertSummary).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: expectedArchiveKind }),
    );
  });

  it('runs again in a different ISO week', async () => {
    await runWeeklyCompaction(new Date('2026-02-22T23:55:00.000Z'));
    await runWeeklyCompaction(new Date('2026-03-01T23:55:00.000Z'));

    expect(mockStore.listActiveProfiles).toHaveBeenCalledTimes(2);
  });

  it('retries in the same ISO week after a partial channel failure', async () => {
    let failChannel2Once = true;
    mockStore.listActiveProfiles.mockResolvedValue([
      { guildId: 'guild-1', channelId: 'channel-1' },
      { guildId: 'guild-1', channelId: 'channel-2' },
    ]);
    mockStore.getLatestSummary.mockImplementation(async ({ channelId }: { channelId: string }) => {
      if (channelId === 'channel-2' && failChannel2Once) {
        failChannel2Once = false;
        throw new Error('Transient lookup failure');
      }

      return {
        guildId: 'guild-1',
        channelId,
        kind: 'profile',
        windowStart: new Date('2026-02-01T00:00:00.000Z'),
        windowEnd: new Date('2026-02-07T23:59:59.000Z'),
        summaryText: 'Historical summary',
        topics: ['planning'],
        threads: [],
        unresolved: [],
        decisions: [],
        actionItems: [],
        glossary: {},
        updatedAt: new Date('2026-02-07T23:59:59.000Z'),
      };
    });

    const timestamp = new Date('2026-02-22T23:55:00.000Z');
    await runWeeklyCompaction(timestamp);
    await runWeeklyCompaction(timestamp);

    expect(mockStore.listActiveProfiles).toHaveBeenCalledTimes(2);
    const channel2Lookups = mockStore.getLatestSummary.mock.calls.filter(
      ([args]) => (args as { channelId?: string } | undefined)?.channelId === 'channel-2',
    );
    expect(channel2Lookups).toHaveLength(2);
    expect(mockStore.upsertSummary).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'channel-2', kind: 'profile' }),
    );
  });

  it('scheduler still catches the window when startup minute is offset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-22T23:44:00.000Z'));

    startCompactionScheduler();
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    stopCompactionScheduler();

    expect(mockStore.listActiveProfiles).toHaveBeenCalledTimes(1);
  });
});
