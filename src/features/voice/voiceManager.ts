import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  DiscordGatewayAdapterCreator,
} from '@discordjs/voice';
import { VoiceChannel } from 'discord.js';
import { logger } from '../../platform/logging/logger';
import { EventEmitter } from 'events';
import { config } from '../../platform/config/env';
import { resolveTextProviderRoute } from '../agent-runtime/apiKeyResolver';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { createVoiceConversationSummary } from './voiceConversationSummaryRepo';
import {
  startVoiceConversationSession,
  stopVoiceConversationSession,
} from './voiceConversationSessionStore';
import { summarizeVoiceConversationSession } from './voiceSessionSummarizer';
import { voiceServiceHealth } from './voiceServiceClient';
import { startVoiceTranscription, stopVoiceTranscription } from './voiceTranscriptionManager';

/**
 * Defines the VoiceManager class.
 */
export class VoiceManager extends EventEmitter {
  private static instance: VoiceManager;
  private connections: Map<string, VoiceConnection> = new Map();

  private constructor() {
    super();
  }

  public static getInstance(): VoiceManager {
    if (!VoiceManager.instance) {
      VoiceManager.instance = new VoiceManager();
    }
    return VoiceManager.instance;
  }

  public async joinChannel(params: { channel: VoiceChannel; initiatedByUserId: string }): Promise<VoiceConnection> {
    const { channel, initiatedByUserId } = params;

    const existing = this.connections.get(channel.guild.id);
    if (existing) {
      // Ensure clean handoff when moving between channels within the same guild.
      await this.leaveChannel(channel.guild.id);
    }

    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      connection.on(VoiceConnectionStatus.Ready, () => {
        logger.info(
          { guildId: channel.guild.id, channelId: channel.id },
          'Voice connection ready',
        );
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          logger.warn(
            { guildId: channel.guild.id, channelId: channel.id },
            'Voice connection disconnected',
          );
          void this.leaveChannel(channel.guild.id);
        }
      });

      this.connections.set(channel.guild.id, connection);

      // Start optional STT session recording (gated by ingestion allowlist/blocklist).
      if (config.VOICE_STT_ENABLED && isLoggingEnabled(channel.guild.id, channel.id)) {
        const botUserId = channel.guild.members.me?.id ?? channel.guild.client.user?.id ?? 'bot';
        startVoiceConversationSession({
          guildId: channel.guild.id,
          voiceChannelId: channel.id,
          voiceChannelName: channel.name,
          initiatedByUserId,
          startedAt: new Date(),
        });
        startVoiceTranscription({
          guildId: channel.guild.id,
          voiceChannelId: channel.id,
          connection,
          guild: channel.guild,
          botUserId,
        });
      }

      // Best-effort voice-service health ping for easier ops debugging.
      if (config.VOICE_STT_ENABLED) {
        void voiceServiceHealth().then((health) => {
          if (!health.ok) {
            logger.warn({ guildId: channel.guild.id, health }, 'voice-service health check failed');
          }
        });
      }

      return connection;
    } catch (error) {
      logger.error({ error, guildId: channel.guild.id }, 'Failed to join voice channel');
      throw error;
    }
  }

  public async leaveChannel(guildId: string): Promise<void> {
    // Stop STT first to prevent any in-flight utterances being appended after we snapshot.
    stopVoiceTranscription(guildId);
    const endedAt = new Date();
    const session = stopVoiceConversationSession({ guildId, endedAt });

    if (session && config.VOICE_SESSION_SUMMARY_ENABLED && session.utterances.length > 0) {
      void this.persistVoiceSessionSummary(session).catch((error) => {
        logger.warn({ guildId, error }, 'Failed to persist voice session summary (non-fatal)');
      });
    }

    const connection = this.connections.get(guildId);
    if (connection) {
      // Clean up event listeners to prevent memory leaks
      connection.removeAllListeners();
      connection.destroy();
      this.connections.delete(guildId);

      logger.info({ guildId }, 'Left voice channel');
    }
  }

  public getConnection(guildId: string): VoiceConnection | undefined {
    return this.connections.get(guildId);
  }

  private async persistVoiceSessionSummary(session: {
    guildId: string;
    voiceChannelId: string;
    voiceChannelName?: string;
    initiatedByUserId: string;
    startedAt: Date;
    endedAt?: Date;
    utterances: Array<{ at: Date; userId: string; displayName?: string; text: string }>;
  }): Promise<void> {
    const endedAt = session.endedAt ?? new Date();

    const speakerCounts = new Map<string, { userId: string; displayName?: string; utteranceCount: number }>();
    for (const u of session.utterances) {
      const existing = speakerCounts.get(u.userId);
      if (existing) {
        existing.utteranceCount += 1;
        if (!existing.displayName && u.displayName) existing.displayName = u.displayName;
      } else {
        speakerCounts.set(u.userId, { userId: u.userId, displayName: u.displayName, utteranceCount: 1 });
      }
    }
    const speakerStats = Array.from(speakerCounts.values()).sort((a, b) => b.utteranceCount - a.utteranceCount);

    const summaryRoute = await resolveTextProviderRoute(session.guildId, 'summary');
    const structured = await summarizeVoiceConversationSession({
      session: { ...session, endedAt },
      providerId: summaryRoute.providerId,
      providerBaseUrl: summaryRoute.baseUrl,
      providerModel: summaryRoute.model,
      apiKey: summaryRoute.apiKey,
      apiKeySource: summaryRoute.authSource,
      fallbackRoute: summaryRoute.fallbackRoute,
    });

    if (!structured) {
      await createVoiceConversationSummary({
        guildId: session.guildId,
        voiceChannelId: session.voiceChannelId,
        voiceChannelName: session.voiceChannelName,
        initiatedByUserId: session.initiatedByUserId,
        startedAt: session.startedAt,
        endedAt,
        speakerStats,
        summaryText: 'Voice session ended. Summary unavailable (no transcript or summarization failed).',
      });
      return;
    }

    await createVoiceConversationSummary({
      guildId: session.guildId,
      voiceChannelId: session.voiceChannelId,
      voiceChannelName: session.voiceChannelName,
      initiatedByUserId: session.initiatedByUserId,
      startedAt: session.startedAt,
      endedAt,
      speakerStats,
      summaryText: structured.summaryText,
      topics: structured.topics,
      threads: structured.threads,
      decisions: structured.decisions,
      actionItems: structured.actionItems,
      unresolved: structured.unresolved,
      sentiment: structured.sentiment,
      glossary: structured.glossary,
    });
  }
}
