import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelSummaryScheduler, DirtyChannelParams } from './channelSummaryScheduler';
import { ChannelSummaryStore } from './channelSummaryStore';
import { MessageStore } from '../awareness/messageStore';
import { StructuredSummary } from './summarizeChannelWindow';
import { ChannelMessage } from '../awareness/types';

// Mocks
const mockSummaryStore = {
    getLatestSummary: vi.fn(),
    upsertSummary: vi.fn(),
} as unknown as ChannelSummaryStore;

const mockMessageStore = {
    fetchRecent: vi.fn(),
} as unknown as MessageStore;

const mockSummarizeWindow = vi.fn();
const mockSummarizeProfile = vi.fn();

// Mock dependencies
vi.mock('../settings/guildChannelSettings', () => ({
    isLoggingEnabled: vi.fn().mockReturnValue(true),
}));

describe('ChannelSummaryScheduler', () => {
    let scheduler: ChannelSummaryScheduler;

    beforeEach(() => {
        vi.clearAllMocks();
        scheduler = new ChannelSummaryScheduler({
            summaryStore: mockSummaryStore,
            messageStore: mockMessageStore,
            summarizeWindow: mockSummarizeWindow,
            summarizeProfile: mockSummarizeProfile,
        });
    });

    describe('forceSummarize', () => {
        it('should summarize regardless of time or message count constraints if messages exist', async () => {
            const guildId = 'g1';
            const channelId = 'c1';

            // Setup mock valid messages
            (mockMessageStore.fetchRecent as any).mockResolvedValue([
                { id: '1', content: 'hello' } as unknown as ChannelMessage
            ]);

            // Setup mock summary result
            const mockSummary: StructuredSummary = {
                windowStart: new Date(),
                windowEnd: new Date(),
                summaryText: 'Forced summary',
                topics: [],
                threads: [],
                unresolved: [],
                glossary: {},
            };
            mockSummarizeWindow.mockResolvedValue(mockSummary);

            // Setup mock profile result (since forceSummarize triggers profile update)
            mockSummarizeProfile.mockResolvedValue({
                ...mockSummary,
                summaryText: 'Profile summary'
            });

            // Execute
            const result = await scheduler.forceSummarize(guildId, channelId);

            // Verify
            expect(result).toBe(mockSummary);
            expect(mockMessageStore.fetchRecent).toHaveBeenCalled();
            expect(mockSummarizeWindow).toHaveBeenCalled();
            expect(mockSummaryStore.upsertSummary).toHaveBeenCalledWith(expect.objectContaining({
                kind: 'rolling',
                summaryText: 'Forced summary'
            }));
            // Should also force update profile
            expect(mockSummaryStore.upsertSummary).toHaveBeenCalledWith(expect.objectContaining({
                kind: 'profile', // We expect a profile update too
            }));
        });

        it('should return null if no messages found', async () => {
            (mockMessageStore.fetchRecent as any).mockResolvedValue([]);

            const result = await scheduler.forceSummarize('g1', 'c1');

            expect(result).toBeNull();
            expect(mockSummarizeWindow).not.toHaveBeenCalled();
        });
    });
});
