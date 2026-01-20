import { config as appConfig } from '../../config';
import { createLLMClient } from '../llm';
import { LLMClient, LLMRequest } from '../llm/types';
import { logger } from '../utils/logger';
import { ChannelMessage } from '../awareness/types';

const MAX_INPUT_MESSAGES = 120;
const MAX_INPUT_CHARS = 12_000;

export interface StructuredSummary {
  windowStart: Date;
  windowEnd: Date;
  summaryText: string;
  topics: string[];
  threads: string[];
  unresolved: string[];
  glossary: Record<string, string>;
}

// ============================================
// ANALYST PROMPTS (Free text output)
// ============================================

/**
 * STM ANALYST: Summarizes recent conversation window
 * Outputs structured text summary
 */
const STM_ANALYST_PROMPT = `You are a Channel Context Analyst.
Summarize the recent conversation flow for immediate context.

Input: Recent messages
Output: A structured summary

Instructions:
1. Analyze the conversation.
2. Output your analysis in the following STRICT format:

SUMMARY:
<Write a narrative summary of what happened, who said what, and the vibe>

TOPICS:
<Comma-separated list of main topics>

THREADS:
<Comma-separated list of ongoing conversation threads>

UNRESOLVED:
<Comma-separated list of any open questions or issues>

GLOSSARY:
<Key: Value list of any specific terms, project names, or definitions mentioned>
`;

/**
 * LTM ANALYST: Updates long-term channel profile
 * Merges previous profile with new rolling summary
 */
const LTM_ANALYST_PROMPT = `You are a Channel Historian.
Maintain the long-term "Wiki" or "Profile" of this channel.

Input: Previous Profile + Latest Rolling Summary
Output: The FULL Updated Channel Profile

Instructions:
1. Merge the new information into the existing history.
2. Output the FULL profile in the following STRICT format:

SUMMARY:
<The comprehensive description of the channel's life, purpose, and culture>

TOPICS:
<Comma-separated list of recurring themes>

THREADS:
<Comma-separated list of active long-running threads>

UNRESOLVED:
<Comma-separated list of long-term open questions>

GLOSSARY:
<Key: Value list of established definitions and terms>
`;

/**
 * FORMATTER PROMPT: Converts structured text to JSON
 * Pure wrapper - does NOT interpret or modify
 */
const FORMATTER_PROMPT = `Wrap the given text in JSON format.

Input is text with sections (SUMMARY, TOPICS, etc.).
Output is valid JSON only.

{
  "summaryText": "<content of SUMMARY section>",
  "topics": ["<item 1>", "<item 2>"],
  "threads": ["<item 1>", "<item 2>"],
  "unresolved": ["<item 1>", "<item 2>"],
  "glossary": {"<term>": "<def>"}
}

Rules:
- Do NOT interpret or summarize.
- Just extract the content from the sections and put it in the JSON fields.
- If a section is missing, use empty array/object/string.`;

// Cached clients
let analystClientCache: LLMClient | null = null;
let formatterClientCache: LLMClient | null = null;

function getAnalystClient(): LLMClient {
  if (analystClientCache) return analystClientCache;
  // Use summary-specific model config (defaults to gemini)
  const model = appConfig.SUMMARY_MODEL?.trim() || 'gemini';
  analystClientCache = createLLMClient('pollinations', { pollinationsModel: model });
  logger.debug({ model }, 'Summary analyst client initialized');
  return analystClientCache;
}

function getFormatterClient(): LLMClient {
  if (formatterClientCache) return formatterClientCache;
  const model = appConfig.FORMATTER_MODEL || 'qwen-coder';
  formatterClientCache = createLLMClient('pollinations', { pollinationsModel: model });
  logger.debug({ model }, 'Summary formatter client initialized');
  return formatterClientCache;
}

// ============================================
// PUBLIC API
// ============================================

/**
 * STM: Summarize recent channel messages (Rolling Summary)
 * Uses two-step pipeline: Analyst → Formatter
 */
