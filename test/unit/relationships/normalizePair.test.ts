import { describe, it, expect } from 'vitest';
import { normalizePair } from '../../../src/core/relationships/relationshipGraph';

describe('normalizePair', () => {
    it('should order userA < userB lexicographically', () => {
        const result = normalizePair('user_z', 'user_a');
        expect(result.userA).toBe('user_a');
        expect(result.userB).toBe('user_z');
    });

    it('should maintain order if already sorted', () => {
        const result = normalizePair('user_a', 'user_z');
        expect(result.userA).toBe('user_a');
        expect(result.userB).toBe('user_z');
    });

    it('should handle identical users (edge case)', () => {
        const result = normalizePair('user_a', 'user_a');
        expect(result.userA).toBe('user_a');
        expect(result.userB).toBe('user_a');
    });

    it('should handle numeric IDs', () => {
        const result = normalizePair('123456', '234567');
        expect(result.userA).toBe('123456');
        expect(result.userB).toBe('234567');
    });
});
