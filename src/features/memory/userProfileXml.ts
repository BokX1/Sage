const ALLOWED_TAGS = new Set(['preferences', 'directives', 'active_focus', 'background']);

export interface ParsedUserProfile {
  preferences: string[];
  activeFocus: string[];
  background: string[];
  normalizedSummary: string;
}

function collectTagMatches(summary: string, tag: string): string[] {
  const matches = summary.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi')) ?? [];
  return matches;
}

function extractTagContent(summary: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = summary.match(pattern);
  return match ? match[1] : null;
}

function normalizeSectionContent(content: string): string {
  const normalizedLines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return normalizedLines.join('\n');
}

function linesFromSection(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0);
}

function hasUnknownTags(summary: string): boolean {
  const tags = summary.matchAll(/<\/?([a-z_]+)>/gi);
  for (const match of tags) {
    const tag = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      return true;
    }
  }
  return false;
}

export function parseUserProfileSummary(summary: string): ParsedUserProfile | null {
  const trimmed = summary.trim();
  if (!trimmed) return null;
  if (hasUnknownTags(trimmed)) return null;

  const preferenceMatches = collectTagMatches(trimmed, 'preferences');
  const legacyDirectiveMatches = collectTagMatches(trimmed, 'directives');
  const activeFocusMatches = collectTagMatches(trimmed, 'active_focus');
  const backgroundMatches = collectTagMatches(trimmed, 'background');

  if (preferenceMatches.length + legacyDirectiveMatches.length !== 1) return null;
  if (activeFocusMatches.length !== 1 || backgroundMatches.length !== 1) return null;

  const preferencesContent = extractTagContent(trimmed, 'preferences')
    ?? extractTagContent(trimmed, 'directives');
  const activeFocusContent = extractTagContent(trimmed, 'active_focus');
  const backgroundContent = extractTagContent(trimmed, 'background');

  if (!preferencesContent || activeFocusContent === null || backgroundContent === null) {
    return null;
  }

  const preferencesNormalized = normalizeSectionContent(preferencesContent);
  const activeFocusNormalized = normalizeSectionContent(activeFocusContent);
  const backgroundNormalized = normalizeSectionContent(backgroundContent);

  const normalizedSummary = [
    `<preferences>${preferencesNormalized}</preferences>`,
    `<active_focus>${activeFocusNormalized}</active_focus>`,
    `<background>${backgroundNormalized}</background>`,
  ].join('\n');

  return {
    preferences: linesFromSection(preferencesNormalized),
    activeFocus: linesFromSection(activeFocusNormalized),
    background: linesFromSection(backgroundNormalized),
    normalizedSummary,
  };
}

export function normalizeUserProfileSummary(summary: string): string | null {
  return parseUserProfileSummary(summary)?.normalizedSummary ?? null;
}
