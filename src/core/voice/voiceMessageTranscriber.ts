/**
 * @module src/core/voice/voiceMessageTranscriber
 * @description Defines the voice message transcriber module.
 */
import { Readable } from 'stream';
import prism from 'prism-media';
import { type FetchAttachmentResult, fetchDiscordAttachmentBytes } from '../utils/file-handler';
import { logger } from '../utils/logger';
import { buildWavPcm16, estimateDurationMsFromPcm, pcmStereoToMono } from './audioPcm';
import { transcribeWav } from './voiceServiceClient';

const OPUS_HEAD_MARKER = Buffer.from('OpusHead', 'ascii');
const PCM_DURATION_LIMIT_ERROR_MESSAGE = 'Decoded PCM exceeded maximum duration limit.';

function detectOpusChannels(oggBytes: Buffer): number | null {
  const idx = oggBytes.indexOf(OPUS_HEAD_MARKER);
  if (idx < 0) return null;
  const channelCountOffset = idx + OPUS_HEAD_MARKER.length + 1; // version byte
  if (channelCountOffset >= oggBytes.length) return null;
  const channels = oggBytes.readUInt8(channelCountOffset);
  if (!Number.isFinite(channels) || channels < 1 || channels > 8) {
    return null;
  }
  return channels;
}

function truncateHeadTail(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const separator = '\n...\n';
  const available = Math.max(0, maxChars - separator.length);
  if (available <= 0) return text.slice(0, maxChars).trimEnd();
  const headChars = Math.max(0, Math.floor(available * 0.7));
  const tailChars = Math.max(0, available - headChars);
  const head = text.slice(0, headChars).trimEnd();
  const tail = tailChars > 0 ? text.slice(text.length - tailChars).trimStart() : '';
  if (!tail) return head;
  return `${head}${separator}${tail}`;
}

async function decodeOggOpusToPcm(params: { oggBytes: Buffer; channels: number; maxSeconds: number }): Promise<Buffer> {
  const sampleRate = 48_000;
  const channels = Math.max(1, Math.min(2, Math.floor(params.channels)));
  const bytesPerFrame = channels * 2;
  const maxPcmBytes = Math.max(0, Math.floor(params.maxSeconds * sampleRate * bytesPerFrame));
  if (maxPcmBytes <= 0) {
    return Buffer.alloc(0);
  }

  return new Promise<Buffer>((resolve, reject) => {
    const demuxer = new prism.opus.OggDemuxer();
    const decoder = new prism.opus.Decoder({ rate: sampleRate, channels, frameSize: 960 });
    const readable = Readable.from(params.oggBytes);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let done = false;

    const cleanup = () => {
      try {
        readable.removeAllListeners();
        demuxer.removeAllListeners();
        decoder.removeAllListeners();
      } catch {
        // ignore
      }
    };

    const finishOk = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve(Buffer.concat(chunks, totalBytes));
    };

    const finishError = (error: unknown) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    readable.on('error', finishError);
    demuxer.on('error', finishError);
    decoder.on('error', finishError);

    decoder.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxPcmBytes) {
        finishError(new Error(PCM_DURATION_LIMIT_ERROR_MESSAGE));
        try {
          readable.destroy();
          demuxer.destroy();
          decoder.destroy();
        } catch {
          // ignore
        }
      }
    });

    decoder.on('end', finishOk);
    decoder.on('close', () => {
      // Some stream stacks emit close without end; best-effort finalize.
      if (!done) finishOk();
    });

    readable.pipe(demuxer).pipe(decoder);
  });
}

