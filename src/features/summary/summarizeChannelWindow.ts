import { config as appConfig } from '../../platform/config/env';
import { createLLMClient } from '../../platform/llm';
import { LLMClient, LLMRequest } from '../../platform/llm/llm-types';
import { logger } from '../../platform/logging/logger';
import { ChannelMessage } from '../awareness/awareness-types';
import { jsonrepair } from 'jsonrepair';

const MAX_INPUT_MESSAGES = 800;
const MAX_INPUT_CHARS = 80_000;

export interface StructuredSummary {
  windowStart: Date;
  windowEnd: Date;
  summaryText: string;
  topics: string[];
  threads: string[];
  unresolved: string[];
  decisions: string[];
  actionItems: string[];
  sentiment?: string;
  glossary: Record<string, string>;
}

// ============================================
// ANALYST PROMPTS (Strict JSON output)
// ============================================

/**
 * STM ANALYST: Summarizes recent conversation window
 * Outputs strict JSON matching StructuredSummary interface
 */
const STM_ANALYST_PROMPT = `## ROLE
You are an expert impartial Facilitator and Channel Context Analyst.

## INSTRUCTIONS
1. **Human Dynamics**: Detect sarcasm and inside jokes; extract factual intent without adopting sarcastic tone.
2. **Disagreements**: Represent all differing viewpoints fairly. Capture resolution or note as unresolved.
3. **Decisions & Actions**: For action items, state WHO is responsible and the DEADLINE if mentioned.
4. **Anti-Hallucination**: Do NOT invent topics, decisions, or action items not clearly supported by the messages.
5. **Format**: Output STRICTLY as a JSON object matching this schema:
{
  "summaryText": "<Detailed, neutral narrative of conversation flow and outcomes>",
  "topics": ["topic 1", "topic 2"],
  "threads": ["thread 1"],
  "decisions": ["decision 1"],
  "actionItems": ["@User: Task (Deadline: X)"],
  "sentiment": "<Collaborative | Tense | Sarcastic | Productive | Casual>",
  "unresolved": ["question 1"],
  "glossary": { "Term": "Definition" }
}

CRITICAL: Output perfectly well-formed JSON. Do NOT append trailing text, markdown, or garbage characters after the final closing brace. Output ONLY the JSON object.
`;

/**
 * LTM ANALYST: Updates long-term channel profile
 * Outputs strict JSON matching StructuredSummary interface
 */
const LTM_ANALYST_PROMPT = `## ROLE
You are a Channel Historian maintaining a long-term Wiki of this channel.

## INSTRUCTIONS
1. Merge the new Rolling Summary into the existing Channel Profile.
2. Track long-term decisions and recurring behavioral patterns.
3. Preserve established glossary terms and channel rules.
4. Drop fully resolved action items and completed threads.
5. **Anti-Hallucination**: Do NOT invent history not supported by the input.
6. **Format**: Output STRICTLY as a JSON object:
{
  "summaryText": "<Comprehensive channel description, purpose, culture, and history>",
  "topics": ["recurring theme 1"],
  "threads": ["active long-running thread"],
  "decisions": ["major historical decision still relevant"],
  "actionItems": ["long-term project or pending action"],
  "sentiment": "<Typical prevailing mood>",
  "unresolved": ["long-term open question"],
  "glossary": { "Established Term": "Definition" }
}

CRITICAL: Output perfectly well-formed JSON. Do NOT append trailing text, markdown, or garbage characters after the final closing brace. Output ONLY the JSON object.
`;

let analystClientCache: LLMClient | null = null;

