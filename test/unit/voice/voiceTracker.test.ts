import { describe, expect, it, vi } from 'vitest';
import { classifyVoiceChange, handleVoiceChange } from '../../../src/core/voice/voiceTracker';

describe('voiceTracker', () => {
    it('classifies join/leave/move/noop', () => {
        expect(
            classifyVoiceChange({
                guildId: 'g1',
                userId: 'u1',
                oldChannelId: null,
                newChannelId: 'c1',
                at: new Date(),
            }),
        ).toBe('join');

        expect(
            classifyVoiceChange({
                guildId: 'g1',
                userId: 'u1',
                oldChannelId: 'c1',
                newChannelId: null,
                at: new Date(),
            }),
        ).toBe('leave');

        expect(
            classifyVoiceChange({
                guildId: 'g1',
                userId: 'u1',
                oldChannelId: 'c1',
                newChannelId: 'c2',
                at: new Date(),
            }),
        ).toBe('move');

        expect(
            classifyVoiceChange({
                guildId: 'g1',
                userId: 'u1',
                oldChannelId: 'c1',
                newChannelId: 'c1',
                at: new Date(),
            }),
        ).toBe('noop');
    });

    it('handles join change', async () => {
        const presenceIndex = { applyChange: vi.fn() };
        const voiceSessionRepo = {
            startSession: vi.fn().mockResolvedValue(undefined),
            endOpenSession: vi.fn().mockResolvedValue(undefined),
        };
        const logger = { warn: vi.fn(), error: vi.fn() };

        await handleVoiceChange(
            {
                guildId: 'g1',
                userId: 'u1',
                displayName: 'User',
                oldChannelId: null,
                newChannelId: 'c1',
                at: new Date('2026-01-18T10:00:00.000Z'),
            },
            { presenceIndex, voiceSessionRepo, logger },
        );

        expect(presenceIndex.applyChange).toHaveBeenCalledTimes(1);
        expect(voiceSessionRepo.startSession).toHaveBeenCalledTimes(1);
        expect(voiceSessionRepo.endOpenSession).not.toHaveBeenCalled();
    });

    it('handles leave change', async () => {
        const presenceIndex = { applyChange: vi.fn() };
        const voiceSessionRepo = {
            startSession: vi.fn().mockResolvedValue(undefined),
            endOpenSession: vi.fn().mockResolvedValue(undefined),
        };
        const logger = { warn: vi.fn(), error: vi.fn() };

        await handleVoiceChange(
            {
                guildId: 'g1',
                userId: 'u1',
                oldChannelId: 'c1',
                newChannelId: null,
                at: new Date('2026-01-18T10:30:00.000Z'),
            },
            { presenceIndex, voiceSessionRepo, logger },
        );

        expect(presenceIndex.applyChange).toHaveBeenCalledTimes(1);
        expect(voiceSessionRepo.endOpenSession).toHaveBeenCalledTimes(1);
        expect(voiceSessionRepo.startSession).not.toHaveBeenCalled();
    });

    it('handles move change', async () => {
        const presenceIndex = { applyChange: vi.fn() };
        const voiceSessionRepo = {
            startSession: vi.fn().mockResolvedValue(undefined),
            endOpenSession: vi.fn().mockResolvedValue(undefined),
        };
        const logger = { warn: vi.fn(), error: vi.fn() };

        await handleVoiceChange(
            {
                guildId: 'g1',
                userId: 'u1',
                oldChannelId: 'c1',
                newChannelId: 'c2',
                at: new Date('2026-01-18T11:00:00.000Z'),
            },
            { presenceIndex, voiceSessionRepo, logger },
        );

        expect(presenceIndex.applyChange).toHaveBeenCalledTimes(1);
        expect(voiceSessionRepo.endOpenSession).toHaveBeenCalledTimes(1);
        expect(voiceSessionRepo.startSession).toHaveBeenCalledTimes(1);
    });

    it('does not throw when repo operations fail', async () => {
        const presenceIndex = { applyChange: vi.fn() };
        const voiceSessionRepo = {
            startSession: vi.fn().mockRejectedValue(new Error('fail')),
            endOpenSession: vi.fn().mockRejectedValue(new Error('fail')),
        };
        const logger = { warn: vi.fn(), error: vi.fn() };

        await expect(
            handleVoiceChange(
                {
                    guildId: 'g1',
                    userId: 'u1',
                    oldChannelId: null,
                    newChannelId: 'c1',
                    at: new Date('2026-01-18T11:00:00.000Z'),
                },
                { presenceIndex, voiceSessionRepo, logger },
            ),
        ).resolves.toBeUndefined();

        expect(presenceIndex.applyChange).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalled();
    });
});