/**
 * Runs transcribeDiscordVoiceMessageAttachment.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
export async function transcribeDiscordVoiceMessageAttachment(params: {
  url: string;
  filename: string;
  contentType: string | null;
  declaredSizeBytes: number | null;
  durationSeconds: number | null;
  timeoutMs: number;
  maxBytes: number;
  maxSeconds: number;
  maxChars: number;
}): Promise<FetchAttachmentResult> {
  const maxSeconds = Math.max(1, Math.floor(params.maxSeconds));

  if (typeof params.durationSeconds === 'number' && Number.isFinite(params.durationSeconds)) {
    if (params.durationSeconds > maxSeconds) {
      return {
        kind: 'too_large',
        message: `[System: Voice message is too long to transcribe (limit: ${maxSeconds}s).]`,
        extractor: 'voice_stt',
        mimeType: params.contentType,
      };
    }
  }

  const fetched = await fetchDiscordAttachmentBytes(params.url, params.filename, {
    timeoutMs: params.timeoutMs,
    maxBytes: params.maxBytes,
    declaredSizeBytes: params.declaredSizeBytes,
    contentType: params.contentType,
  });

  if (fetched.kind === 'skip') {
    return { kind: 'skip', reason: fetched.reason, extractor: 'voice_stt', mimeType: params.contentType };
  }

  if (fetched.kind === 'too_large') {
    return { kind: 'too_large', message: fetched.message, extractor: 'voice_stt', mimeType: params.contentType };
  }

  if (fetched.kind === 'error') {
    return { kind: 'error', message: fetched.message, extractor: 'voice_stt', mimeType: params.contentType };
  }

  const mimeType = fetched.mimeType ?? params.contentType;
  const byteLength = fetched.byteLength;

  const declaredDurationMs =
    typeof params.durationSeconds === 'number' && Number.isFinite(params.durationSeconds)
      ? Math.round(params.durationSeconds * 1000)
      : null;

  let channels = detectOpusChannels(fetched.buffer) ?? 1;
  if (channels !== 1 && channels !== 2) {
    channels = 1;
  }

  let pcm: Buffer;
  try {
    pcm = await decodeOggOpusToPcm({ oggBytes: fetched.buffer, channels, maxSeconds });
  } catch (error) {
    if (error instanceof Error && error.message === PCM_DURATION_LIMIT_ERROR_MESSAGE) {
      return {
        kind: 'too_large',
        message: `[System: Voice message is too long to transcribe (limit: ${maxSeconds}s).]`,
        extractor: 'voice_stt',
        mimeType,
        byteLength,
      };
    }
    logger.debug(
      { error, filename: params.filename, mimeType },
      'Voice message opus decode failed (non-fatal)',
    );
    return {
      kind: 'error',
      message: `[System: Voice message decode failed; unable to transcribe.]`,
      extractor: 'voice_stt',
      mimeType,
      byteLength,
    };
  }

  if (pcm.length === 0) {
    return {
      kind: 'skip',
      reason: '[System: Voice message had no decodable audio.]',
      extractor: 'voice_stt',
      mimeType,
      byteLength,
    };
  }

  const decodedDurationMs = estimateDurationMsFromPcm({ pcmBytes: pcm.length, channels, sampleRate: 48_000 });
  const durationMs = declaredDurationMs ?? decodedDurationMs;
  if (durationMs > maxSeconds * 1000) {
    return {
      kind: 'too_large',
      message: `[System: Voice message is too long to transcribe (limit: ${maxSeconds}s).]`,
      extractor: 'voice_stt',
      mimeType,
      byteLength,
    };
  }

  const monoPcm = channels === 2 ? pcmStereoToMono(pcm) : pcm;
  const wavBytes = buildWavPcm16({ pcm: monoPcm, channels: 1, sampleRate: 48_000 });

  let transcript: string;
  try {
    const result = await transcribeWav({ wavBytes });
    transcript = result.text?.trim() ?? '';
  } catch (error) {
    logger.warn({ error, filename: params.filename }, 'Voice message STT failed (non-fatal)');
    return {
      kind: 'error',
      message: '[System: Voice message transcription failed.]',
      extractor: 'voice_stt',
      mimeType,
      byteLength,
    };
  }

  if (!transcript) {
    return {
      kind: 'skip',
      reason: '[System: Voice message had no transcribable speech.]',
      extractor: 'voice_stt',
      mimeType,
      byteLength,
    };
  }

  if (transcript.length > params.maxChars) {
    const truncated = truncateHeadTail(transcript, params.maxChars);
    return {
      kind: 'truncated',
      text: truncated,
      message: `[System: Voice transcript truncated to ${params.maxChars.toLocaleString()} characters to fit context limits.]`,
      extractor: 'voice_stt',
      mimeType,
      byteLength,
    };
  }

  return {
    kind: 'ok',
    text: transcript,
    extractor: 'voice_stt',
    mimeType,
    byteLength,
  };
}
