import { createLLMClient } from '../llm';
import { config } from '../config/legacy-config-adapter';
import { config as appConfig } from '../../config';
import { logger } from '../utils/logger';
import { LLMClient, LLMRequest, LLMProviderName } from '../llm/llm-types';
import { limitByKey } from '../utils/perKeyConcurrency';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';

// Note: Global request limit is handled by the LLM client itself (rate limiting/queuing)
// Here we enforce Per-User Sequential consistency.
// Limit global profile updates to 2 concurrent operations (legacy global limit, we now use per-key)
// const profileUpdateLimit = limitConcurrency(2);

const ANALYST_SYSTEM_PROMPT = `You are a User Intelligence Analyst.

### OBJECTIVE:
Maintain a living model of the user.

### OUTPUT SECTIONS:

1. \`### Directives\`
   - Behavioral preferences, rules, etc...

2. \`### Active Focus\`
   - Current goal, state, work in progress, etc...

3. \`### User Context\`
   - Background, environment, traits, etc...

### INSTRUCTIONS:
- Prioritize latest interactions.
- If new info contradicts old info, overwrite it.
- If no updates are needed, output the **Previous Summary** exactly.

Output the FULL predictive profile.`;

/**
 * FORMATTER SYSTEM PROMPT
 * Pure text-to-JSON wrapper.
 */
const FORMATTER_SYSTEM_PROMPT = `You are a JSON wrapper.
Task: Wrap the user's text into a valid JSON object.

Output format: {"summary": "<the text>"}

CRITICAL RULES:
- ESCAPE all double quotes (") as (\\").
- ESCAPE all newlines as (\\\\n).
- The "summary" value must be a single valid JSON string.
- Do NOT modify the content.
- **Preserve Markdown**: The input text is structured Markdown (headers, bullets). Keep it EXACTLY as is.
- You are FORBIDDEN from summarizing, rewriting, or fixing the text. Copy it character-for-character.`;

// Cached analyst client
let analystClientCache: { client: LLMClient; provider: LLMProviderName } | null = null;

// Cached formatter client (uses qwen-coder)
let formatterClientCache: LLMClient | null = null;

/**
 * Get the LLM client for the Analyst phase.
 * Uses PROFILE_PROVIDER and PROFILE_CHAT_MODEL overrides if configured.
 * Default: Configured model (default: deepseek) with temperature 0.3
 */
function getAnalystClient(): { client: LLMClient; provider: LLMProviderName } {
  if (analystClientCache) {
    return analystClientCache;
  }

  const profileProvider = config.profileProvider?.trim() || '';
  const profileChatModel = config.profileChatModel?.trim() || 'deepseek';

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
 * Get the LLM client for the Formatter phase.
 * Uses qwen-coder model with temperature 0.0 for deterministic JSON output.
 */
function getFormatterClient(): LLMClient {
  if (formatterClientCache) {
    return formatterClientCache;
  }

  const formatterModel = appConfig.FORMATTER_MODEL || 'qwen-coder';
  formatterClientCache = createLLMClient('pollinations', { chatModel: formatterModel });

  logger.debug({ model: formatterModel }, 'Formatter client initialized (qwen-coder)');

  return formatterClientCache;
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
        if (last.content.trim() === assistantReply.trim()) {
          historyMessages.pop();
        }
      }

      // 2. Check/Remove User Message (if it made it to the buffer)
      if (historyMessages.length > 0) {
        const last = historyMessages[historyMessages.length - 1];
        if (last.content.trim() === userMessage.trim()) {
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
      // STEP 2: FORMATTER (Wrap in JSON)
      // ========================================
      const json = await runFormatter({
        summaryText: updatedSummaryText,
        apiKey,
      });

      if (json && typeof json.summary === 'string') {
        // Log success but be nuanced - the update might be stale if high concurrency
        logger.info('Profile Update: Two-step pipeline succeeded');
        return json.summary;
      }

      logger.warn('Profile Update: Formatter did not return valid summary');
      return previousSummary; // Preserve existing on failure
    });
  } catch (error) {
    logger.error({ error }, 'Error in profile update pipeline');
    return null;
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
  // const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD <--- Removed date injection

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
    maxTokens: 4096,
    apiKey,
    // NO responseFormat - allow free text output
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
 * STEP 2: Run the Formatter
 * - Model: qwen-coder
 * - Temperature: 0.0 (deterministic)
 * - Output: Strict JSON {"summary": "..."}
 * Just wraps the analyst's text in JSON format.
 */
async function runFormatter(params: {
  summaryText: string;
  apiKey?: string;
}): Promise<{ summary?: string } | null> {
  const { summaryText, apiKey } = params;
  const client = getFormatterClient();

  // Simple prompt: just wrap this text in JSON
  const userPrompt = summaryText;

  const payload: LLMRequest = {
    messages: [
      { role: 'system', content: FORMATTER_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseFormat: 'json_object',
    temperature: 0, // Formatter temperature: deterministic
    maxTokens: 4096,
    apiKey,
    timeout: appConfig.TIMEOUT_MEMORY_MS, // Relaxed timeout for background
  };

  try {
    const response = await client.chat(payload);
    const content = response.content;

    logger.debug({ content }, 'Formatter raw output');

    // Extract and parse JSON
    const extracted = extractBalancedJson(content);

    if (!extracted) {
      logger.warn({ content }, 'Formatter: No JSON found, retrying with stricter prompt');
      return retryFormatter(client, summaryText, apiKey);
    }

    return JSON.parse(extracted);
  } catch (error) {
    logger.error({ error }, 'Formatter phase failed');
    return null;
  }
}

/**
 * Retry formatter with stricter instructions
 */
async function retryFormatter(
  client: LLMClient,
  summaryText: string,
  apiKey?: string,
): Promise<{ summary?: string } | null> {
  const strictPrompt = `Wrap this text in JSON: {"summary": "<text>"}

Text to wrap:
${summaryText}`;

  const payload: LLMRequest = {
    messages: [
      {
        role: 'system',
        content: 'Output valid JSON only. Format: {"summary": "..."}',
      },
      { role: 'user', content: strictPrompt },
    ],
    responseFormat: 'json_object',
    temperature: 0,
    maxTokens: 4096,
    apiKey,
    timeout: appConfig.TIMEOUT_MEMORY_MS, // Relaxed timeout for background
  };

  try {
    const response = await client.chat(payload);
    const extracted = extractBalancedJson(response.content);

    if (!extracted) {
      logger.error({ content: response.content }, 'Formatter retry failed - no JSON');
      return null;
    }

    const json = JSON.parse(extracted);
    logger.info('Formatter retry succeeded');
    return json;
  } catch (error) {
    logger.error({ error }, 'Formatter retry failed');
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
