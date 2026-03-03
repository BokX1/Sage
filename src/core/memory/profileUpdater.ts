/**
 * @module src/core/memory/profileUpdater
 * @description Defines the profile updater module.
 */
import { createLLMClient } from '../llm';
import { config as appConfig } from '../../config';
import { logger } from '../utils/logger';
import { LLMClient, LLMRequest, LLMProviderName } from '../llm/llm-types';
import { limitByKey } from '../utils/perKeyConcurrency';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { jsonrepair } from 'jsonrepair';

// Global request rate limiting is handled by the LLM client.
// This module additionally enforces per-user sequential consistency.

const ANALYST_SYSTEM_PROMPT = `You are a User Intelligence Analyst.

## OBJECTIVE
Maintain a living model of the user.

## OUTPUT FORMAT
Return a JSON object: { "summary": "<string>" }
The summary value must contain exactly three XML sections:

1. <directives> — behavioral preferences, rules the user has set
2. <active_focus> — current goals, work in progress, active interests
3. <background> — environment, traits, background info

Example:
{ "summary": "<directives>Prefers concise answers</directives>\n<active_focus>Building a Discord bot</active_focus>\n<background>Software engineer, uses TypeScript</background>" }

## RULES
- Prioritize latest interactions.
- If new info contradicts old info, overwrite the old info.
- Do NOT invent traits or preferences not clearly supported by the conversation.
- If no updates are needed, return the Previous Summary unchanged inside the JSON.

Output ONLY the JSON object.`;

// Cached analyst client
let analystClientCache: { client: LLMClient; provider: LLMProviderName } | null = null;

function isTrailingAssistantMatch(
  message: { content: string; authorIsBot: boolean },
  assistantReply: string,
): boolean {
  return message.authorIsBot === true && message.content.trim() === assistantReply.trim();
}

function isTrailingUserMatch(
  message: { content: string; authorId: string; authorIsBot: boolean },
  userId: string,
  userMessage: string,
): boolean {
  return message.authorIsBot !== true && message.authorId === userId && message.content.trim() === userMessage.trim();
}

/**
 * Get the LLM client for the Analyst phase.
 * Uses PROFILE_PROVIDER and PROFILE_CHAT_MODEL overrides if configured.
 * Default: Configured model (default: deepseek) with temperature 0.3
 */
function getAnalystClient(): { client: LLMClient; provider: LLMProviderName } {
  if (analystClientCache) {
    return analystClientCache;
  }

  const profileProvider = appConfig.PROFILE_PROVIDER?.trim() || '';
  const profileChatModel = appConfig.PROFILE_CHAT_MODEL?.trim() || 'deepseek';

  // Determine provider (use override or fallback to default)
  const provider = (profileProvider || 'pollinations') as LLMProviderName;

  analystClientCache = {
    client: createLLMClient(provider, { chatModel: profileChatModel }),
    provider,
  };

  logger.debug(
    { provider, model: profileChatModel },
    'Analyst client initialized',
  );

  return analystClientCache;
}


/**
 * Two-step profile update pipeline:
 * 1. ANALYST: Analyze the interaction freely (no JSON constraint)
 * 2. FORMATTER: Convert analysis to strict JSON
 */
export async function updateProfileSummary(params: {
  previousSummary: string | null;
  userMessage: string;
  assistantReply: string;
  channelId: string;
  guildId: string | null;
  userId: string;
  apiKey?: string;
}): Promise<string | null> {
  const { previousSummary, userMessage, assistantReply, channelId, guildId, userId, apiKey } = params;

  try {
    // ========================================
    // PER-USER SEQUENTIAL CONTROL
    // ========================================
    // Ensure updates for the same user happen one at a time to prevent race conditions
    // on 'previousSummary'.
    const limit = limitByKey(userId, 1);

    return limit(async () => {
      // Fetch Recent Context (Window of ~15 messages)
      const recentMessages = getRecentMessages({
        guildId,
        channelId,
        limit: 15,
      });

      // ========================================
      // STRICT DEDUPLICATION
      // ========================================
      // We inject (userMessage, assistantReply) explicitly as "Latest Interaction".
      // We must remove them from "recentMessages" if they exist there to prevent double-vision.
      const historyMessages = [...recentMessages];

      // 1. Check/Remove Assistant Reply (if it made it to the buffer)
      if (historyMessages.length > 0) {
        const last = historyMessages[historyMessages.length - 1];
        if (isTrailingAssistantMatch(last, assistantReply)) {
          historyMessages.pop();
        }
      }

      // 2. Check/Remove User Message (if it made it to the buffer)
      if (historyMessages.length > 0) {
        const last = historyMessages[historyMessages.length - 1];
        if (isTrailingUserMatch(last, userId, userMessage)) {
          historyMessages.pop();
        }
      }

      const recentHistory = buildTranscriptBlock(historyMessages, 4000) || '';

      // ========================================
      // STEP 1: ANALYST (Outputs Updated Summary)
      // ========================================
      const updatedSummaryText = await runAnalyst({
        previousSummary,
        recentHistory,
        userMessage,
        assistantReply,
        apiKey,
      });

      if (!updatedSummaryText) {
        logger.warn('Profile Update: Analyst returned empty response');
        return previousSummary; // Preserve existing on failure
      }

      logger.debug({ updatedSummaryText }, 'Analyst output');

      // ========================================
      // STEP 2: FORMATTER (Wrap in JSON locally)
      // ========================================
      const json = parseToJSON(updatedSummaryText);

      if (json && typeof json.summary === 'string') {
        logger.info('Profile Update: Pipeline succeeded (jsonrepair)');
        return json.summary;
      }

      logger.warn('Profile Update: Formatter did not return valid summary');
      return previousSummary; // Preserve existing on failure
    });
  } catch (error) {
    // Preserve the existing summary on unexpected runtime failures to avoid accidental profile erasure.
    logger.error({ error }, 'Error in profile update pipeline');
    return previousSummary;
  }
}

