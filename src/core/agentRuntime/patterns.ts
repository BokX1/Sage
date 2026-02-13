/**
 * Shared regex patterns used across the agent runtime pipeline.
 *
 * Centralised here to prevent drift between agentRuntime.ts,
 * responseValidators.ts, and other modules that test for the same
 * intent classes.
 */

/** Matches user queries that are likely time-sensitive or freshness-dependent. */
export const TIME_SENSITIVE_QUERY_PATTERN =
    /(latest|today|current|now|right now|as of|recent|fresh|newest|release|version|price|weather|news|score)/i;

/** Matches user queries that explicitly request sources, citations, or links. */
export const SOURCE_REQUEST_PATTERN =
    /(source|sources|citation|cite|reference|references|link|url)/i;

/** Matches coding-related queries that benefit from tool-backed verification. */
export const CODING_VERIFICATION_PATTERN =
    /(npm|pnpm|yarn|package|dependency|dependencies|install|version|api|sdk|docs|documentation|changelog|migration|deprecated|cli|command|stack trace|error|exception|runtime)/i;

/** Matches queries recalling previously uploaded/attached files. */
export const ATTACHMENT_RECALL_PATTERN =
    /(attachment|attached|uploaded|upload|cached|remember(?:ed)?|previous file|earlier file|that file|that attachment)/i;
