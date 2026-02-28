import { jsonrepair } from 'jsonrepair';
import { config as appConfig } from '../../config';
import { createLLMClient } from '../llm';
import { LLMClient, LLMRequest } from '../llm/llm-types';
import { logger } from '../utils/logger';
import { VoiceConversationSession } from './voiceConversationSessionStore';

const MAX_INPUT_UTTERANCES = 1500;
const MAX_INPUT_CHARS = 100_000;

export interface StructuredVoiceSummary {
  summaryText: string;
  topics: string[];
  threads: string[];
  decisions: string[];
  actionItems: string[];
  unresolved: string[];
  sentiment?: string;
  glossary: Record<string, string>;
}

const VOICE_SUMMARY_PROMPT = `## ROLE
You are an expert impartial meeting scribe for a Discord voice channel.

## INSTRUCTIONS
1. Summarize what was discussed in the voice session. Use neutral, factual language.
2. Capture disagreements and resolutions fairly. If unresolved, list it as unresolved.
3. Extract decisions and action items. For action items: include WHO and DEADLINE when mentioned.
4. Do NOT invent content. Only use what is supported by the transcript.
5. Format: Output STRICTLY as a JSON object matching this schema:
{
  "summaryText": "<Detailed, neutral narrative of the voice session>",
  "topics": ["topic 1", "topic 2"],
  "threads": ["thread 1"],
  "decisions": ["decision 1"],
  "actionItems": ["@User: Task (Deadline: X)"],
  "sentiment": "<Collaborative | Tense | Sarcastic | Productive | Casual>",
  "unresolved": ["question 1"],
  "glossary": { "Term": "Definition" }
}

CRITICAL: Output perfectly well-formed JSON. Do NOT append trailing text, markdown, or extra characters after the final closing brace. Output ONLY the JSON object.
`;

let analystClientCache: LLMClient | null = null;

function getAnalystClient(): LLMClient {
  if (analystClientCache) return analystClientCache;
  const model = appConfig.SUMMARY_MODEL?.trim() || 'deepseek';
  analystClientCache = createLLMClient('pollinations', { chatModel: model });
  return analystClientCache;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter((s) => s.trim().length > 0);
}

function toGlossary(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = String(k).trim();
    const val = String(v ?? '').trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function parseToJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(jsonrepair(trimmed)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function formatUtterances(session: VoiceConversationSession): string {
  const utterances = session.utterances.length > MAX_INPUT_UTTERANCES
    ? session.utterances.slice(session.utterances.length - MAX_INPUT_UTTERANCES)
    : session.utterances;

  let total = 0;
  const lines: string[] = [];
  for (const u of utterances) {
    const speaker = u.displayName?.trim() ? `@${u.displayName}` : `<@${u.userId}>`;
    const line = `- [${u.at.toISOString()}] ${speaker}: ${u.text}`;
    const next = total + line.length + 1;
    if (next > MAX_INPUT_CHARS) break;
    lines.push(line);
    total = next;
  }
  return lines.join('\n');
}

export async function summarizeVoiceConversationSession(params: {
  session: VoiceConversationSession;
  apiKey?: string;
}): Promise<StructuredVoiceSummary | null> {
  if (params.session.utterances.length === 0) return null;
  const transcript = formatUtterances(params.session);
  if (!transcript.trim()) return null;

  const userPrompt = `Voice session:
- Guild: ${params.session.guildId}
- Voice channel: ${params.session.voiceChannelName ?? params.session.voiceChannelId}
- Window: ${params.session.startedAt.toISOString()} - ${params.session.endedAt?.toISOString() ?? '(unknown)'}

Transcript (utterance-level):
${transcript}

Summarize this voice session:`;

  const client = getAnalystClient();
  const payload: LLMRequest = {
    messages: [
      { role: 'system', content: VOICE_SUMMARY_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    maxTokens: 2048,
    apiKey: params.apiKey,
    responseFormat: 'json_object',
  };

  try {
    const response = await client.chat(payload);
    const json = parseToJson(response.content ?? '');
    if (!json) {
      logger.warn({ guildId: params.session.guildId }, 'Voice summary parse failed');
      return null;
    }

    const summaryText = String(json.summaryText ?? '').trim();
    if (!summaryText) return null;

    return {
      summaryText,
      topics: toStringList(json.topics),
      threads: toStringList(json.threads),
      decisions: toStringList(json.decisions),
      actionItems: toStringList(json.actionItems),
      unresolved: toStringList(json.unresolved),
      sentiment: json.sentiment ? String(json.sentiment).trim() : undefined,
      glossary: toGlossary(json.glossary),
    };
  } catch (error) {
    logger.warn(
      { error, guildId: params.session.guildId },
      'Voice summary generation failed (non-fatal)',
    );
    return null;
  }
}

