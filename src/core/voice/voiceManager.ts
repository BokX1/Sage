import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  entersState,
  DiscordGatewayAdapterCreator,
  EndBehaviorType,
} from '@discordjs/voice';
import { Client, VoiceChannel } from 'discord.js';
import { Readable } from 'stream';
import { logger } from '../utils/logger';
import * as prism from 'prism-media';
import { EventEmitter } from 'events';
import { getLLMClient } from '../llm';
import { config } from '../config/env';
import { getGuildApiKey } from '../settings/guildSettingsRepo';

export class VoiceManager extends EventEmitter {
  private static instance: VoiceManager;
  private connections: Map<string, VoiceConnection> = new Map();
  private players: Map<string, AudioPlayer> = new Map();
  private receivers: Map<string, Map<string, any>> = new Map(); // guildId -> userId -> stream

  private constructor() {
    super();
  }

  public static getInstance(): VoiceManager {
    if (!VoiceManager.instance) {
      VoiceManager.instance = new VoiceManager();
    }
    return VoiceManager.instance;
  }

  public async speak(guildId: string, text: string): Promise<void> {
    const connection = this.connections.get(guildId);
    if (!connection) return;

    // Resolve API Key (BYOP)
    const guildKey = await getGuildApiKey(guildId);
    const effectiveKey = guildKey || config.pollinationsApiKey;

    if (!effectiveKey) {
      logger.warn({ guildId }, 'TTS skipped: No API Key available for openai-audio.');
      return;
    }

    try {
      logger.info({ guildId, textPreview: text.slice(0, 30) }, 'Generating TTS...');
      const llm = getLLMClient();
      const response = await llm.chat({
        model: 'openai-audio',
        apiKey: effectiveKey,
        messages: [
          {
            role: 'user',
            content: `Read this text naturally: "${text}"`,
          },
        ],
      });

      if (response.audio) {
        const audioData = Buffer.from(response.audio.data, 'base64');
        const stream = Readable.from(audioData);
        await this.playAudio(guildId, stream);
      } else {
        logger.warn({ guildId }, 'TTS failed: No audio content in response.');
      }
    } catch (error) {
      logger.error({ error, guildId }, 'TTS generation failed');
    }
  }

  public async joinChannel(channel: VoiceChannel): Promise<VoiceConnection> {
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
        this.setupReceiver(connection, channel.guild.id);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch (error) {
          logger.warn(
            { guildId: channel.guild.id, channelId: channel.id },
            'Voice connection disconnected',
          );
          connection.destroy();
          this.connections.delete(channel.guild.id);
          this.players.delete(channel.guild.id);
          this.receivers.delete(channel.guild.id);
        }
      });

      this.connections.set(channel.guild.id, connection);
      return connection;
    } catch (error) {
      logger.error({ error, guildId: channel.guild.id }, 'Failed to join voice channel');
      throw error;
    }
  }

  private setupReceiver(connection: VoiceConnection, guildId: string) {
    const receiver = connection.receiver;
    
    receiver.speaking.on('start', (userId) => {
      // logger.debug({ guildId, userId }, 'User started speaking');
      this.handleSpeakingStart(receiver, userId, guildId);
    });
  }

  private handleSpeakingStart(receiver: any, userId: string, guildId: string) {
    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000,
      },
    });

    try {
      // Robustly resolve prism modules (handles different versions)
      const prismOpus = (prism as any).opus || (prism as any).Opus;
      if (!prismOpus) {
        throw new Error('prism-media opus module not found');
      }

      const opusDecoder = new prismOpus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
      });

      const wavTranscoder = new prism.FFmpeg({
        args: [
          '-analyzeduration', '0',
          '-loglevel', '0',
          '-f', 'wav',
          '-acodec', 'pcm_s16le',
          '-ar', '24000', // Downsample to 24kHz for efficiency
          '-ac', '1',     // Mix to mono
        ],
      });

      // Pipeline: Opus Stream -> Opus Decoder (PCM) -> FFmpeg (WAV) -> Buffer
      opusStream.pipe(opusDecoder).pipe(wavTranscoder);

      const buffers: Buffer[] = [];

      wavTranscoder.on('data', (chunk: Buffer) => {
        buffers.push(chunk);
      });

      wavTranscoder.on('end', () => {
        const audioBuffer = Buffer.concat(buffers);
        if (audioBuffer.length > 0) {
          this.emit('audio_input', {
            guildId,
            userId,
            audioBuffer,
            format: 'wav',
          });
        }
      });

      opusStream.on('error', (err: any) => logger.debug({ err, userId }, 'Opus stream error (often normal disconnect)'));
      opusDecoder.on('error', (err: any) => logger.error({ err }, 'Opus decoder error'));
      wavTranscoder.on('error', (err: any) => logger.error({ err }, 'WAV transcoder error'));

    } catch (error) {
      logger.error({ error, guildId, userId }, 'Failed to initialize audio pipeline');
      opusStream.destroy();
    }
  }

  public leaveChannel(guildId: string): void {
    const connection = this.connections.get(guildId);
    if (connection) {
      connection.destroy();
      this.connections.delete(guildId);
      this.players.delete(guildId);
      this.receivers.delete(guildId);
      logger.info({ guildId }, 'Left voice channel');
    }
  }

  public async playAudio(guildId: string, audioStream: Readable | string): Promise<void> {
    const connection = this.connections.get(guildId);
    if (!connection) {
      throw new Error(`No voice connection for guild ${guildId}`);
    }

    let player = this.players.get(guildId);
    if (!player) {
      player = createAudioPlayer();
      this.players.set(guildId, player);
      connection.subscribe(player);

      player.on(AudioPlayerStatus.Idle, () => {
        logger.debug({ guildId }, 'Audio player idle');
      });

      player.on('error', (error) => {
        logger.error({ error, guildId }, 'Audio player error');
      });
    }

    const resource = createAudioResource(audioStream);
    player.play(resource);

    try {
      await entersState(player, AudioPlayerStatus.Playing, 5_000);
      logger.info({ guildId }, 'Audio playback started');
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to start audio playback');
      throw error;
    }
  }

  public getConnection(guildId: string): VoiceConnection | undefined {
    return this.connections.get(guildId);
  }
}
