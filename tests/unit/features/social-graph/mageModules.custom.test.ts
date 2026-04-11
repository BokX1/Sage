import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('MAGE custom.py transforms', () => {
  it('ensures social_transform writes guild activity edges for interaction users', () => {
    const source = readFileSync('services/social-graph/mage-modules/custom.py', 'utf8');
    const socialStart = source.indexOf('def social_transform');
    const voiceStart = source.indexOf('def voice_transform');

    expect(socialStart).toBeGreaterThanOrEqual(0);
    expect(voiceStart).toBeGreaterThan(socialStart);

    const socialSection = source.slice(socialStart, voiceStart);
    expect(socialSection).toContain('MERGE (a)-[:ACTIVE_IN_GUILD]->(g)');
    expect(socialSection).toContain('MERGE (b)-[:ACTIVE_IN_GUILD]->(g)');
  });
});
