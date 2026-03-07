import { describe, expect, it } from 'vitest';
import {
  normalizeUserProfileSummary,
  parseUserProfileSummary,
} from '../../../../src/features/memory/userProfileXml';

describe('userProfileXml', () => {
  it('parses and normalizes the preference-oriented profile structure', () => {
    const parsed = parseUserProfileSummary(
      '<preferences>Prefers concise answers</preferences>\n<active_focus>Refining prompts</active_focus>\n<background>Maintains Sage</background>',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.preferences).toEqual(['Prefers concise answers']);
    expect(parsed?.activeFocus).toEqual(['Refining prompts']);
    expect(parsed?.background).toEqual(['Maintains Sage']);
  });

  it('normalizes legacy directives into preferences', () => {
    const normalized = normalizeUserProfileSummary(
      '<directives>Prefers concise answers</directives>\n<active_focus>Refining prompts</active_focus>\n<background>Maintains Sage</background>',
    );

    expect(normalized).toBe(
      '<preferences>Prefers concise answers</preferences>\n<active_focus>Refining prompts</active_focus>\n<background>Maintains Sage</background>',
    );
  });

  it('rejects malformed summaries that do not contain all required sections', () => {
    expect(
      normalizeUserProfileSummary(
        '<preferences>Prefers concise answers</preferences>\n<background>Maintains Sage</background>',
      ),
    ).toBeNull();
  });
});
