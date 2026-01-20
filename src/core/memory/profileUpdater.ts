import { createLLMClient } from '../llm';
import { config } from '../config/env';
import { config as appConfig } from '../../config';
import { logger } from '../utils/logger';
import { LLMClient, LLMRequest, LLMProviderName } from '../llm/types';

/**
 * ANALYST SYSTEM PROMPT
 * The analyst does the hard work: reads previous summary + new interaction,
 * then outputs the UPDATED SUMMARY TEXT directly.
 * If nothing new was learned, it outputs the previous summary unchanged.
/**
 * ANALYST SYSTEM PROMPT
 * The analyst does the hard work: reads previous summary + new interaction,
 * then outputs the UPDATED SUMMARY TEXT directly.
 * If nothing new was learned, it outputs the previous summary unchanged.
 */
const ANALYST_SYSTEM_PROMPT = `You are an expert User Profile Analyst.
Your goal is to maintain a high-fidelity, evolving model of the user.

Input: Previous Profile + Latest Interaction
Output: The FULL Updated Profile (Previous + New merged)

Core Instructions:
1. **Analyze Deeply**: Look beyond surface facts. Identify values, communication style, technical proficiency, and recurring patterns.
2. **Merge & Evolve**: Integrate new insights with the existing profile. Refine outdated beliefs.
3. **Be Concise but Nuanced**: Use dense, descriptive language. Capture the "vibe" of the user.

Rules:
- PRESERVE existing stable facts unless contradicted.
- IGNORE transient small talk (hellos, simple thanks) unless it reveals personality.
- CAPTURE:
  - **Hard Facts**: Location, job, tech stack, specific interests.
  - **Soft Traits**: Tone (formal/casual), patience level, humor style.
  - **Context**: Recent major topics or projects.
- NO PII/SECRETS: Do not store phone numbers, keys, or passwords.
- **Output the FULL merged profile text** (do NOT output just the changes).`;

/**
 * FORMATTER SYSTEM PROMPT
 * Pure text-to-JSON wrapper. Does NOT interpret, extract, or rewrite.
 * Just wraps the analyst's output in JSON format.
 */
const FORMATTER_SYSTEM_PROMPT = `Wrap the given text in JSON format.

Output: {"summary": "<the text>"}

Do NOT modify, summarize, or extract from the text.
Just put the exact text inside the JSON summary field.`;

// Cached analyst client (uses gemini)
let analystClientCache: { client: LLMClient; provider: LLMProviderName } | null = null;

// Cached formatter client (uses qwen-coder)
let formatterClientCache: LLMClient | null = null;

/**
 * Get the LLM client for the Analyst phase.
 * Uses PROFILE_PROVIDER and PROFILE_POLLINATIONS_MODEL overrides if configured.
 * Default: gemini with temperature 0.3
 */
function getAnalystClient(): { client: LLMClient; provider: LLMProviderName } {
  if (analystClientCache) {
    return analystClientCache;
  }

  const profileProvider = config.profileProvider?.trim() || '';
  const profilePollinationsModel = config.profilePollinationsModel?.trim() || 'gemini';

  // Determine provider (use override or fallback to default)
  const provider = (profileProvider || 'pollinations') as LLMProviderName;

  analystClientCache = {
    client: createLLMClient(provider, { pollinationsModel: profilePollinationsModel }),
    provider,
  };

  logger.debug(
    { provider, model: profilePollinationsModel },
    'Analyst client initialized (gemini)',
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
  formatterClientCache = createLLMClient('pollinations', { pollinationsModel: formatterModel });

  logger.debug({ model: formatterModel }, 'Formatter client initialized (qwen-coder)');

  return formatterClientCache;
}

/**
 * Two-step profile update pipeline:
 * 1. ANALYST (gemini, temp=0.3): Analyze the interaction freely (no JSON constraint)
 * 2. FORMATTER (qwen-coder, temp=0.0): Convert analysis to strict JSON
 */
export async function updateProfileSummary(params: {
  previousSummary: string | null;
  userMessage: string;
  assistantReply: string;
}): Promise<string | null> {
  const { previousSummary, userMessage, assistantReply } = params;

  try {
    // ========================================
    // STEP 1: ANALYST (Outputs Updated Summary)
    // ========================================
    const updatedSummaryText = await runAnalyst({
      previousSummary,
      userMessage,
      assistantReply,
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
    });

    if (json && typeof json.summary === 'string') {
      logger.info('Profile Update: Two-step pipeline succeeded');
      return json.summary;
    }

    logger.warn('Profile Update: Formatter did not return valid summary');
    return previousSummary; // Preserve existing on failure
  } catch (error) {
    logger.error({ error }, 'Error in profile update pipeline');
    return null;
  }
}

/**
 * STEP 1: Run the Analyst
 * - Model: gemini
 * - Temperature: 0.3 (creative but focused)
 * - Output: Free-form text analysis (NO JSON constraint)
 */
async function runAnalyst(params: {
  previousSummary: string | null;
  userMessage: string;
  assistantReply: string;
}): Promise<string | null> {
  const { previousSummary, userMessage, assistantReply } = params;
  const { client } = getAnalystClient();

  const userPrompt = `Previous Summary: ${previousSummary || 'None (new user)'}

Latest Interaction:
User: ${userMessage}
Assistant: ${assistantReply}

Output the updated summary:`;

  const payload: LLMRequest = {
    messages: [
      { role: 'system', content: ANALYST_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3, // Analyst temperature: creative but focused
    maxTokens: 1024,
    // NO responseFormat - allow free text output
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
}): Promise<{ summary?: string } | null> {
  const { summaryText } = params;
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
    maxTokens: 1024,
  };

  try {
    const response = await client.chat(payload);
    const content = response.content;

    logger.debug({ content }, 'Formatter raw output');

    // Extract and parse JSON
    const extracted = extractBalancedJson(content);

    if (!extracted) {
      logger.warn({ content }, 'Formatter: No JSON found, retrying with stricter prompt');
      return retryFormatter(client, summaryText);
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
    maxTokens: 1024,
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