/**
 * STEP 1: Run the Analyst
 * - Model: deepseek
 * - Temperature: 0.3 (creative but focused)
 * - Output: Free-form text analysis (NO JSON constraint)
 */
async function runAnalyst(params: {
  previousSummary: string | null;
  recentHistory: string;
  userMessage: string;
  assistantReply: string;
  apiKey?: string;
}): Promise<string | null> {
  const { previousSummary, recentHistory, userMessage, assistantReply, apiKey } = params;
  const { client } = getAnalystClient();

  const userPrompt = `Previous Summary: ${previousSummary || 'None (new user)'}

Recent Conversation History (Chronological: Top=Oldest, Bottom=Newest):
${recentHistory}

Latest Interaction (Focus):
User: ${userMessage}
Assistant: ${assistantReply}

(Note: The interaction above is the LATEST event and is NOT included in the "Recent Conversation History" block.)

Output the updated summary:`;

  const payload: LLMRequest = {
    messages: [
      { role: 'system', content: ANALYST_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3, // Analyst temperature: creative but focused
    maxTokens: 2048,
    apiKey,
    responseFormat: 'json_object',
    timeout: appConfig.TIMEOUT_MEMORY_MS, // Relaxed timeout for background
  };

  try {
    const response = await client.chat(payload);
    return response.content?.trim() || null;
  } catch (error) {
    logger.error({ error }, 'Analyst phase failed');
    return null;
  }
}


/**
 * Extract a balanced JSON object from a string.
 * - First tries to extract from ```json ... ``` code blocks.
 * - Then scans for the first '{' and tracks brace depth to find the matching '}'.
 * - Correctly ignores braces inside JSON strings (handles \" and \\ escapes).
 */
export function extractBalancedJson(content: string): string | null {
  // 1. Try extracting from code blocks first
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    // Validate there's a { in the code block
    if (inner.includes('{')) {
      return extractFirstJsonObject(inner);
    }
  }

  // 2. Extract first balanced JSON object
  return extractFirstJsonObject(content);
}

/**
 * Extract the first complete top-level JSON object from the string.
 * Uses brace depth tracking and properly handles strings.
 */
function extractFirstJsonObject(content: string): string | null {
  const startIdx = content.indexOf('{');
  if (startIdx === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return content.slice(startIdx, i + 1);
        }
      }
    }
  }

  // No complete object found
  return null;
}

function parseToJSON(text: string): Record<string, unknown> | null {
  // We want to force {"summary": "..."} structure if it's raw text
  let contentToParse = text;

  // Safety: if the model returned plain text despite json_object format,
  // wrap it as a summary. Use JSON.stringify for safe escaping.
  if (!text.includes('{') && !text.includes('}')) {
    contentToParse = JSON.stringify({ summary: text });
  }

  const extracted = extractBalancedJson(contentToParse);
  const target = extracted || contentToParse;

  try {
    return JSON.parse(target);
  } catch {
    try {
      logger.warn('Initial JSON parse failed, falling back to jsonrepair');
      const repaired = jsonrepair(target);
      return JSON.parse(repaired);
    } catch (err) {
      logger.error({ err, textPreview: target.slice(0, 200) }, 'Failed to parse and repair JSON');
      return null;
    }
  }
}
