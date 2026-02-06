import { ZodSchema } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import { LLMClient, LLMChatMessage } from './llm-types';
import { logger } from '../utils/logger';

export async function callWithSchema<T>(
  client: LLMClient,
  schema: ZodSchema<T>,
  messages: LLMChatMessage[],
  systemInstructions?: string,
  apiKey?: string,
): Promise<T | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonSchema = zodToJsonSchema(schema as any, 'output');
  const schemaStr = JSON.stringify(jsonSchema, null, 2);

  const systemPrompt = `
${systemInstructions || 'You are a helpful assistant that outputs strictly valid JSON.'}

You must output valid JSON matching this schema:
\`\`\`json
${schemaStr}
\`\`\`

Do not wrap the output in markdown blocks. Output raw JSON only.
`.trim();

  // 1. Initial Call
  const fullMessages: LLMChatMessage[] = [{ role: 'system', content: systemPrompt }, ...messages];

  try {
    const response = await client.chat({
      messages: fullMessages,
      responseFormat: 'json_object',
      apiKey,
    });

    return parseAndValidate(response.content, schema);
  } catch (error) {
    logger.warn({ error }, '[callWithSchema] Initial call failed or invalid JSON');
    // 2. Repair Attempt
    return repairJsonOnce(
      client,
      schema,
      messages,
      error instanceof Error ? error.message : String(error),
      apiKey,
    );
  }
}

async function repairJsonOnce<T>(
  client: LLMClient,
  schema: ZodSchema<T>,
  originalMessages: LLMChatMessage[],
  errorMsg: string,
  apiKey?: string,
): Promise<T | null> {
  // Construct a repair prompt
  // Retry with explicit error feedback appended to conversation.

  // Let's append to the conversation.
  const repairMessages: LLMChatMessage[] = [
    ...originalMessages,
    {
      role: 'user',
      content: `Your previous response was invalid JSON. Error: ${errorMsg}. Please output ONLY valid JSON matching the schema.`,
    },
  ];

  try {
    const response = await client.chat({
      messages: repairMessages, // Note: Retrying without re-injecting system prompt if missing.
      responseFormat: 'json_object',
      apiKey,
    });
    return parseAndValidate(response.content, schema);
  } catch (finalError) {
    logger.error({ error: finalError }, '[callWithSchema] Repair failed');
    return null;
  }
}

function parseAndValidate<T>(content: string, schema: ZodSchema<T>): T {
  // Try to find JSON if wrapped in markdown
  let clean = content.trim();
  const match = clean.match(/```json\s*([\s\S]*?)\s*```/) || clean.match(/```\s*([\s\S]*?)\s*```/);
  if (match) {
    clean = match[1];
  }

  const json = JSON.parse(clean);
  return schema.parse(json);
}
