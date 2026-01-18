import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '../../../src/core/agentRuntime/contextBuilder';

describe('contextBuilder with relationship hints', () => {
    it('should include relationship_hints block when provided', () => {
        const messages = buildContextMessages({
            userProfileSummary: null,
            replyToBotText: null,
            userText: 'Hello',
            relationshipHints: 'Relationship hints: user_a <-> user_b',
        });

        const relationshipBlock = messages.find((m) => m.content.includes('Relationship hints'));
        expect(relationshipBlock).toBeDefined();
        expect(relationshipBlock?.role).toBe('system');
    });

    it('should omit relationship_hints block when null', () => {
        const messages = buildContextMessages({
            userProfileSummary: null,
            replyToBotText: null,
            userText: 'Hello',
            relationshipHints: null,
        });

        const relationshipBlock = messages.find((m) =>
            m.content.includes('Relationship hints'),
        );
        expect(relationshipBlock).toBeUndefined();
    });

    it('should order blocks correctly with relationship_hints', () => {
        const messages = buildContextMessages({
            userProfileSummary: 'User summary',
            channelProfileSummary: 'Channel profile',
            channelRollingSummary: 'Rolling summary',
            relationshipHints: 'Relationship hints',
            recentTranscript: 'Transcript',
            replyToBotText: null,
            userText: 'Hello',
        });

        const blockOrder = messages.map((m) => {
            if (m.content.includes('Relationship hints')) return 'relationship_hints';
            if (m.content.includes('Channel profile')) return 'profile_summary';
            if (m.content.includes('Rolling summary')) return 'rolling_summary';
            if (m.content.includes('Transcript')) return 'transcript';
            if (m.content.includes('User summary')) return 'memory';
            if (m.role === 'user') return 'user';
            return 'other';
        });

        const relIdx = blockOrder.indexOf('relationship_hints');
        const profileIdx = blockOrder.indexOf('profile_summary');
        const transcriptIdx = blockOrder.indexOf('transcript');

        expect(relIdx).toBeGreaterThan(profileIdx); // After profile_summary
        expect(relIdx).toBeLessThan(transcriptIdx); // Before transcript
    });
});
