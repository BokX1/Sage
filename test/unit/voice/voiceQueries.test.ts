import { describe, expect, it, vi } from 'vitest';
import { howLongInVoiceToday } from '../../../src/core/voice/voiceQueries';

describe('voiceQueries', () => {
    it('sums voice session overlaps for today', async () => {
        const now = new Date('2026-01-18T12:00:00.000Z');
        const repo = {
            getUserSessionsInRange: vi.fn().mockResolvedValue([
                {
                    id: 's1',
                    guildId: 'g1',
                    channelId: 'c1',
                    userId: 'u1',
                    displayName: 'User',
                    startedAt: new Date('2026-01-18T08:00:00.000Z'),
                    endedAt: new Date('2026-01-18T09:00:00.000Z'),
                    createdAt: now,
                    updatedAt: now,
                },
                {
                    id: 's2',
                    guildId: 'g1',
                    channelId: 'c2',
                    userId: 'u1',
                    displayName: 'User',
                    startedAt: new Date('2026-01-18T11:30:00.000Z'),
                    endedAt: new Date('2026-01-18T12:00:00.000Z'),
                    createdAt: now,
                    updatedAt: now,
                },
                {
                    id: 's3',
                    guildId: 'g1',
                    channelId: 'c3',
                    userId: 'u1',
                    displayName: 'User',
                    startedAt: new Date('2026-01-17T23:00:00.000Z'),
                    endedAt: new Date('2026-01-18T01:00:00.000Z'),
                    createdAt: now,
                    updatedAt: now,
                },
            ]),
        };

        const result = await howLongInVoiceToday({
            guildId: 'g1',
            userId: 'u1',
            now,
            repo,
        });

        expect(repo.getUserSessionsInRange).toHaveBeenCalledWith({
            guildId: 'g1',
            userId: 'u1',
            start: new Date('2026-01-18T00:00:00.000Z'),
            end: new Date('2026-01-19T00:00:00.000Z'),
        });

        const expectedMs = 2.5 * 60 * 60 * 1000;
        expect(result.ms).toBe(expectedMs);
    });

    it('counts open sessions through now', async () => {
        const now = new Date('2026-01-18T12:00:00.000Z');
        const repo = {
            getUserSessionsInRange: vi.fn().mockResolvedValue([
                {
                    id: 's1',
                    guildId: 'g1',
                    channelId: 'c1',
                    userId: 'u1',
                    displayName: 'User',
                    startedAt: new Date('2026-01-18T10:00:00.000Z'),
                    endedAt: null,
                    createdAt: now,
                    updatedAt: now,
                },
            ]),
        };

        const result = await howLongInVoiceToday({
            guildId: 'g1',
            userId: 'u1',
            now,
            repo,
        });

        expect(result.ms).toBe(2 * 60 * 60 * 1000);
    });
});