export async function summarizeChannelWindow(params: {
  messages: ChannelMessage[];
  windowStart: Date;
  windowEnd: Date;
}): Promise<StructuredSummary> {
  const boundedMessages = boundMessages(params.messages, params.windowStart, params.windowEnd);
  const messageText = buildMessageLines(boundedMessages);

  const userPrompt = `Window: ${params.windowStart.toISOString()} - ${params.windowEnd.toISOString()}

Messages:
${messageText || '(no messages)'}

Summarize this conversation:`;

  try {
    // Step 1: Analyst (free text summary)
    const analysisText = await runAnalyst(STM_ANALYST_PROMPT, userPrompt);

    if (!analysisText) {
      logger.warn('STM: Analyst returned empty, using fallback');
      return fallbackSummary(messageText, params.windowStart, params.windowEnd);
    }

    // Step 2: Formatter (wrap in JSON)
    const json = await runFormatter(analysisText);

    if (json) {
      logger.info('STM: Two-step pipeline succeeded');
      return normalizeSummary(json, params.windowStart, params.windowEnd);
    }

    return fallbackSummary(messageText, params.windowStart, params.windowEnd);
  } catch (error) {
    logger.error({ error }, 'STM: Pipeline failed');
    return fallbackSummary(messageText, params.windowStart, params.windowEnd);
  }
}

/**
 * LTM: Update long-term channel profile
 * Uses two-step pipeline: Analyst → Formatter
 */
export async function summarizeChannelProfile(params: {
  previousSummary: StructuredSummary | null;
  latestRollingSummary: StructuredSummary;
}): Promise<StructuredSummary> {
  const previousText = params.previousSummary
    ? formatSummaryAsText(params.previousSummary)
    : '(none - new channel)';
  const latestText = formatSummaryAsText(params.latestRollingSummary);

  const windowStart =
    params.previousSummary?.windowStart ?? params.latestRollingSummary.windowStart;
  const windowEnd = params.latestRollingSummary.windowEnd;

  const userPrompt = `Previous Profile:
${previousText}

Latest Rolling Summary:
${latestText}

Output the updated channel profile:`;

  try {
    // Step 1: Analyst (free text profile update)
    const analysisText = await runAnalyst(LTM_ANALYST_PROMPT, userPrompt);

    if (!analysisText) {
      logger.warn('LTM: Analyst returned empty, preserving previous');
      return params.previousSummary ?? params.latestRollingSummary;
    }

    // Step 2: Formatter (wrap in JSON)
    const json = await runFormatter(analysisText);

    if (json) {
      logger.info('LTM: Two-step pipeline succeeded');
      return normalizeSummary(json, windowStart, windowEnd);
    }

    // Preserve previous on failure
    return params.previousSummary ?? params.latestRollingSummary;
  } catch (error) {
    logger.error({ error }, 'LTM: Pipeline failed');
    return params.previousSummary ?? params.latestRollingSummary;
  }
}

// ============================================
// TWO-STEP PIPELINE
// ============================================

/**
 * Step 1: Run the Analyst
 * - Temperature: 0.3 (focused but creative)
 * - Output: Free text (no JSON)
 */
async function runAnalyst(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const client = getAnalystClient();

  const payload: LLMRequest = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    maxTokens: 2048,
    // NO responseFormat - free text output
  };

  try {
    const response = await client.chat(payload);
    const text = response.content?.trim();
    logger.debug({ textLength: text?.length }, 'Summary analyst output');
    return text || null;
  } catch (error) {
    logger.error({ error }, 'Summary analyst failed');
    return null;
  }
}

/**
 * Step 2: Run the Formatter
 * - Temperature: 0.0 (deterministic)
 * - Output: Structured JSON
 */
async function runFormatter(analysisText: string): Promise<Record<string, unknown> | null> {
  const client = getFormatterClient();

  const payload: LLMRequest = {
    messages: [
      { role: 'system', content: FORMATTER_PROMPT },
      { role: 'user', content: analysisText },
    ],
    responseFormat: 'json_object',
    temperature: 0,
    maxTokens: 2048,
  };

  try {
    const response = await client.chat(payload);
    const cleaned = cleanJsonOutput(response.content);

    try {
      return JSON.parse(cleaned);
    } catch {
      logger.warn({ content: response.content }, 'Formatter: Invalid JSON, retrying');
      return retryFormatter(client, analysisText);
    }
  } catch (error) {
    logger.error({ error }, 'Summary formatter failed');
    return null;
  }
}