function getAnalystClient(): LLMClient {
  if (analystClientCache) return analystClientCache;
  // Use summary-specific model config (defaults to deepseek)
  const model = appConfig.SUMMARY_MODEL?.trim() || 'deepseek';
  analystClientCache = createLLMClient('pollinations', { chatModel: model });
  logger.debug({ model }, 'Summary analyst client initialized');
  return analystClientCache;
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
  apiKey?: string;
}): Promise<StructuredSummary> {
  const boundedMessages = boundMessages(params.messages, params.windowStart, params.windowEnd);
  const messageText = buildMessageLines(boundedMessages);

  const userPrompt = `Window: ${params.windowStart.toISOString()} - ${params.windowEnd.toISOString()}

Messages:
${messageText || '(no messages)'}

Summarize this conversation:`;

  try {
    // Step 1: Analyst (strict JSON output)
    const analysisText = await runAnalyst(STM_ANALYST_PROMPT, userPrompt, params.apiKey);

    if (!analysisText) {
      logger.warn('STM: Analyst returned empty, using fallback');
      return fallbackSummary(messageText, params.windowStart, params.windowEnd);
    }

    // Step 2: Parse JSON output
    const json = parseToJSON(analysisText);

    if (json) {
      logger.info('STM: Pipeline succeeded (JSON parsed)');
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
  apiKey?: string;
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
    // Step 1: Analyst (strict JSON output)
    const analysisText = await runAnalyst(LTM_ANALYST_PROMPT, userPrompt, params.apiKey);

    if (!analysisText) {
      logger.warn('LTM: Analyst returned empty, preserving previous');
      return params.previousSummary ?? params.latestRollingSummary;
    }

    // Step 2: Parse JSON output
    const json = parseToJSON(analysisText);

    if (json) {
      logger.info('LTM: Pipeline succeeded (JSON parsed)');
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
 * - Temperature: 0.5 (focused but creative)
 * - Output: Strict JSON via responseFormat enforcement
 */
async function runAnalyst(
  systemPrompt: string,
  userPrompt: string,
  apiKey?: string,
): Promise<string | null> {
  const client = getAnalystClient();

  const payload: LLMRequest = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    maxTokens: 2048,
    apiKey,
    responseFormat: 'json_object',
  };

  try {
    const response = await client.chat(payload);
    const text = response.text?.trim();
    logger.debug({ textLength: text?.length }, 'Summary analyst output');
    return text || null;
  } catch (error) {
    logger.error({ error }, 'Summary analyst failed');
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

export function formatSummaryAsText(summary: StructuredSummary): string {
  const parts: string[] = [summary.summaryText];

  if (summary.sentiment) {
    parts.push(`Sentiment: ${summary.sentiment}`);
  }
  if (summary.decisions.length > 0) {
    parts.push(`Decisions:\n- ${summary.decisions.join('\n- ')}`);
  }
  if (summary.actionItems.length > 0) {
    parts.push(`Action Items:\n- ${summary.actionItems.join('\n- ')}`);
  }
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

  return parts.join('\n\n');
}
export function cleanJsonOutput(content: string): string {
  let text = content;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1];
  }

  const start = text.indexOf('{');
  if (start === -1) return text.trim();

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') depth--;

      if (depth === 0) {
        return text.substring(start, i + 1);
      }
    }
  }

  return text.substring(start).trim();
}

function parseToJSON(text: string): Record<string, unknown> | null {
  const cleaned = cleanJsonOutput(text);

  if (!cleaned) {
    return null;
  }

  try {
    // With responseFormat: 'json_object', this should always succeed
    return JSON.parse(cleaned);
  } catch {
    // Safety net: jsonrepair for edge cases (e.g., provider doesn't honor responseFormat)
    try {
      logger.warn('JSON parse failed despite responseFormat enforcement, trying jsonrepair');
      const repaired = jsonrepair(cleaned);
      return JSON.parse(repaired);
    } catch (err) {
      logger.error({ err, textPreview: cleaned.slice(0, 200) }, 'Failed to parse analyst output');
      return null;
    }
  }
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
    decisions: normalizeStringArray(json.decisions),
    actionItems: normalizeStringArray(json.actionItems),
    sentiment: typeof json.sentiment === 'string' ? json.sentiment.trim() : undefined,
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
    decisions: [],
    actionItems: [],
    sentiment: 'Unknown',
  };
}
