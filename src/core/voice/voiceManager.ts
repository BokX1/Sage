import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  entersState,
  DiscordGatewayAdapterCreator,
} from '@discordjs/voice';
import { Client, VoiceChannel } from 'discord.js';
import { Readable } from 'stream';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { getLLMClient } from '../llm';
import { config } from '../config/env';
import { getGuildApiKey } from '../settings/guildSettingsRepo';

export class VoiceManager extends EventEmitter {
  private static instance: VoiceManager;
  private connections: Map<string, VoiceConnection> = new Map();
  private players: Map<string, AudioPlayer> = new Map();

  private constructor() {
    super();
  }

  public static getInstance(): VoiceManager {
    if (!VoiceManager.instance) {
      VoiceManager.instance = new VoiceManager();
    }
    return VoiceManager.instance;
  }

  public async speak(guildId: string, text: string, styleDescription?: string): Promise<void> {
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
      logger.info({ guildId, textPreview: text.slice(0, 30), style: styleDescription }, 'Generating TTS...');
      const llm = getLLMClient();
      
      let ttsPrompt = `Read this text naturally: "${text}"`;
      if (styleDescription) {
        ttsPrompt = `You are a lively voice assistant. Read this text with a ${styleDescription} tone: "${text}"`;
      }

      const response = await llm.chat({
        model: 'openai-audio',
        apiKey: effectiveKey,
        messages: [
          {
            role: 'user',
            content: ttsPrompt,
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
        }
      });

      this.connections.set(channel.guild.id, connection);
      return connection;
    } catch (error) {
      logger.error({ error, guildId: channel.guild.id }, 'Failed to join voice channel');
      throw error;
    }
  }

  public leaveChannel(guildId: string): void {
    const connection = this.connections.get(guildId);
    if (connection) {
      connection.destroy();
      this.connections.delete(guildId);
      this.players.delete(guildId);
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