async function retryFormatter(
  client: LLMClient,
  analysisText: string,
): Promise<Record<string, unknown> | null> {
  const strictPrompt = `Convert to JSON:

${analysisText}

Output: {"summaryText": "...", "topics": [], "threads": [], "unresolved": [], "glossary": {}}`;

  const payload: LLMRequest = {
    messages: [
      { role: 'system', content: 'Output valid JSON only.' },
      { role: 'user', content: strictPrompt },
    ],
    responseFormat: 'json_object',
    temperature: 0,
    maxTokens: 2048,
  };

  try {
    const response = await client.chat(payload);
    const cleaned = cleanJsonOutput(response.content);
    return JSON.parse(cleaned);
  } catch (error) {
    logger.error({ error }, 'Summary formatter retry failed');
    return null;
  }
}

// ============================================
// HELPERS
// ============================================

function boundMessages(
  messages: ChannelMessage[],
  windowStart: Date,
  windowEnd: Date,
): ChannelMessage[] {
  const filtered = messages.filter(
    (message) =>
      message.timestamp.getTime() >= windowStart.getTime() &&
      message.timestamp.getTime() <= windowEnd.getTime(),
  );
  if (filtered.length <= MAX_INPUT_MESSAGES) {
    return filtered;
  }
  return filtered.slice(filtered.length - MAX_INPUT_MESSAGES);
}

function buildMessageLines(messages: ChannelMessage[]): string {
  let totalChars = 0;
  const lines: string[] = [];

  for (const message of messages) {
    const line = `- [${message.timestamp.toISOString()}] @${message.authorDisplayName}: ${message.content}`;
    const nextTotal = totalChars + line.length + 1;
    if (nextTotal > MAX_INPUT_CHARS) {
      break;
    }
    lines.push(line);
    totalChars = nextTotal;
  }

  return lines.join('\n');
}

function formatSummaryAsText(summary: StructuredSummary): string {
  const parts: string[] = [summary.summaryText];

  if (summary.topics.length > 0) {
    parts.push(`Topics: ${summary.topics.join(', ')}`);
  }
  if (summary.threads.length > 0) {
    parts.push(`Threads: ${summary.threads.join(', ')}`);
  }
  if (summary.unresolved.length > 0) {
    parts.push(`Unresolved: ${summary.unresolved.join(', ')}`);
  }
  if (Object.keys(summary.glossary).length > 0) {
    const glossaryStr = Object.entries(summary.glossary)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    parts.push(`Glossary: ${glossaryStr}`);
  }

  return parts.join('\n');
}

export function cleanJsonOutput(content: string): string {
  // 1. Try to extract from markdown code blocks
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 2. Find first '{' and last '}' to handle text before/after JSON
  const firstOpen = content.indexOf('{');
  const lastClose = content.lastIndexOf('}');
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    return content.substring(firstOpen, lastClose + 1);
  }

  return content.trim();
}

function normalizeSummary(
  json: Record<string, unknown>,
  windowStart: Date,
  windowEnd: Date,
): StructuredSummary {
  const summaryText = normalizeSummaryText(json.summaryText);
  return {
    windowStart,
    windowEnd,
    summaryText,
    topics: normalizeStringArray(json.topics),
    threads: normalizeStringArray(json.threads),
    unresolved: normalizeStringArray(json.unresolved),
    glossary: normalizeGlossary(json.glossary),
  };
}

function normalizeSummaryText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return '(no summary available)';
  }
  return text;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeGlossary(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, val]) => typeof key === 'string' && typeof val === 'string')
    .slice(0, 6);

  return Object.fromEntries(entries.map(([key, val]) => [key, String(val).trim()]));
}

function fallbackSummary(prompt: string, windowStart: Date, windowEnd: Date): StructuredSummary {
  const raw = prompt.replace(/\s+/g, ' ').trim();
  const summaryText = raw.length > 500 ? raw.slice(0, 500) + '...' : raw;

  return {
    windowStart,
    windowEnd,
    summaryText: summaryText || '(summary unavailable)',
    topics: [],
    threads: [],
    unresolved: [],
    glossary: {},
  };
}
