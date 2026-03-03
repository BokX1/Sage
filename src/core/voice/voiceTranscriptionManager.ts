import { EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import type { Guild } from 'discord.js';
import { Readable } from 'stream';
import prism from 'prism-media';
import { config } from '../../config';
import { logger } from '../utils/logger';
import { buildWavPcm16, estimateDurationMsFromPcm, pcmStereoToMono } from './audioPcm';
import { appendVoiceUtterance } from './voiceConversationSessionStore';
import { transcribeWav } from './voiceServiceClient';

type GuildTranscriptionState = {
  guildId: string;
  voiceChannelId: string;
  connection: VoiceConnection;
  guild: Guild;
  botUserId: string;
  speakingListener: (userId: string) => void;
  activeSubscriptions: Map<string, Readable>;
  sttChain: Promise<void>;
};

const active = new Map<string, GuildTranscriptionState>();

function getMemberDisplayName(guild: Guild, userId: string): string | undefined {
  const member = guild.members.cache.get(userId);
  return member?.displayName ?? member?.user?.globalName ?? member?.user?.username ?? undefined;
}

async function transcribeAndStore(params: {
  guildId: string;
  voiceChannelId: string;
  guild: Guild;
  userId: string;
  at: Date;
  wavBytes: Buffer;
  durationMs: number;
}): Promise<void> {
  try {
    const result = await transcribeWav({ wavBytes: params.wavBytes });
    const text = result.text?.trim() ?? '';
    if (!text) return;
    appendVoiceUtterance({
      guildId: params.guildId,
      at: params.at,
      userId: params.userId,
      displayName: getMemberDisplayName(params.guild, params.userId),
      text,
    });
  } catch (error) {
    logger.warn(
      {
        guildId: params.guildId,
        voiceChannelId: params.voiceChannelId,
        userId: params.userId,
        durationMs: params.durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
      'Voice STT failed (non-fatal)',
    );
  }
}

export function startVoiceTranscription(params: {
  guildId: string;
  voiceChannelId: string;
  connection: VoiceConnection;
  guild: Guild;
  botUserId: string;
}): void {
  if (!config.VOICE_STT_ENABLED) return;
  if (active.has(params.guildId)) {
    stopVoiceTranscription(params.guildId);
  }

  const state: GuildTranscriptionState = {
    guildId: params.guildId,
    voiceChannelId: params.voiceChannelId,
    connection: params.connection,
    guild: params.guild,
    botUserId: params.botUserId,
    activeSubscriptions: new Map(),
    sttChain: Promise.resolve(),
    speakingListener: () => {},
  };

  const speakingListener = (userId: string) => {
    if (!config.VOICE_STT_ENABLED) return;
    if (!userId || userId === state.botUserId) return;
    if (state.activeSubscriptions.has(userId)) return;

    const opusStream = state.connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: config.VOICE_STT_END_SILENCE_MS,
      },
    });

    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48000,
    });

    const pcmStream = opusStream.pipe(decoder);

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const startedAt = Date.now();
    const maxMs = config.VOICE_STT_MAX_UTTERANCE_MS;
    const maxBytes = Math.floor((48000 * 2 * (maxMs / 1000)) * 2); // sampleRate * bytesPerSample * seconds * channels(2)

    const cleanup = () => {
      state.activeSubscriptions.delete(userId);
      try {
        opusStream.removeAllListeners();
        decoder.removeAllListeners();
        pcmStream.removeAllListeners();
      } catch {
        // ignore
      }
    };

    const finalize = () => {
      cleanup();

      const rawPcmStereo = Buffer.concat(chunks, totalBytes);
      const durationMs = estimateDurationMsFromPcm({ pcmBytes: rawPcmStereo.length, channels: 2, sampleRate: 48000 });
      if (durationMs < config.VOICE_STT_MIN_UTTERANCE_MS) {
        return;
      }

      const rawPcmMono = pcmStereoToMono(rawPcmStereo);
      const wavBytes = buildWavPcm16({ pcm: rawPcmMono, channels: 1, sampleRate: 48000 });
      const at = new Date();

      // Serialize STT per guild to avoid CPU contention.
      state.sttChain = state.sttChain
        .then(() =>
          transcribeAndStore({
            guildId: state.guildId,
            voiceChannelId: state.voiceChannelId,
            guild: state.guild,
            userId,
            at,
            wavBytes,
            durationMs,
          }),
        )
        .catch(() => {
          // swallow (already logged)
        });
    };

    state.activeSubscriptions.set(userId, opusStream as unknown as Readable);

    const hardStopTimer = setTimeout(() => {
      try {
        opusStream.destroy();
      } catch {
        // ignore
      }
    }, maxMs + 250);
    hardStopTimer.unref?.();

    pcmStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (totalBytes >= maxBytes) {
        try {
          opusStream.destroy();
        } catch {
          // ignore
        }
      }
      // Best-effort guard if timers are delayed.
      if (Date.now() - startedAt > maxMs + 1000) {
        try {
          opusStream.destroy();
        } catch {
          // ignore
        }
      }
    });

    pcmStream.on('end', () => {
      clearTimeout(hardStopTimer);
      finalize();
    });

    pcmStream.on('error', (error) => {
      clearTimeout(hardStopTimer);
      cleanup();
      logger.debug({ guildId: state.guildId, userId, error }, 'Voice PCM stream error (non-fatal)');
    });

    opusStream.on('error', (error) => {
      clearTimeout(hardStopTimer);
      cleanup();
      logger.debug({ guildId: state.guildId, userId, error }, 'Voice Opus stream error (non-fatal)');
    });
  };

  state.speakingListener = speakingListener;
  active.set(params.guildId, state);

  state.connection.receiver.speaking.on('start', speakingListener);
  logger.info({ guildId: params.guildId, voiceChannelId: params.voiceChannelId }, 'Voice transcription started');
}

export function stopVoiceTranscription(guildId: string): void {
  const state = active.get(guildId);
  if (!state) return;
  active.delete(guildId);

  try {
    state.connection.receiver.speaking.off('start', state.speakingListener);
  } catch {
    // ignore
  }

  for (const stream of state.activeSubscriptions.values()) {
    try {
      stream.destroy();
    } catch {
      // ignore
    }
  }
  state.activeSubscriptions.clear();
  logger.info({ guildId }, 'Voice transcription stopped');
}
