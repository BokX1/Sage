import { config } from '../../platform/config/env';
import { logger } from '../../platform/logging/logger';
import { normalizeAtLeastInt } from '../../shared/utils/numbers';

/**
 * Represents the VoiceUtterance type.
 */
export type VoiceUtterance = {
  at: Date;
  userId: string;
  displayName?: string;
  text: string;
};

/**
 * Represents the VoiceConversationSession type.
 */
export type VoiceConversationSession = {
  guildId: string;
  voiceChannelId: string;
  voiceChannelName?: string;
  initiatedByUserId: string;
  startedAt: Date;
  endedAt?: Date;
  utterances: VoiceUtterance[];
};

type ActiveSession = Omit<VoiceConversationSession, 'endedAt'>;

const activeSessions = new Map<string, ActiveSession>();

const MAX_UTTERANCES_PER_SESSION = 2000;
const DEFAULT_VOICE_LIVE_CONTEXT_LOOKBACK_SEC = 0;
const DEFAULT_VOICE_LIVE_CONTEXT_MAX_CHARS = 200;
const DEFAULT_VOICE_LIVE_CONTEXT_MAX_UTTERANCES = 5;

export function startVoiceConversationSession(params: {
  guildId: string;
  voiceChannelId: string;
  voiceChannelName?: string;
  initiatedByUserId: string;
  startedAt: Date;
}): void {
  activeSessions.set(params.guildId, {
    guildId: params.guildId,
    voiceChannelId: params.voiceChannelId,
    voiceChannelName: params.voiceChannelName,
    initiatedByUserId: params.initiatedByUserId,
    startedAt: params.startedAt,
    utterances: [],
  });
}

export function getActiveVoiceConversationSession(guildId: string): ActiveSession | null {
  return activeSessions.get(guildId) ?? null;
}

export function appendVoiceUtterance(params: {
  guildId: string;
  at: Date;
  userId: string;
  displayName?: string;
  text: string;
}): void {
  const session = activeSessions.get(params.guildId);
  if (!session) return;
  const text = params.text.trim();
  if (!text) return;

  session.utterances.push({
    at: params.at,
    userId: params.userId,
    displayName: params.displayName,
    text,
  });

  if (session.utterances.length > MAX_UTTERANCES_PER_SESSION) {
    session.utterances.splice(0, session.utterances.length - MAX_UTTERANCES_PER_SESSION);
    logger.warn({ guildId: params.guildId }, 'Voice utterance cap reached; dropping oldest utterances');
  }
}

function formatSpeakerLabel(utterance: VoiceUtterance): string {
  return utterance.displayName?.trim() ? `@${utterance.displayName}` : `<@${utterance.userId}>`;
}

export function formatLiveVoiceContext(params: {
  guildId: string;
  voiceChannelId: string;
  now?: Date;
}): string | null {
  const session = activeSessions.get(params.guildId);
  if (!session) return null;
  if (session.voiceChannelId !== params.voiceChannelId) return null;

  const now = params.now ?? new Date();
  const lookbackSec = normalizeAtLeastInt(
    config.VOICE_LIVE_CONTEXT_LOOKBACK_SEC as number | undefined,
    DEFAULT_VOICE_LIVE_CONTEXT_LOOKBACK_SEC,
    0,
  );
  const lookbackMs = lookbackSec * 1000;
  const cutoffMs = now.getTime() - lookbackMs;
  const recent = session.utterances.filter((u) => u.at.getTime() >= cutoffMs);
  if (recent.length === 0) return null;

  const maxChars = normalizeAtLeastInt(
    config.VOICE_LIVE_CONTEXT_MAX_CHARS as number | undefined,
    DEFAULT_VOICE_LIVE_CONTEXT_MAX_CHARS,
    200,
  );
  const maxUtterances = normalizeAtLeastInt(
    config.VOICE_LIVE_CONTEXT_MAX_UTTERANCES as number | undefined,
    DEFAULT_VOICE_LIVE_CONTEXT_MAX_UTTERANCES,
    5,
  );

  const header = `Live voice transcript context (last ~${Math.round(lookbackMs / 1000)}s, most recent last):`;
  const lines: string[] = [header];

  let total = header.length;
  const slice = recent.length > maxUtterances ? recent.slice(recent.length - maxUtterances) : recent;
  for (const utterance of slice) {
    const ts = utterance.at.toISOString();
    const line = `- [${ts}] ${formatSpeakerLabel(utterance)}: ${utterance.text}`;
    if (total + 1 + line.length > maxChars) break;
    lines.push(line);
    total += 1 + line.length;
  }

  if (lines.length === 1) return null;
  return lines.join('\n');
}

export function stopVoiceConversationSession(params: { guildId: string; endedAt: Date }): VoiceConversationSession | null {
  const session = activeSessions.get(params.guildId);
  if (!session) return null;
  activeSessions.delete(params.guildId);
  return {
    ...session,
    endedAt: params.endedAt,
  };
}

export function clearVoiceConversationSession(guildId: string): void {
  activeSessions.delete(guildId);
}
