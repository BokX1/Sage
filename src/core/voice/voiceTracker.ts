/**
 * @module src/core/voice/voiceTracker
 * @description Defines the voice tracker module.
 */
import { VoicePresenceChannel } from './voicePresenceIndex';
import { computeVoiceOverlapForUser } from './voiceOverlapTracker';

/**
 * Represents the VoiceChange type.
 */
export type VoiceChange = {
  guildId: string;
  userId: string;
  displayName?: string;
  oldChannelId: string | null;
  newChannelId: string | null;
  at: Date;
};

/**
 * Represents the VoiceChangeKind type.
 */
export type VoiceChangeKind = 'join' | 'leave' | 'move' | 'noop';

/**
 * Represents the VoicePresenceIndex type.
 */
export type VoicePresenceIndex = {
  applyChange: (params: {
    guildId: string;
    userId: string;
    displayName?: string;
    oldChannelId: string | null;
    newChannelId: string | null;
    at: Date;
  }) => void;
  getGuildPresence?: (guildId: string) => VoicePresenceChannel[];
};

/**
 * Represents the VoiceSessionRepo type.
 */
export type VoiceSessionRepo = {
  startSession: (params: {
    guildId: string;
    channelId: string;
    userId: string;
    displayName?: string;
    startedAt: Date;
  }) => Promise<void>;
  endOpenSession: (params: { guildId: string; userId: string; endedAt: Date }) => Promise<void>;
};

/**
 * Represents the VoiceTrackerLogger type.
 */
export type VoiceTrackerLogger = {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

/**
 * Runs classifyVoiceChange.
 *
 * @param change - Describes the change input.
 * @returns Returns the function result.
 */
export function classifyVoiceChange(change: VoiceChange): VoiceChangeKind {
  if (!change.oldChannelId && change.newChannelId) return 'join';
  if (change.oldChannelId && !change.newChannelId) return 'leave';
  if (change.oldChannelId && change.newChannelId && change.oldChannelId !== change.newChannelId) {
    return 'move';
  }
  return 'noop';
}

/**
 * Runs handleVoiceChange.
 *
 * @param change - Describes the change input.
 * @param deps - Describes the deps input.
 * @returns Returns the function result.
 */
export async function handleVoiceChange(
  change: VoiceChange,
  deps: {
    presenceIndex: VoicePresenceIndex;
    voiceSessionRepo: VoiceSessionRepo;
    logger: VoiceTrackerLogger;
  },
): Promise<void> {
  const action = classifyVoiceChange(change);
  if (action === 'noop') return;

  // For leave/move: capture join time BEFORE updating presence (D7)
  let userJoinedAt: Date | null = null;
  if ((action === 'leave' || action === 'move') && change.oldChannelId) {
    try {
      // Access presence index to get join time
      if (deps.presenceIndex.getGuildPresence) {
        const presence = deps.presenceIndex.getGuildPresence(change.guildId);
        const channelPresence = presence.find((c) => c.channelId === change.oldChannelId);
        const userPresence = channelPresence?.members?.find((m) => m.userId === change.userId);
        userJoinedAt = userPresence?.joinedAt ?? null;
      }
    } catch (error) {
      deps.logger.warn({ error, change }, 'Failed to capture join time for overlap (non-fatal)');
    }
  }

  try {
    deps.presenceIndex.applyChange(change);
  } catch (error) {
    deps.logger.error({ error, change }, 'Voice presence update failed (non-fatal)');
  }

  if (action === 'join') {
    try {
      await deps.voiceSessionRepo.startSession({
        guildId: change.guildId,
        channelId: change.newChannelId as string,
        userId: change.userId,
        displayName: change.displayName,
        startedAt: change.at,
      });
    } catch (error) {
      deps.logger.error({ error, change }, 'Voice session start failed (non-fatal)');
    }
  }

  if (action === 'leave') {
    // Compute voice overlap (D7)
    if (change.oldChannelId && userJoinedAt) {
      try {
        await computeVoiceOverlapForUser({
          guildId: change.guildId,
          userId: change.userId,
          channelId: change.oldChannelId,
          joinedAt: userJoinedAt,
          leftAt: change.at,
        });
      } catch (error) {
        deps.logger.warn({ error, change }, 'Voice overlap computation failed (non-fatal)');
      }
    }

    try {
      await deps.voiceSessionRepo.endOpenSession({
        guildId: change.guildId,
        userId: change.userId,
        endedAt: change.at,
      });
    } catch (error) {
      deps.logger.error({ error, change }, 'Voice session end failed (non-fatal)');
    }
  }

  if (action === 'move') {
    // Compute voice overlap for old channel (D7)
    if (change.oldChannelId && userJoinedAt) {
      try {
        await computeVoiceOverlapForUser({
          guildId: change.guildId,
          userId: change.userId,
          channelId: change.oldChannelId,
          joinedAt: userJoinedAt,
          leftAt: change.at,
        });
      } catch (error) {
        deps.logger.warn({ error, change }, 'Voice overlap computation failed (non-fatal)');
      }
    }

    try {
      await deps.voiceSessionRepo.endOpenSession({
        guildId: change.guildId,
        userId: change.userId,
        endedAt: change.at,
      });
    } catch (error) {
      deps.logger.error({ error, change }, 'Voice session end (move) failed (non-fatal)');
    }

    try {
      await deps.voiceSessionRepo.startSession({
        guildId: change.guildId,
        channelId: change.newChannelId as string,
        userId: change.userId,
        displayName: change.displayName,
        startedAt: change.at,
      });
    } catch (error) {
      deps.logger.error({ error, change }, 'Voice session start (move) failed (non-fatal)');
    }
  }
}
