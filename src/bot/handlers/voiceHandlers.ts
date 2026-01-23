import { VoiceManager } from '../../core/voice/voiceManager';
import { logger } from '../../utils/logger';
import { getLLMClient } from '../../core/llm';
import { Readable } from 'stream';
import { config } from '../../core/config/env';
import { getGuildApiKey } from '../../core/settings/guildSettingsRepo';
import { generateChatReply } from '../../core/chat/chatEngine';
import { randomUUID } from 'crypto';

export function registerVoiceEventHandlers() {
  const voiceManager = VoiceManager.getInstance();

  voiceManager.on('audio_input', async ({ guildId, userId, audioBuffer }) => {
    logger.info({ guildId, userId, size: audioBuffer.length }, 'Received audio input');

    // 1. Resolve API Key (BYOP: Guild Key > Global Key)
    const guildKey = await getGuildApiKey(guildId);
    const effectiveKey = guildKey || config.pollinationsApiKey;

    if (!effectiveKey) {
      logger.warn(
        { guildId, userId },
        'Missing API Key (Global or Guild). Voice chat requires a paid plan or valid key for the openai-audio model.',
      );
      return;
    }

    try {
      const llm = getLLMClient();
      const base64Audio = audioBuffer.toString('base64');
      const traceId = randomUUID();

      // --- STEP 1: STT (Speech to Text) ---
      logger.info({ guildId, userId }, 'Step 1: Transcribing audio...');
      const sttResponse = await llm.chat({
        model: 'openai-audio',
        apiKey: effectiveKey,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this audio verbatim. Output only the transcription.' }, 
              {
                type: 'input_audio',
                input_audio: {
                  data: base64Audio,
                  format: 'wav', 
                },
              },
            ],
          },
        ],
      });

      const transcription = sttResponse.content.trim();
      if (!transcription) {
        logger.warn({ guildId, userId }, 'STT returned empty transcription. Ignoring.');
        return;
      }
      logger.info({ guildId, userId, transcription }, 'STT Result');

      // --- STEP 2: Agent Processing (Think) ---
      // Determine current channel ID from connection
      const connection = voiceManager.getConnection(guildId);
      const channelId = connection?.joinConfig.channelId as string;

      if (!channelId) {
        logger.error({ guildId }, 'Could not determine voice channel ID for agent context.');
        return;
      }

      logger.info({ guildId, userId, transcription }, 'Step 2: Sending to Agent...');
      const agentResult = await generateChatReply({
        traceId,
        userId,
        channelId,
        guildId,
        messageId: `voice-${Date.now()}`, // Virtual message ID
        userText: transcription,
        invokedBy: 'mention', // Treat as direct interaction
      });

      const replyText = agentResult.replyText;
      logger.info({ guildId, userId, replyText }, 'Agent Reply');

      if (!replyText) {
        logger.warn({ guildId, userId }, 'Agent returned empty reply.');
        return;
      }

      // --- STEP 3: TTS (Text to Speech) ---
      logger.info({ guildId, userId }, 'Step 3: Synthesizing speech...');
      const ttsResponse = await llm.chat({
        model: 'openai-audio',
        apiKey: effectiveKey,
        messages: [
          {
            role: 'user',
            content: `Please read the following text naturally and concisely: "${replyText}"`,
          },
        ],
      });

      // --- STEP 4: Playback ---
      if (ttsResponse.audio) {
        logger.info({ guildId, userId }, 'Playing back audio response...');
        const audioData = Buffer.from(ttsResponse.audio.data, 'base64');
        const stream = Readable.from(audioData);
        await voiceManager.playAudio(guildId, stream);
      } else {
        logger.warn({ guildId, userId }, 'TTS failed to produce audio.');
      }

    } catch (error) {
      logger.error({ error, guildId, userId }, 'Error processing voice input pipeline');
    }
  });
}
